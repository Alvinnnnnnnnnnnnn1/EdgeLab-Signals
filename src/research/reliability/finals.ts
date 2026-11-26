import {z} from 'zod';
import {Store} from '../../core/store';
import {ms,hash,type Event,type Receipt} from '../../core/domain';
import {JsonHTTP} from '../../providers/http';
import {bdlEvent,normalizeBDLStats} from '../../providers/balldontlie';

interface Progress {phase:'fixture'|'stats';nextAt:string;cursor?:number;seen?:number[];fixture?:unknown;source?:Receipt;lastCompleteAt?:string;reason?:string;}
export function registeredEvents(store:Store){
 // GROUP BY must sort identities, never multi-megabyte forecast bodies. Read
 // one canonical registration per event by rowid after the bounded grouping.
 const result=new Map<string,Event>();for(const t of ['shadow_forecasts','prospective_forecasts','experimental_forecasts']){
  const body=store.db.prepare(`SELECT json_extract(body,'$.event') AS event FROM ${t} WHERE rowid=?`);
  for(const r of store.db.prepare(`SELECT event_id,min(rowid) AS first_row FROM ${t} GROUP BY event_id`).iterate()){
   const record=body.get(r.first_row!)as{event:string}|undefined;if(record?.event)result.set(String(r.event_id),JSON.parse(record.event));
  }
 }
 for(const r of store.db.prepare("SELECT json_extract(body,'$.quote.event') AS event FROM experimental_suggestions").all()as{event:string}[])if(r.event){const e=JSON.parse(r.event)as Event;result.set(e.id,e);}return[...result.values()];
}
export function finalSchedule(store:Store,at:string){const pending=new Set((store.db.prepare('SELECT json_extract(body,\'$.quote.event.id\') AS event FROM experimental_suggestions WHERE id NOT IN (SELECT signal_id FROM experimental_grades)').all()as{event:string}[]).map(r=>r.event));return registeredEvents(store).filter(e=>e.league==='NBA').map(event=>{
 const key=`reliable:final:${event.id}`,saved=store.get<Progress>(key),nextAt=saved?.nextAt??new Date(ms(event.startsAt)+3*3600000).toISOString();return{event,key,progress:saved,nextAt};
}).filter(t=>ms(at)-ms(t.event.startsAt)<=4*86400000||!t.progress?.lastCompleteAt||t.progress.phase==='stats'||pending.has(t.event.id)).sort((a,b)=>ms(a.nextAt)-ms(b.nextAt)||a.event.id.localeCompare(b.event.id));}
export function ensureFinalJob(store:Store,at:string){const next=finalSchedule(store,at)[0];if(!next)return;const existing=store.db.prepare("SELECT next_at FROM research_jobs WHERE id='finals'").get()as{next_at:string}|undefined;if(!existing)store.db.prepare("INSERT INTO research_jobs(id,kind,next_at,state,body) VALUES ('finals','finals',?,'queued','{}')").run(next.nextAt);else if(ms(existing.next_at)>ms(next.nextAt))store.db.prepare("UPDATE research_jobs SET next_at=?,state='queued',error='REGISTERED_RESULTS_REQUIRE_RECONCILIATION' WHERE id='finals'").run(next.nextAt);}
export async function finalStep(store:Store,http:JsonHTTP,at:string){
 const all=finalSchedule(store,at),target=all.find(t=>ms(t.nextAt)<=ms(at));if(!target)return{nextAt:all[0]?.nextAt??new Date(ms(at)+6*3600000).toISOString(),reason:'NO_REGISTERED_FINAL_DUE'};
 const{event,key}=target,native=event.id.split(':').at(-1)!;if(!/^[1-9]\d*$/.test(native))throw new Error('EXACT_FINAL_FIXTURE_ID_REQUIRED');
 const p=target.progress??{phase:'fixture',nextAt:at}as Progress;
 if(p.phase==='fixture'){
  const page=await http.get('balldontlie',`/nba/v1/games/${native}`,{},900,0),raw=z.object({data:z.object({id:z.number().int(),status:z.string(),postponed:z.boolean().optional()}).passthrough()}).parse(page.body).data,current=bdlEvent(raw);
  if(current.id!==event.id||current.homeId!==event.homeId||current.awayId!==event.awayId||current.season!==event.season||Math.abs(ms(current.startsAt)-ms(event.startsAt))>300000){store.set(key,{...p,nextAt:new Date(ms(at)+86400000).toISOString(),reason:'EXACT_FINAL_FIXTURE_CHANGED'});return{nextAt:at,reason:'EXACT_FINAL_FIXTURE_CHANGED'};}
  if(raw.status!=='Final'||raw.postponed){store.set(key,{...p,nextAt:new Date(ms(at)+15*60000).toISOString(),reason:'FIXTURE_NOT_FINAL'});return{nextAt:at,reason:'FIXTURE_NOT_FINAL'};}
  store.set(key,{...p,phase:'stats',nextAt:at,fixture:raw,source:page.receipt,cursor:undefined,seen:[]});
 }else{
  if(!p.fixture||!p.source||!store.hasReceipt(p.source))throw new Error('FINAL_FIXTURE_SOURCE_MISSING');
  const page=await http.get('balldontlie','/nba/v1/stats',{'game_ids[]':[native],per_page:'100',...(p.cursor?{cursor:String(p.cursor)}:{})},300,0),parsed=z.object({data:z.array(z.object({game:z.object({id:z.number().int()})}).passthrough()),meta:z.object({next_cursor:z.number().int().positive().nullable().optional()})}).parse(page.body);
  if(parsed.data.some(r=>r.game.id!==Number(native)))throw new Error('FINAL_STATISTICS_OUTSIDE_EXACT_FIXTURE');
  const normalized=normalizeBDLStats(page.body,page.receipt,[{body:p.fixture,receipt:p.source}]),cursor=parsed.meta.next_cursor??undefined;
  if(cursor&&(cursor===p.cursor||p.seen?.includes(cursor)))throw new Error('FINAL_STATS_CURSOR_CYCLE');
  // Immutable inserts precede cursor movement. A lost process replays cached
  // original bytes and exact row IDs; it cannot double a final or a grade.
  const observedAt=[at,page.receipt.retrievedAt].sort().at(-1)!;const inserted=store.ingest(normalized.logs,observedAt);
  if(cursor)store.set(key,{...p,cursor,seen:[...(p.seen??[]),cursor],nextAt:at,reason:normalized.exclusions.length?'SOURCE_ROWS_EXCLUDED':null});
  else store.set(key,{phase:'fixture',nextAt:new Date(ms(at)+(normalized.exclusions.length?6:24)*3600000).toISOString(),lastCompleteAt:at,reason:normalized.exclusions.length?'SOURCE_ROWS_EXCLUDED':null});
  store.set('reliable:last-final-collection',{at,eventId:event.id,inserted,exclusions:normalized.exclusions.length,complete:!cursor,sourceHash:page.receipt.hash});
 }
 const next=finalSchedule(store,at)[0]?.nextAt??new Date(ms(at)+6*3600000).toISOString();return{nextAt:next,reason:null};
}
export function gradingVersion(store:Store){return hash(['hypothetical-grading/1.4.8.1',...['logs','experimental_suggestions','source_receipts','receipts'].map(t=>store.db.prepare(`SELECT count(*) AS n,max(rowid) AS last FROM ${t}`).get())]);}
