import { hash,ms } from '../core/domain';
import type { Store } from '../core/store';
import { inspectStoppedMarket } from '../multi-bookmaker/rollback';
/** Invoke after verified market stop and before old code is restarted. Permanent
 * claims and all bodies survive; accepted/uncertain transmission is never retried. */
export function drainTrialRollback(s:Store,authority:{ownerReference:string;protocolId:string;marketPID:number;at:string;expiresAt:string},at:string,inspect=inspectStoppedMarket){
  if(!authority.ownerReference||ms(authority.at)>ms(at)||ms(authority.expiresAt)<=ms(at)||ms(authority.expiresAt)-ms(authority.at)>3600000)throw Error('CURRENT_TRIAL_ROLLBACK_AUTHORITY_REQUIRED');
  return s.transaction(()=>{
    const status=inspect(authority.marketPID);if(status.processPresent||status.labelPresent)throw Error('STOPPED_MARKET_REQUIRED');
    if(s.db.prepare("SELECT name FROM leases WHERE name IN ('recurring-market-worker','experimental-cycle','experimental-delivery','multi-slate-research') AND expires_at>? LIMIT 1").get(at)||s.db.prepare("SELECT id FROM quota WHERE provider='odds' AND outcome='reserved'").get()||s.get('recurring:uncertain-debit')||s.db.prepare("SELECT id FROM experimental_outbox WHERE state IN ('sending','uncertain') LIMIT 1").get())throw Error('TRIAL_ROLLBACK_UNRESOLVED_OWNER_REQUEST_OR_DELIVERY');
    const active=s.get<any>('production:m1-trial');if(active&&active.protocol.id!==authority.protocolId)throw Error('TRIAL_ROLLBACK_PROTOCOL_CHANGED');
    const expired=s.db.prepare("UPDATE experimental_outbox SET state='expired',error='M1_TRIAL_ROLLBACK_WITHHELD_BODY_RETAINED' WHERE state IN ('pending','retryable_failed') AND EXISTS (SELECT 1 FROM json_each(experimental_outbox.body,'$.ids') i JOIN experimental_suggestions s ON s.id=i.value WHERE json_extract(s.body,'$.forecast.inputs.trialId')=?)").run(authority.protocolId).changes;
    s.db.exec("CREATE TABLE IF NOT EXISTS m1_trial_rollbacks(id TEXT PRIMARY KEY,at TEXT NOT NULL,body TEXT NOT NULL); CREATE TRIGGER IF NOT EXISTS immutable_m1_trial_rollbacks_update BEFORE UPDATE ON m1_trial_rollbacks BEGIN SELECT RAISE(ABORT,'Trial rollback immutable'); END; CREATE TRIGGER IF NOT EXISTS immutable_m1_trial_rollbacks_delete BEFORE DELETE ON m1_trial_rollbacks BEGIN SELECT RAISE(ABORT,'Trial rollback immutable'); END;");
    const body={authority,at,expiredBatches:Number(expired),originalRouterRetained:true,acceptedClaimsRetained:true,sourceRestored:false},id=hash(body);s.db.prepare('INSERT OR IGNORE INTO m1_trial_rollbacks VALUES (?,?,?)').run(id,at,JSON.stringify({...body,id}));s.db.prepare("DELETE FROM meta WHERE key='production:m1-trial'").run();return{...body,id};
  });
}
