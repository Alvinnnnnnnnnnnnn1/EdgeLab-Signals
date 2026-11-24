import{z}from'zod';
import{Store}from'../core/store';
import{hash,ms,eventSchema,propSchema,stamp,type Event,type Prop}from'../core/domain';
import{bookSchema}from'../multi-bookmaker/contracts';

/** Owner-supplied evidence only. An issue/outbox never creates a placement. No
 * stake, balance, execution, bookmaker login or UI acceptance flow is added. */
export const placementSchema=z.object({confirmed:z.literal(true),event:eventSchema,playerId:z.string().regex(/^bdl:nba:player:[1-9]\d*$/),teamId:z.string().regex(/^bdl:nba:team:[1-9]\d*$/),prop:propSchema,side:z.enum(['over','under']),line:z.number().nonnegative().finite(),bookmaker:bookSchema,decimalOdds:z.number().gt(1).finite(),placedAt:stamp,source:z.object({kind:z.enum(['owner-confirmation','receipt-import']),externalId:z.string().min(1).max(200)}).strict(),suggestionId:z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null)}).strict();
const installed=new WeakSet<Store['db']>();
const atomic=<T>(s:Store,fn:()=>T)=>s.db.isTransaction?fn():s.transaction(fn);
export function ensurePlacementGuards(store:Store){
 if(installed.has(store.db))return;
 atomic(store,()=>{
  store.db.exec(`CREATE TABLE IF NOT EXISTS confirmed_placement_receipts(id TEXT PRIMARY KEY,at TEXT NOT NULL,family TEXT NOT NULL,external_key TEXT NOT NULL UNIQUE,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS confirmed_placement_families(family TEXT PRIMARY KEY,first_receipt_id TEXT NOT NULL UNIQUE REFERENCES confirmed_placement_receipts(id));
   CREATE TRIGGER IF NOT EXISTS placement_suppresses_recommendation BEFORE INSERT ON experimental_suggestions WHEN EXISTS(SELECT 1 FROM confirmed_placement_families WHERE family=NEW.family) BEGIN SELECT RAISE(ABORT,'Player-prop family already confirmed placed'); END;`);
  for(const table of ['confirmed_placement_receipts','confirmed_placement_families'])for(const op of ['UPDATE','DELETE'])store.db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${table}_${op} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Confirmed placement evidence is immutable'); END;`);
  // Every historical confirmation consumes the family, even if a later
  // annotation says not_placed. Existing annotations are never rewritten.
  for(const r of store.db.prepare("SELECT a.id,a.at,a.body,s.family,s.id suggestion_id FROM experimental_annotations a JOIN experimental_suggestions s ON s.id=a.signal_id WHERE json_extract(a.body,'$.placed')='placed' ORDER BY a.id").all())record(store,String(r.family),String(r.at),`existing-annotation:${r.id}`,{kind:'existing-annotation',annotationId:r.id,suggestionId:r.suggestion_id,original:JSON.parse(String(r.body))});
 });installed.add(store.db);
}
function record(store:Store,family:string,at:string,externalKey:string,input:unknown){
 const inputHash=hash(input),prior=store.db.prepare('SELECT id,body,family FROM confirmed_placement_receipts WHERE external_key=?').get(externalKey);
 if(prior){if(prior.family!==family||JSON.parse(String(prior.body)).inputHash!==inputHash)throw Error('PLACEMENT_RECEIPT_IDENTITY_CONFLICT');return{receiptId:String(prior.id),duplicate:true,newFamily:false};}
 const id=hash(['confirmed-placement',externalKey]),body={id,at,family,input,inputHash,provenance:externalKey};
 store.db.prepare('INSERT INTO confirmed_placement_receipts VALUES (?,?,?,?,?)').run(id,at,family,externalKey,JSON.stringify(body));
 const changed=store.db.prepare('INSERT OR IGNORE INTO confirmed_placement_families VALUES (?,?)').run(family,id).changes;
 return{receiptId:id,duplicate:false,newFamily:!!changed};
}
export function importConfirmedPlacement(store:Store,raw:unknown,at:string){
 const p=placementSchema.parse(raw);if(p.event.league!=='NBA'||ms(p.placedAt)>ms(at))throw Error('PLACEMENT_CLOCK_OR_LEAGUE_INVALID');
 const original=p.suggestionId?store.db.prepare('SELECT body FROM experimental_suggestions WHERE id=?').get(p.suggestionId):null;
 if(p.suggestionId){if(!original)throw Error('PLACEMENT_ORIGINAL_RECOMMENDATION_MISSING');const q=JSON.parse(String(original.body)).quote;if(hash(q.event)!==hash(p.event)||q.playerId!==p.playerId||q.teamId!==p.teamId||q.prop!==p.prop)throw Error('PLACEMENT_EXACT_IDENTITY_MISMATCH');}
 else{const fixture=store.get<{event:Event}>(`live:fixture:${p.event.id.split(':').at(-1)}`),player=store.get<{playerId:string;teamId:string}>(`live:roster:${p.playerId.split(':').at(-1)}`);if(!fixture||hash(fixture.event)!==hash(p.event)||!player||player.playerId!==p.playerId||player.teamId!==p.teamId||![p.event.homeId,p.event.awayId].includes(p.teamId))throw Error('PLACEMENT_CANONICAL_IDENTITY_REQUIRED');}
 ensurePlacementGuards(store);return atomic(store,()=>record(store,hash([p.event.id,p.playerId,p.prop]),at,`${p.source.kind}:${p.source.externalId}`,p));
}
export function claimPlacedAnnotation(store:Store,annotationId:number|bigint,suggestionId:string,at:string,annotation:unknown){
 ensurePlacementGuards(store);const s=store.db.prepare('SELECT family FROM experimental_suggestions WHERE id=?').get(suggestionId);if(!s)throw Error('PLACEMENT_ORIGINAL_RECOMMENDATION_MISSING');return record(store,String(s.family),at,`existing-annotation:${annotationId}`,{kind:'existing-annotation',annotationId:Number(annotationId),suggestionId,original:annotation});
}
export function hasPlacedFamily(store:Store,family:string){
 if(store.db.prepare("SELECT name FROM sqlite_master WHERE name='confirmed_placement_families'").get()&&store.db.prepare('SELECT family FROM confirmed_placement_families WHERE family=?').get(family))return true;
 return!!store.db.prepare("SELECT a.id FROM experimental_annotations a JOIN experimental_suggestions s ON s.id=a.signal_id WHERE s.family=? AND json_extract(a.body,'$.placed')='placed' LIMIT 1").get(family);
}
export function familySuppressed(store:Store,eventId:string,playerId:string,prop:Prop){const family=hash([eventId,playerId,prop]);return!!store.db.prepare('SELECT id FROM experimental_suggestions WHERE family=? LIMIT 1').get(family)||hasPlacedFamily(store,family);}
