import {realpathSync,statSync} from 'node:fs';
import type {DatabaseSync} from 'node:sqlite';
import type {EfficientStore} from '../research/reliability/store';
/** Worker-only admission. This never stops/replaces a source or market owner.
 * The source is physically read-only; runtime trialIdle still yields every
 * forecasting/grading cycle to source/acquisition work. Changed snapshots are
 * held by the unchanged market context check. All journal writes are fenced
 * by the worker's own token, independently of source leases. */
export function isolatedWorkerGate(source:EfficientStore,journal:DatabaseSync,at:string){
 const main=(db:DatabaseSync)=>String(db.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file??'');
 const a=main(source.db),b=main(journal),blocks:string[]=[];
 if(!source.physicalReadOnly)blocks.push('PHYSICAL_READ_ONLY_SOURCE_REQUIRED');
 if(!a||!b||realpathSync(a)===realpathSync(b)||statSync(a).ino===statSync(b).ino&&statSync(a).dev===statSync(b).dev)blocks.push('SEPARATE_JOURNAL_REQUIRED');
 if(journal.prepare("SELECT name FROM sqlite_master WHERE name IN ('logs','quota','experimental_suggestions') LIMIT 1").get())blocks.push('SOURCE_TABLES_IN_JOURNAL');
 const row=journal.prepare("SELECT value FROM engineering_runtime WHERE key='trial-owner'").get(),owner=row?JSON.parse(String(row.value)):null;
 if(owner&&owner.expiresAt>at)blocks.push('ACTIVE_M1_OWNER');
 if(source.db.prepare("SELECT id FROM quota WHERE provider='odds' AND outcome='reserved' LIMIT 1").get()||source.get('recurring:uncertain-debit'))blocks.push('UNRESOLVED_PAID_REQUEST');
 if(source.db.prepare("SELECT id FROM experimental_outbox WHERE state IN ('sending','uncertain') LIMIT 1").get())blocks.push('UNRESOLVED_DELIVERY');
 if(source.db.prepare("SELECT id FROM recurring_market_jobs WHERE state IN ('queued','deferred','observed','requesting') AND deadline>? AND due_at<=? LIMIT 1").get(at,new Date(Date.parse(at)+600000).toISOString()))blocks.push('IMMINENT_MARKET_STAGE');
 return{at,safe:blocks.length===0,blocks,owner,scope:'ISOLATED_CACHED_M1_WORKER_ONLY',sourceIdleRequired:false,runtimeIdleGateUnchanged:true};
}
