import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Store} from '../core/store';
import {hash,ms} from '../core/domain';
import {gameLogSchema,assertReceipt} from '../core/domain';
import {protectionSchema} from '../multi-bookmaker/contracts';
export function processIdentity(pid:number){return execFileSync('ps',['-p',String(pid),'-o','lstart=,command='],{encoding:'utf8'}).trim();}
export function serviceIdentity(name:'markets'|'research'|'comparison'){
 const text=execFileSync('launchctl',['print',`gui/${process.getuid!()}/com.edgelab.signals.${name}`],{encoding:'utf8'}),pid=Number(text.match(/\n\s*pid = (\d+)/)?.[1]);if(!pid)throw new Error('EXPECTED_SERVICE_NOT_RUNNING');return{pid,identity:processIdentity(pid),runs:Number(text.match(/\n\s*runs = (\d+)/)?.[1])};
}
export function deploymentSafety(store:Store,at:string,afterStop=false){
 const blocks:string[]=[],horizon=new Date(ms(at)+600000).toISOString();
 for(const key of afterStop?['live:worker']:['live:worker','recurring:worker']){const h=store.get<{at:string;state:string}>(key);if(!h||ms(at)-ms(h.at)>90000||h.state==='stopped')blocks.push(`STALE_${key}`);}
 const research=store.db.prepare("SELECT expires_at FROM leases WHERE name='live-worker'").get();if(!research||ms(String(research.expires_at))<=ms(at)||!store.get('reliable:active'))blocks.push('ORIGINAL_SHADOW_NOT_HEALTHY');
 if(store.db.prepare("SELECT id FROM recurring_market_jobs WHERE state='requesting' OR (state IN ('queued','deferred','observed') AND deadline>? AND due_at<=?) LIMIT 1").get(at,horizon))blocks.push('MARKET_REQUEST_OR_IMMINENT_DEADLINE');
 if(store.db.prepare("SELECT id FROM research_jobs WHERE state='running' OR (deadline>? AND next_at<=? AND state IN ('queued','deferred')) LIMIT 1").get(at,horizon))blocks.push('SHADOW_SOURCE_OR_IMMINENT_DEADLINE');
 if(store.db.prepare("SELECT id FROM experimental_outbox WHERE state='sending' LIMIT 1").get())blocks.push('TELEGRAM_SENDING');
 if(store.db.prepare("SELECT id FROM quota WHERE provider='odds' AND outcome='reserved' LIMIT 1").get()||store.get('recurring:uncertain-debit'))blocks.push('UNRESOLVED_PAID_RESERVATION');
 if(store.db.prepare("SELECT name FROM leases WHERE name IN ('experimental-cycle','experimental-delivery') AND expires_at>? LIMIT 1").get(at))blocks.push('MARKET_CYCLE_OR_DELIVERY_OWNED');
 if(afterStop&&store.db.prepare("SELECT name FROM leases WHERE name='recurring-market-worker' AND expires_at>? LIMIT 1").get(at))blocks.push('PREVIOUS_MARKET_OWNER_NOT_RELEASED');
 return{at,safe:blocks.length===0,blocks,pendingBatches:store.db.prepare("SELECT id,state,at FROM experimental_outbox WHERE state IN ('pending','retryable_failed','uncertain','sending') ORDER BY at,id").all()};
}
export function assertFingerprints(expected:Record<string,string>){for(const [path,digest]of Object.entries(expected))if(hash(readFileSync(path,'utf8'))!==digest)throw new Error('PROTECTED_CONFIGURATION_CHANGED');}

/** Additional mandatory gate for both independently operated cutovers. Compose
 * with the relevant worker's process/ownership/idle guard, never instead of it.
 * expectedHash must come from the reviewed deployment record, not a new capture. */
export function protectedCycleSafety(store:Store,raw:unknown,expectedHash:string,at:string){
 const protection=protectionSchema.parse(raw),{hash:digest,...body}=protection,blocks:string[]=[];
 if(digest!==expectedHash||hash(body)!==digest)throw Error('PROTECTED_DEPLOYMENT_MANIFEST_CHANGED');
 const jobs=protection.jobIds.map(id=>{const current=store.db.prepare('SELECT id,event_id,stage,state,due_at,deadline FROM recurring_market_jobs WHERE id=?').get(id),captured=protection.jobs.find((j):j is Record<string,unknown>=>!!j&&typeof j==='object'&&'id' in j&&j.id===id);if(!current||!captured){blocks.push('CAPTURED_JOB_MISSING:'+id);return{id,state:'missing'};}
  if(current.event_id!==captured.eventId||current.stage!==captured.stage||current.due_at!==captured.dueAt||current.deadline!==captured.deadline)blocks.push('CAPTURED_JOB_IDENTITY_CHANGED:'+id);
  if(!['complete','expired','blocked'].includes(String(current.state)))blocks.push('CAPTURED_JOB_NOT_TERMINAL:'+id);
  return{id,state:String(current.state)};
 });
 const fixtures=protection.fixtureIds.map(id=>{let verified=false,verifiedStart:string|null=null;const rows=store.db.prepare('SELECT body FROM logs WHERE event_id=? AND observed_at<=? ORDER BY observed_at DESC').all(id,at);
  for(const row of rows){try{const l=gameLogSchema.parse(JSON.parse(String(row.body)));if(!l.final||l.source.simulated)continue;let candidateVerified=false;for(const r of [l.source,...(l.supportingSources??[])]){assertReceipt(r,at);if(!store.hasReceipt(r))throw Error('FINAL_RECEIPT_MISSING');if(r.provider!=='balldontlie')continue;const bytes=store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(r.hash);if(!bytes)continue;const raw=JSON.parse(String(bytes.body)),data=Array.isArray(raw.data)?raw.data:[raw.data];if(data.some((r:any)=>{const g=r?.game??r;return g&&`bdl:nba:game:${g.id}`===id&&g.status==='Final';}))candidateVerified=true;}if(candidateVerified){verified=true;verifiedStart=l.event.startsAt;break;}}catch{/* Missing/invalid final evidence cannot make a cutover eligible. */}}
  const checkpoint=store.get<{phase:string;lastCompleteAt?:string;reason?:string|null}>(`reliable:final:${id}`),paginationComplete=checkpoint?.phase==='fixture'&&!!checkpoint.lastCompleteAt&&ms(checkpoint.lastCompleteAt)<=ms(at)&&!!verifiedStart&&ms(checkpoint.lastCompleteAt)>ms(verifiedStart)&&!checkpoint.reason;if(!verified)blocks.push('PROTECTED_FINAL_UNVERIFIED:'+id);if(!paginationComplete)blocks.push('PROTECTED_FINAL_COLLECTION_INCOMPLETE:'+id);return{id,verified,paginationComplete};
 });
 const ungraded=store.db.prepare("SELECT id FROM experimental_suggestions WHERE json_extract(body,'$.quote.event.id') IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT signal_id FROM experimental_grades)").all(JSON.stringify(protection.fixtureIds));if(ungraded.length)blocks.push('PROTECTED_RECOMMENDATIONS_UNGRADED');
 return{at,safe:blocks.length===0,protectionHash:digest,jobs,fixtures,ungraded:ungraded.map(r=>r.id),blocks};
}
