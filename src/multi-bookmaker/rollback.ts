import{execFileSync}from'node:child_process';import{z}from'zod';import{Store}from'../core/store';import{hash,ms,stamp}from'../core/domain';
export const rollbackApprovalSchema=z.object({version:z.literal('market-rollback/1.4.8.1'),ownerApproved:z.literal(true),approvalReference:z.string().min(8).max(1000),approvedAt:stamp,expiresAt:stamp,marketPid:z.number().int().positive(),marketIdentity:z.string().min(8),candidateCommit:z.string().regex(/^[a-f0-9]{40}$/),rollbackCommit:z.literal('89f83e00d9812ba8513ed13f40c9d2f54f6e0c48')}).strict();
export function inspectStoppedMarket(pid:number){
 let processPresent=false,labelPresent=false;try{processPresent=!!execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{/* A vanished PID is required, never terminated here. */}
 try{const t=execFileSync('launchctl',['print',`gui/${process.getuid!()}/com.edgelab.signals.markets`],{encoding:'utf8',stdio:['ignore','pipe','ignore']});labelPresent=/\n\s*pid = \d+/.test(t)||/\n\s*state = running/.test(t);}catch{/* Label booted out. */}return{processPresent,labelPresent};
}
/** No service controls, configuration changes, restoration or network. This
 * drain is only for an approved, already-stopped market-only rollback. It is
 * necessary because old dispatch code cannot read the extension's flags. */
export function drainMarketRollback(store:Store,raw:unknown,at:string,inspect=inspectStoppedMarket){
 const approval=rollbackApprovalSchema.parse(raw);if(ms(approval.approvedAt)>ms(at)||ms(approval.expiresAt)<=ms(at)||ms(approval.expiresAt)-ms(approval.approvedAt)>3600000)throw Error('ROLLBACK_APPROVAL_EXPIRED_OR_INVALID');
 const status=inspect(approval.marketPid);if(status.processPresent||status.labelPresent)throw Error('MARKET_PROCESS_NOT_CONFIRMED_EXITED');
 const present=(name:string)=>!!store.db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name);
 return store.transaction(()=>{
  const active=store.get<{commit:string}>('multi:active-release');if(active&&active.commit!==approval.candidateCommit)throw Error('ROLLBACK_RELEASE_IDENTITY_CHANGED');const again=inspect(approval.marketPid);if(again.processPresent||again.labelPresent)throw Error('MARKET_PROCESS_NOT_CONFIRMED_EXITED');
  if(store.db.prepare("SELECT name FROM leases WHERE name IN ('recurring-market-worker','experimental-cycle','experimental-delivery','multi-slate-research') AND expires_at>? LIMIT 1").get(at))throw Error('MARKET_OR_CHILD_OWNERSHIP_NOT_RELEASED');
  if(store.db.prepare("SELECT id FROM quota WHERE provider='odds' AND outcome='reserved' LIMIT 1").get()||store.get('recurring:uncertain-debit'))throw Error('ROLLBACK_PAID_RESERVATION_UNRESOLVED');
  if(store.db.prepare("SELECT id FROM experimental_outbox WHERE state='sending' LIMIT 1").get())throw Error('ROLLBACK_DELIVERY_IN_PROGRESS');
  const bodies=store.db.prepare('SELECT id,body,binding FROM experimental_outbox ORDER BY id').all(),models=store.db.prepare('SELECT id,body FROM research_models ORDER BY id').all(),placement=present('confirmed_placement_families');
  const expired=store.db.prepare(`UPDATE experimental_outbox SET state='expired',error='V1481_ROLLBACK_WITHHELD; immutable body preserved' WHERE state IN ('pending','retryable_failed') AND EXISTS(SELECT 1 FROM json_each(experimental_outbox.body,'$.ids') item JOIN experimental_suggestions s ON s.id=item.value WHERE json_type(s.body,'$.marketComparison')='object'${placement?" OR EXISTS(SELECT 1 FROM confirmed_placement_families p WHERE p.family=s.family)":''})`).run().changes;
  const stages=present('multi_bookmaker_stages')?store.db.prepare("UPDATE recurring_market_jobs SET state='blocked',error='V1481_ROLLBACK_CLAIMED_STAGE_WITHHELD' WHERE id IN(SELECT job_id FROM multi_bookmaker_stages) AND state NOT IN ('complete','blocked','expired')").run().changes:0;
  store.db.prepare("DELETE FROM meta WHERE key='multi:active-release'").run();
  if(hash(bodies)!==hash(store.db.prepare('SELECT id,body,binding FROM experimental_outbox ORDER BY id').all())||hash(models)!==hash(store.db.prepare('SELECT id,body FROM research_models ORDER BY id').all()))throw Error('ROLLBACK_IMMUTABLE_DATA_CHANGED');
  const body={version:'market-rollback-drain/1.4.8.1',at,approvalReference:approval.approvalReference,candidateCommit:approval.candidateCommit,rollbackCommit:approval.rollbackCommit,expiredBatches:Number(expired),blockedStages:Number(stages),originalBodiesPreserved:true,modelArtifactsPreserved:true},id=hash(body);
  store.db.exec("CREATE TABLE IF NOT EXISTS multi_rollback_drains(id TEXT PRIMARY KEY,at TEXT NOT NULL,body TEXT NOT NULL);CREATE TRIGGER IF NOT EXISTS immutable_multi_rollback_drains_update BEFORE UPDATE ON multi_rollback_drains BEGIN SELECT RAISE(ABORT,'Rollback evidence is immutable');END;CREATE TRIGGER IF NOT EXISTS immutable_multi_rollback_drains_delete BEFORE DELETE ON multi_rollback_drains BEGIN SELECT RAISE(ABORT,'Rollback evidence is immutable');END;");store.db.prepare('INSERT OR IGNORE INTO multi_rollback_drains VALUES (?,?,?)').run(id,at,JSON.stringify({...body,id}));return{...body,id,providerRequests:0,outboundMessages:0};
 });
}
