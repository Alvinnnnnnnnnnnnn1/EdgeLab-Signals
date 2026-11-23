import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Store} from '../core/store';
import {hash,ms} from '../core/domain';
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
