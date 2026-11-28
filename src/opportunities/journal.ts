import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {hash,type Quote} from '../core/domain';
import type {Store} from '../core/store';
import type {ExperimentalForecast} from '../suggestions/forecasts';
import {opportunityId,familyId,numericGates,type OpportunityEvaluation} from './engine';
export interface OpportunityOwner{name:'experimental-cycle'|'recurring-market-worker';token:string;}
export class OpportunityJournal {
 readonly db:DatabaseSync;
 constructor(readonly path:string,readOnly=false){if(!resolve(path).includes('/.local/')||!path.endsWith('.sqlite'))throw Error('PRIVATE_OPPORTUNITY_JOURNAL_REQUIRED');if(!readOnly)mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path,{readOnly});this.db.exec('PRAGMA busy_timeout=100');if(!readOnly){this.db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS opportunities(id TEXT PRIMARY KEY,first_at TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,opportunity_id TEXT NOT NULL,at TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY,opportunity_id TEXT NOT NULL,at TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS opportunity_evaluation_latest ON evaluations(opportunity_id,at);
 CREATE INDEX IF NOT EXISTS opportunity_live_expiry ON evaluations(kind,json_extract(body,'$.quote.expiresAt'));
 CREATE TABLE IF NOT EXISTS normalization_exclusions(id TEXT PRIMARY KEY,at TEXT NOT NULL,source_hash TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS runtime(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);for(const t of ['opportunities','observations','evaluations','normalization_exclusions'])for(const op of ['UPDATE','DELETE'])this.db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${t}_${op} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT,'Opportunity evidence is immutable'); END`);chmodSync(path,0o600);}}
 observe(quotes:Quote[],at:string){this.db.exec('BEGIN IMMEDIATE');try{for(const q of quotes){const identity={event:q.event,playerId:q.playerId,player:q.player,teamId:q.teamId,prop:q.prop,line:q.line,side:q.side,bookmaker:q.bookmaker,termsId:q.termsId};this.db.prepare('INSERT OR IGNORE INTO opportunities VALUES(?,?,?)').run(opportunityId(q),at,JSON.stringify(identity));this.db.prepare('INSERT OR IGNORE INTO observations VALUES(?,?,?,?)').run(hash(q),opportunityId(q),q.retrievedAt,JSON.stringify(q));}this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 append(rows:OpportunityEvaluation[]){this.db.exec('BEGIN IMMEDIATE');try{for(const row of rows){const q=row.quote,identity={event:q.event,playerId:q.playerId,player:q.player,teamId:q.teamId,prop:q.prop,line:q.line,side:q.side,bookmaker:q.bookmaker,termsId:q.termsId};this.db.prepare('INSERT OR IGNORE INTO opportunities VALUES(?,?,?)').run(row.opportunityId,row.at,JSON.stringify(identity));this.db.prepare('INSERT OR IGNORE INTO observations VALUES(?,?,?,?)').run(hash(q),row.opportunityId,q.retrievedAt,JSON.stringify(q));const{id:ignored,...body}=row;void ignored;const id=hash(['opportunity-evaluation/1',row.opportunityId,row.quoteHash,row.forecastId,row.gates,row.classification,row.authorityError,row.sourceKind,row.issuedId??null]);this.db.prepare('INSERT OR IGNORE INTO evaluations VALUES(?,?,?,?,?)').run(id,row.opportunityId,row.at,row.sourceKind,JSON.stringify({...body,id,bodyHash:hash(body)}));}this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 set(key:string,value:unknown){this.db.prepare('INSERT OR REPLACE INTO runtime VALUES(?,?)').run(key,JSON.stringify(value));}
 get<T>(key:string):T|null{const r=this.db.prepare('SELECT value FROM runtime WHERE key=?').get(key);return r?JSON.parse(String(r.value))as T:null;}
 close(){this.db.close();}
}
let active:OpportunityJournal|null=null;
const forecastCache=new Map<string,ExperimentalForecast|null>();
export function opportunityPath(){return process.env.EDGELAB_OPPORTUNITY_JOURNAL??null;}
function journal(){const p=opportunityPath();if(!p)return null;if(!active)active=new OpportunityJournal(p);if(active.path!==p)throw Error('OPPORTUNITY_JOURNAL_PIN_CHANGED');return active;}
function assertOwner(s:Store,owner:OpportunityOwner,clock:()=>string){if(!s.leaseValid(owner.name,owner.token,clock()))throw Error('OPPORTUNITY_SOURCE_OWNERSHIP_LOST');}
export function persistOpportunityObservations(s:Store,quotes:Quote[],at:string,owner:OpportunityOwner|undefined,clock:()=>string){if(!opportunityPath()||!owner)return;assertOwner(s,owner,clock);journal()!.observe(quotes,at);assertOwner(s,owner,clock);}
export function persistOpportunityRows(s:Store,rows:OpportunityEvaluation[],owner:OpportunityOwner|undefined,clock:()=>string){if(!opportunityPath()||!owner)return;assertOwner(s,owner,clock);journal()!.append(rows);assertOwner(s,owner,clock);}
export function persistNormalizationExclusions(s:Store,sourceHash:string,exclusions:{identity:string;reason:string}[],owner:OpportunityOwner,clock:()=>string){if(!opportunityPath())return;assertOwner(s,owner,clock);const j=journal()!;for(const exclusion of exclusions){const body={sourceHash,at:clock(),...exclusion},id=hash([sourceHash,exclusion]);j.db.prepare('INSERT OR IGNORE INTO normalization_exclusions VALUES(?,?,?,?)').run(id,body.at,sourceHash,JSON.stringify(body));}assertOwner(s,owner,clock);}
export function resolveArchivedForecast(s:Store,c:any):ExperimentalForecast|null{
 if(!c.forecastId)return null;if(forecastCache.has(c.forecastId))return forecastCache.get(c.forecastId)!;let f:ExperimentalForecast|null=null;
 const direct=s.db.prepare('SELECT body FROM experimental_forecasts WHERE id=?').get(c.forecastId);if(direct)f=JSON.parse(String(direct.body));
 const marker=s.get<any>('production:m1-trial');if(!f&&marker?.journalPath&&c.quote){const j=new DatabaseSync(marker.journalPath,{readOnly:true});try{for(const row of j.prepare('SELECT body FROM m1_trial_ready WHERE protocol_id=? AND event_id=? AND player_id=? AND prop=? AND at<=? ORDER BY at DESC LIMIT 128').all(marker.protocol.id,c.quote.event.id,c.quote.playerId,c.quote.prop,c.at)){const x=JSON.parse(String(row.body)).forecast;if(x.id===c.forecastId){f=x;break;}}}finally{j.close();}}
 const routing=s.get<any>('production:router');if(!f&&routing?.journalPath&&c.quote){const j=new DatabaseSync(routing.journalPath,{readOnly:true});try{const r=j.prepare('SELECT body FROM production_ready WHERE route_id=? AND event_id=? AND player_id=? AND prop=?').get(routing.routeId,c.quote.event.id,c.quote.playerId,c.quote.prop);if(r){const x=JSON.parse(String(r.body)).forecast;if(x.id===c.forecastId)f=x;}}finally{j.close();}}
 if(!f){const issued=s.db.prepare('SELECT body FROM experimental_suggestions WHERE json_extract(body,\'$.forecastId\')=? LIMIT 1').get(c.forecastId);if(issued)f=JSON.parse(String(issued.body)).forecast;}
 if(f&&(f.id!==c.forecastId||f.inputHash!==hash(f.inputs)||Date.parse(f.at)>Date.parse(c.at)))f=null;
 if(forecastCache.size>=16)forecastCache.delete(forecastCache.keys().next().value!);forecastCache.set(c.forecastId,f);return f;
}
/** Retained observations are diagnostic evidence only. Current source context
 * cannot be substituted for missing historical injury/freshness evidence. */
export function historicalEvaluation(s:Store,c:any):OpportunityEvaluation{
 const q=c.quote as Quote,f=resolveArchivedForecast(s,c);let metrics:OpportunityEvaluation['metrics']=null,gates:OpportunityEvaluation['gates']=[];
 if(f){try{const n=numericGates(q,f,c.at);metrics=n.metrics;gates=n.gates;}catch{}}
 gates.push({code:'RECORDED_HISTORICAL_QUALIFICATION',category:'DATA_IDENTITY_FRESHNESS',pass:null,observed:c.trialQualification??null,required:'original recorded verdict; not reconstructed as current authority'},{code:'HISTORICAL_RESEARCH_ONLY',category:'DATA_IDENTITY_FRESHNESS',pass:false,observed:c.id,required:'eligible current market stage before original quote expiry'});
 const body={at:c.at,opportunityId:opportunityId(q),familyId:familyId(q),quote:q,quoteHash:hash(q),forecastId:f?.id??c.forecastId??null,forecastHash:f?hash(f):null,metrics,gates,authorityError:'HISTORICAL_RESEARCH_NO_RECOMMENDATION_AUTHORITY',classification:f?'WATCH' as const:'DATA_HOLD' as const,sourceKind:'HISTORICAL_RESEARCH' as const};return{...body,id:hash(body)};
}
export function refreshOpportunityResearch(s:Store,owner:OpportunityOwner,clock=()=>new Date().toISOString(),limit=20,budgetMs=1500){
 if(!opportunityPath())return null;assertOwner(s,owner,clock);const j=journal()!,start=performance.now(),cursor=j.get<number>('researchCursor')??0,rows=s.db.prepare('SELECT rowid,body FROM experimental_candidates WHERE rowid>? ORDER BY rowid LIMIT ?').all(cursor,limit);let evaluated=0,next=cursor;
 for(const r of rows){if(performance.now()-start>=budgetMs)break;assertOwner(s,owner,clock);const c=JSON.parse(String(r.body));if(c.quote){j.append([historicalEvaluation(s,c)]);evaluated++;}next=Number(r.rowid);j.set('researchCursor',next);}
 const result={at:clock(),pid:process.pid,kind:'CACHED_HISTORICAL_RESEARCH',evaluated,cursor:next,sourceMaximum:Number(s.db.prepare('SELECT coalesce(max(rowid),0)n FROM experimental_candidates').get()!.n),networkRequests:0,messages:0,qualificationThresholds:'UNCHANGED',sourceOwner:owner.name};assertOwner(s,owner,clock);j.set('heartbeat',result);return result;
}
export function closeOpportunityJournal(){active?.close();active=null;forecastCache.clear();}
export function readOpportunitySnapshot(path=opportunityPath(),at=new Date().toISOString()){
 if(!path||!existsSync(path))return null;const j=new OpportunityJournal(path,true);try{const rows=j.db.prepare(`SELECT e.body FROM evaluations e WHERE NOT EXISTS(SELECT 1 FROM evaluations n WHERE n.opportunity_id=e.opportunity_id AND(n.at>e.at OR(n.at=e.at AND n.rowid>e.rowid))) ORDER BY e.at DESC,e.rowid DESC LIMIT 100`).all().map(r=>JSON.parse(String(r.body)));return{at,heartbeat:j.get<any>('heartbeat'),counts:j.db.prepare('SELECT kind,count(*)evaluations,count(distinct opportunity_id)uniqueOpportunities FROM evaluations GROUP BY kind').all(),opportunities:Number(j.db.prepare('SELECT count(*)n FROM opportunities').get()!.n),normalizationExclusions:j.db.prepare('SELECT body FROM normalization_exclusions ORDER BY at DESC,rowid DESC LIMIT 50').all().map(r=>JSON.parse(String(r.body))),rows};}finally{j.close();}
}
