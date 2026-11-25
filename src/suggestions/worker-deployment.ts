import type{EfficientStore}from'../research/reliability/store';
/** Same-schema, same-policy market CODE repair only, after the old market
 * process/children exit. Cached source supervisor work may coexist, as during
 * normal operation; assigned or imminent source work still blocks admission. */
export function marketRepairGate(s:EfficientStore,at:string){
 const blocks:string[]=[];
 if(!s.physicalReadOnly)blocks.push('READ_ONLY_PREFLIGHT_REQUIRED');
 const active=s.db.prepare("SELECT name FROM leases WHERE name IN ('recurring-market-worker','experimental-cycle','experimental-delivery') AND expires_at>? LIMIT 1").get(at);if(active)blocks.push('MARKET_OWNER_OR_OPERATION_ACTIVE');
 if(s.db.prepare("SELECT id FROM quota WHERE provider='odds' AND outcome='reserved' LIMIT 1").get()||s.get('recurring:uncertain-debit'))blocks.push('UNRESOLVED_PAID_REQUEST');
 if(s.db.prepare("SELECT id FROM experimental_outbox WHERE state IN ('sending','uncertain') LIMIT 1").get())blocks.push('UNRESOLVED_DELIVERY');
 const soon=new Date(Date.parse(at)+600000).toISOString();
 if(s.db.prepare("SELECT id FROM recurring_market_jobs WHERE state IN ('queued','deferred','observed','requesting') AND deadline>? AND due_at<=? LIMIT 1").get(at,soon))blocks.push('IMMINENT_MARKET_STAGE');
 const worker=s.get<any>('reliable:worker');if(!worker?.at||Date.parse(at)-Date.parse(worker.at)>45000||worker.source)blocks.push('SOURCE_ASSIGNED_OR_UNVERIFIED');
 if(s.db.prepare("SELECT id FROM research_jobs WHERE state IN ('queued','deferred','running') AND kind IN ('fixtures','roster','injuries','pregame','history','finals') AND next_at<=? AND (deadline IS NULL OR deadline>?) LIMIT 1").get(soon,at))blocks.push('SOURCE_JOB_DUE_OR_IMMINENT');
 return{at,safe:blocks.length===0,blocks,sourceAdmission:'UNCHANGED; only unassigned cached supervisor work may overlap',scope:'SAME_POLICY_MARKET_CODE_REPAIR_ONLY'};
}
