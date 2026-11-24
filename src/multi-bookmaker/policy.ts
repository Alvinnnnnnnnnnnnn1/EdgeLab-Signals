import {readFileSync,statSync} from 'node:fs';
import {hash,ms,eventSchema,gameLogSchema,assertReceipt,type Event} from '../core/domain';
import {Store} from '../core/store';
import {localParts} from '../research/schedule';
import {activationSchema,grantSchema,protectionSchema,VERSION,type MultiConfig,type CycleJob} from './contracts';
export function privateJSON(path:string|null){if(!path||(statSync(path).mode&0o077)!==0)throw new Error('MULTI_PRIVATE_AUTHORITY_REQUIRED');return JSON.parse(readFileSync(path,'utf8'));}
export function authorities(config:MultiConfig,at:string){
 const protection=protectionSchema.parse(privateJSON(config.protectionFile)),{hash:digest,...body}=protection;
 if(hash(body)!==digest)throw new Error('MULTI_PROTECTION_HASH_MISMATCH');
 const activation=activationSchema.parse(privateJSON(config.activationFile));
 if(activation.protectionHash!==digest||ms(activation.approvedAt)>ms(at)||ms(activation.effectiveAt)<ms(activation.approvedAt)||localParts(activation.effectiveAt).date<'2026-11-25')throw new Error('MULTI_ACTIVATION_INVALID');
 return{protection,activation};
}
export function cycleGuard(store:Store,config:MultiConfig,job:CycleJob,event:Event,at:string,recovery=false){
 const {protection,activation}=authorities(config,at);eventSchema.parse(event);const release=store.get<{commit:string;protectionHash:string;activationHash:string;eventIds:string[]}>('multi:active-release');if(!release||release.commit!==activation.codeCommit||release.protectionHash!==protection.hash||release.activationHash!==hash(activation)||hash(release.eventIds)!==hash(activation.eventIds))throw new Error('MULTI_REVIEWED_RELEASE_NOT_ACTIVATED');
 if(!activation.eventIds.includes(event.id)||localParts(event.startsAt).date!==activation.operatingDate)throw new Error('MULTI_OUTSIDE_ACTIVATED_SLATE');
 if(!config.codeEnabled||localParts(at).date<'2026-11-25'||ms(at)<ms(activation.effectiveAt))throw new Error('MULTI_NOT_YET_ELIGIBLE');
 if(protection.fixtureIds.includes(event.id)||protection.jobIds.includes(job.id))throw new Error('MULTI_PROTECTED_FIXTURE_OR_JOB');
 if(event.league!=='NBA'||job.event_id!==event.id||localParts(event.startsAt).date<'2026-11-25'||!['T-90','T-20'].includes(job.stage)||ms(job.due_at)<ms(activation.effectiveAt)||ms(job.due_at)>ms(at)||ms(job.deadline)<=ms(at)||ms(at)>=ms(event.startsAt)-120000)throw new Error('MULTI_EXACT_NEW_STAGE_REQUIRED');
 const protectedIds=protection.jobIds,prior=store.db.prepare('SELECT id,state FROM recurring_market_jobs WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(protectedIds));if(prior.length!==protectedIds.length)throw new Error('MULTI_PROTECTED_HISTORY_MISSING');if(prior.some(j=>!['complete','expired','blocked'].includes(String(j.state))))throw new Error('MULTI_PROTECTED_CYCLE_NOT_FINISHED');if(store.db.prepare("SELECT id FROM recurring_market_jobs WHERE event_id IN (SELECT value FROM json_each(?)) AND state NOT IN ('complete','expired','blocked') LIMIT 1").get(JSON.stringify(protection.fixtureIds)))throw new Error('MULTI_PROTECTED_CYCLE_REOPENED');
 for(const id of protection.fixtureIds){const row=store.db.prepare("SELECT body FROM logs WHERE event_id=? AND observed_at<=? AND json_extract(body,'$.final')=1 ORDER BY observed_at DESC LIMIT 1").get(id,at);if(!row)throw new Error('MULTI_PROTECTED_FINAL_UNVERIFIED');const log=gameLogSchema.parse(JSON.parse(String(row.body)));let final=false;for(const r of [log.source,...(log.supportingSources??[])]){assertReceipt(r,at);if(!store.hasReceipt(r))throw new Error('MULTI_PROTECTED_FINAL_SOURCE_MISSING');if(r.provider!=='balldontlie')continue;const raw=JSON.parse(String(store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(r.hash)!.body)),data=Array.isArray(raw.data)?raw.data:[raw.data];if(data.some((g:any)=>{const game=g?.game??g;return game&&`bdl:nba:game:${game.id}`===id&&game.status==='Final';}))final=true;}if(!final)throw new Error('MULTI_PROTECTED_FINAL_UNVERIFIED');}
 const stored=store.db.prepare('SELECT * FROM recurring_market_jobs WHERE id=?').get(job.id) as unknown as CycleJob|undefined;
 if(!stored||stored.event_id!==event.id||stored.stage!==job.stage||stored.due_at!==job.due_at||stored.deadline!==job.deadline)throw new Error('MULTI_JOB_IDENTITY_CHANGED');
 const saved=JSON.parse(stored.body);if(hash(saved.event)!==hash(event))throw new Error('MULTI_JOB_FIXTURE_CHANGED');const cycleId=hash([VERSION,activation.id,event.id]);
 const claimed=!!store.db.prepare("SELECT name FROM sqlite_master WHERE name='multi_bookmaker_stages'").get()&&!!store.db.prepare('SELECT job_id FROM multi_bookmaker_stages WHERE job_id=? AND cycle_id=?').get(job.id,cycleId);
 if(!claimed&&(stored.state!=='queued'||saved.discovery||saved.oddsId||saved.lastPrice||saved.reservationFloor!==undefined||saved.requestStartedAt))throw new Error('MULTI_STAGE_ALREADY_STARTED');
 if(recovery&&!claimed)throw new Error('MULTI_STAGE_CLAIM_MISSING');
 if(!claimed){
  const history=store.db.prepare("SELECT body FROM experimental_candidates WHERE json_extract(body,'$.quote.event.id')=?").all(event.id);
  if(history.length){
   const proofs=new Set<string>();
   if(store.db.prepare("SELECT name FROM sqlite_master WHERE name='multi_bookmaker_decisions'").get())for(const row of store.db.prepare("SELECT body FROM multi_bookmaker_decisions WHERE event_id=? AND json_extract(body,'$.cycleId')=?").all(event.id,cycleId)){
    const audit=JSON.parse(String(row.body)),{id,...body}=audit;if(hash(body)!==id||audit.activationId!==activation.id)throw new Error('MULTI_PRIOR_STAGE_EVIDENCE_INVALID');for(const quote of audit.normalisedQuoteEvidence??[])proofs.add(hash(quote));
   }
   if(history.some(row=>!proofs.has(hash(JSON.parse(String(row.body)).quote))))throw new Error('MULTI_FIXTURE_CYCLE_ALREADY_STARTED');
  }
 }
 return{protection,activation,cycleId};
}
export function grantAuthority(store:Store,config:MultiConfig,job:CycleJob,event:Event,at:string,policy:{id:string},policyBinding:string,recovery=false){
 const ctx=cycleGuard(store,config,job,event,at,recovery);let grant:ReturnType<typeof grantSchema.parse>;try{grant=grantSchema.parse(privateJSON(config.grantFile));}catch{throw new Error('MULTI_FINITE_SHARED_ALLOWANCE_REQUIRED');}
 if(!config.paidAcquisitionEnabled||grant.activationId!==ctx.activation.id||grant.protectionHash!==ctx.protection.hash||grant.policyId!==policy.id||grant.policyBinding!==policyBinding||!process.env.ODDS_API_KEY||grant.apiKeyFingerprint!==hash(process.env.ODDS_API_KEY)||!grant.eventIds.includes(event.id)||ms(grant.approvedAt)>ms(at)||ms(grant.expiresAt)<=ms(at)||ms(grant.expiresAt)-ms(grant.approvedAt)>86400000)throw new Error('MULTI_FINITE_SHARED_ALLOWANCE_REQUIRED');
 if(!grant.stages.includes(job.stage as 'T-90'|'T-20')||grant.eventIds.some(id=>!ctx.activation.eventIds.includes(id)))throw new Error('MULTI_GRANT_OUTSIDE_ACTIVATED_SLATE');
 const stage=store.db.prepare("SELECT name FROM sqlite_master WHERE name='multi_bookmaker_stages'").get()?store.db.prepare('SELECT body FROM multi_bookmaker_stages WHERE job_id=?').get(job.id):null;if(stage){const frozen=JSON.parse(String(stage.body));if(frozen.grantId!==grant.id||frozen.grantHash!==hash(grant))throw new Error('MULTI_FROZEN_GRANT_CHANGED');}
 return{...ctx,grant};
}
const installed=new WeakSet<Store['db']>();
export function installMultiSchema(store:Store){if(installed.has(store.db))return;store.db.exec(`
 CREATE TABLE IF NOT EXISTS multi_bookmaker_stages(job_id TEXT PRIMARY KEY,cycle_id TEXT NOT NULL,event_id TEXT NOT NULL,activation_id TEXT NOT NULL,at TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS multi_bookmaker_requests(quota_id TEXT PRIMARY KEY REFERENCES quota(id),grant_id TEXT NOT NULL,job_id TEXT NOT NULL,at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS multi_bookmaker_decisions(id TEXT PRIMARY KEY,at TEXT NOT NULL,event_id TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS multi_bookmaker_progress(job_id TEXT PRIMARY KEY,phase TEXT NOT NULL,body TEXT NOT NULL);
 `);for(const t of ['multi_bookmaker_stages','multi_bookmaker_requests','multi_bookmaker_decisions'])for(const op of ['UPDATE','DELETE'])store.db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${t}_${op} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT,'Multi-bookmaker evidence is immutable'); END;`);installed.add(store.db);}
