import {Store} from '../core/store';
import type {Config} from '../core/config';
import {hash,ms,nowISO,props,type Event,type Receipt,type Terms} from '../core/domain';
import type {Fetcher} from '../providers/http';
import {marketKeys} from '../providers/odds';
import {readRecurringPolicy,recurringBudget,recurringHTTP} from '../suggestions/recurring-policy';
import {fixtureProof,experimentalForecasts,generateExperimentalForecasts,retained} from '../suggestions/forecasts';
import {marketForecasts} from '../production/router';
import {issueQualifiedSuggestions,archivePricedCandidates} from '../suggestions/engine';
import {BOOKMAKERS,VERSION,type CycleJob} from './contracts';
import {authorities,cycleGuard,grantAuthority,installMultiSchema} from './policy';
import {normalizeFourBooks,compareOffers} from './comparison';
import {notificationWindow,localParts} from '../research/schedule';
interface Progress {phase:'events'|'prices'|'requesting'|'observed'|'complete'|'blocked';discovery?:Receipt;oddsId?:string;lastPrice?:Receipt;requestStartedAt?:string;reason?:string;}
function owned(store:Store,token:string,at:string){if(!store.leaseValid('experimental-cycle',token,at))throw Error('MULTI_OWNERSHIP_LOST');}
function update(store:Store,job:CycleJob,p:Progress,state:string,token:string,at:string){store.transaction(()=>{owned(store,token,at);store.db.prepare('INSERT INTO multi_bookmaker_progress VALUES (?,?,?) ON CONFLICT(job_id) DO UPDATE SET phase=excluded.phase,body=excluded.body').run(job.id,p.phase,JSON.stringify(p));store.db.prepare('UPDATE recurring_market_jobs SET state=?,error=? WHERE id=?').run(state,p.reason??null,job.id);});}
export function multiClaimed(store:Store,jobId:string){return!!store.db.prepare("SELECT name FROM sqlite_master WHERE name='multi_bookmaker_stages'").get()&&!!store.db.prepare('SELECT job_id FROM multi_bookmaker_stages WHERE job_id=?').get(jobId);}
/** Existing market worker calls this seam once per selected T-90/T-20 stage.
 * Null preserves the complete legacy path. No separate poller is created. */
export async function runMultiStage(store:Store,config:Config,policyPath:string,job:CycleJob,event:Event,owner:string,options:{clock?:()=>string;fetcher?:Fetcher}={}){
 const clock=options.clock??nowISO,at=clock(),m=config.multiBookmaker,claimed=multiClaimed(store,job.id);
 if(!claimed){if(!m.codeEnabled||!m.paidAcquisitionEnabled||localParts(at).date<'2026-11-25')return null;const a=authorities(m,at);if(a.protection.fixtureIds.includes(event.id)||a.protection.jobIds.includes(job.id))return null;}
 const summary:Record<string,unknown>={at,version:VERSION,state:'NO_VERIFIED_OFFER',networkRequests:0};let p:Progress|undefined;
 try{
  if(!m.codeEnabled||!m.paidAcquisitionEnabled)throw Error('MULTI_DISABLED');const policy=readRecurringPolicy(policyPath,at),authority=grantAuthority(store,m,job,event,at,policy,hash(policy),claimed);owned(store,owner,at);
  installMultiSchema(store);
  if(!claimed)store.transaction(()=>{owned(store,owner,clock());cycleGuard(store,m,job,event,clock());store.db.prepare('INSERT INTO multi_bookmaker_stages VALUES (?,?,?,?,?,?)').run(job.id,authority.cycleId,event.id,authority.activation.id,clock(),JSON.stringify({job,protectionHash:authority.protection.hash,grantId:authority.grant.id,grantHash:hash(authority.grant)}));});
  const prior=store.db.prepare('SELECT body FROM multi_bookmaker_progress WHERE job_id=?').get(job.id);p=prior?JSON.parse(String(prior.body)):{phase:'events'};
  if(p!.phase==='complete'||p!.phase==='blocked')return{...summary,state:p!.phase,reason:p!.reason??null};
  fixtureProof(store,event,store.get<any>(`live:fixture:${event.id.split(':').at(-1)}`)?.source,at);
  if(ms(at)>=ms(job.deadline)||ms(at)>=ms(event.startsAt)-120000){p!.phase='blocked';p!.reason='MULTI_DEADLINE_EXPIRED';update(store,job,p!,'expired',owner,clock());return{...summary,reason:p!.reason};}
  if(notificationWindow(at,event.startsAt).quiet)return{...summary,state:'quiet_hours'};
  if(p!.phase==='requesting'){
   const r=store.db.prepare("SELECT q.id,q.outcome,o.body FROM multi_bookmaker_requests r JOIN quota q ON q.id=r.quota_id LEFT JOIN odds_account_observations o ON o.quota_id=q.id WHERE r.job_id=? AND q.credits=4 AND q.at>=? ORDER BY q.rowid DESC LIMIT 1").get(job.id,p!.requestStartedAt!);
   if(!r){p!.phase='prices';update(store,job,p!,'queued',owner,clock());}
   else{const o=r.body?JSON.parse(String(r.body)):null;if(r.outcome!=='success'||!o?.receiptHash)throw Error('MULTI_INTERRUPTED_REQUEST_UNCERTAIN');const sources=store.db.prepare('SELECT body FROM source_receipts WHERE hash=?').all(o.receiptHash).map(r=>JSON.parse(String(r.body)) as Receipt).filter(r=>r.provider==='odds'&&ms(r.retrievedAt)>=ms(p!.requestStartedAt!));if(sources.length!==1)throw Error('MULTI_RECOVERY_RECEIPT_AMBIGUOUS');p!.lastPrice=sources[0];p!.phase='observed';update(store,job,p!,'observed',owner,clock());}
  }
  const http=()=>recurringHTTP(store,config,policyPath,clock,{fetcher:options.fetcher,oddsId:p!.oddsId,multi:{job,event,owner}});
  if(p!.phase!=='observed'){
   const recent=store.db.prepare("SELECT max(at) at FROM quota WHERE provider='odds'").get() as {at:string|null};if(recent.at&&ms(at)-ms(recent.at)<config.providers.odds.minIntervalSeconds*1000)return{...summary,state:'cooldown'};
   let budget:ReturnType<typeof recurringBudget>;try{budget=recurringBudget(store,policy,clock());}catch(e){if(['ACCOUNT_EVIDENCE_STALE','UNATTRIBUTED_SHARED_ACCOUNT_USAGE','ACCOUNT_PLAN_OR_HEADERS_CHANGED'].includes((e as Error).message)){await http().get('/v4/sports',{},0,0,true);summary.networkRequests=1;return{...summary,state:'account_refreshed'};}throw e;}
   if(budget.spendable<4||budget.dailyRemaining<4)throw Error('MULTI_QUOTA_BLOCKED');
   if(job.stage==='T-90'){const primary=Number(store.db.prepare("SELECT count(*) n FROM recurring_market_jobs WHERE stage='T-20' AND state IN ('queued','deferred') AND due_at LIKE ? AND deadline>?").get(`${at.slice(0,10)}%`,at)!.n);if(budget.dailyRemaining<4+Math.min(primary*4,budget.dailyRemaining))return{...summary,state:'primary_coverage_reserved'};}
   if(p!.phase==='events'){
    const page=await http().get('/v4/sports/basketball_nba/events',{},900,0);if(!Array.isArray(page.body))throw Error('MULTI_DISCOVERY_SCHEMA_ERROR');const matches=page.body.filter((e:any)=>e.sport_key==='basketball_nba'&&e.home_team===event.home&&e.away_team===event.away&&e.commence_time.slice(0,10)===event.startsAt.slice(0,10)&&ms(e.commence_time)>=ms(event.startsAt)&&ms(e.commence_time)-ms(event.startsAt)<=15*60000);if(matches.length!==1||!/^[a-zA-Z0-9_-]+$/.test(matches[0].id))throw Error('MULTI_EXACT_FIXTURE_AMBIGUOUS');p!.discovery=page.receipt;p!.oddsId=matches[0].id;p!.phase='prices';update(store,job,p!,'queued',owner,clock());if(!page.cached)return{...summary,state:'fixture_discovered',networkRequests:1};
   }
   if(p!.phase==='prices'){
    p!.phase='requesting';p!.requestStartedAt=clock();update(store,job,p!,'requesting',owner,clock());
    const response=await http().get(`/v4/sports/basketball_nba/events/${p!.oddsId}/odds`,{bookmakers:BOOKMAKERS.join(','),markets:Object.values(marketKeys).join(','),oddsFormat:'decimal',dateFormat:'iso'},120,4,true);summary.networkRequests=1;p!.lastPrice=response.receipt;p!.phase='observed';update(store,job,p!,'observed',owner,clock());
   }
  }
  if(p!.phase==='observed'){
   const receipt=p!.lastPrice!;retained(store,receipt,clock());const raw=JSON.parse(String(store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(receipt.hash)!.body)),terms=store.get<{terms:Terms[]}>('multi:terms')?.terms??store.get<{terms:Terms[]}>('suggestions:terms')?.terms??[];
   const normal=normalizeFourBooks(store,raw,receipt,event.id,p!.discovery!,terms,clock());
   if(m.comparisonEnabled&&!experimentalForecasts(store,[event.id]).some(f=>hash(f.event)===hash(event)))generateExperimentalForecasts(store,event.id,clock(),clock);
   const forecasts=m.comparisonEnabled?marketForecasts(store,clock(),[event.id]):[];if(m.comparisonEnabled)archivePricedCandidates(store,normal.quotes,clock());
   const decision=compareOffers(store,normal.quotes,terms,forecasts,clock(),m.enabledMarkets,normal.exclusions,m.comparisonEnabled),body={version:VERSION,at:clock(),jobId:job.id,cycleId:authority.cycleId,activationId:authority.activation.id,source:receipt,discovery:p!.discovery,normalizationExclusions:normal.exclusions,normalisedQuoteEvidence:normal.quotes,decision,deliveryDecision:m.comparisonEnabled&&m.telegramEnabled?'RECHECK_AT_ISSUE_AND_DISPATCH':'RESEARCH_ONLY'},audit={...body,id:hash(body)};
   store.transaction(()=>{owned(store,owner,clock());store.db.prepare('INSERT OR IGNORE INTO multi_bookmaker_decisions VALUES (?,?,?,?)').run(audit.id,audit.at,event.id,JSON.stringify(audit));});
   let issuance:ReturnType<typeof issueQualifiedSuggestions>|null=null;
   if(m.comparisonEnabled&&m.telegramEnabled){const items=decision.selected.map(o=>({quote:o.quote,forecast:forecasts.find(f=>f.id===o.forecastId)!,terms:terms.find(t=>t.id===o.quote.termsId)!,assessment:o.assessment,marketComparison:{decisionId:audit.id,comparisonAt:decision.at,selectedQuoteHash:hash(o.quote),opposite:o.opposite,alternatives:decision.alternatives[hash(o.quote)].map(a=>a.quote),jobId:job.id,cycleId:authority.cycleId,activationId:authority.activation.id}}));issuance=issueQualifiedSuggestions(store,config,items,clock(),clock,{assertOwner:()=>owned(store,owner,clock())});}
   summary.source=receipt;summary.state=m.comparisonEnabled?decision.state:'COVERAGE_ONLY';summary.decisionId=audit.id;summary.issuance=issuance;summary.availability=decision.availability;summary.excluded=decision.exclusions.length;summary.selected=decision.selected.length;p!.phase='complete';update(store,job,p!,'complete',owner,clock());
  }
 }catch(e){const r=(e as Error).message,safe=/^[A-Z_]+$/.test(r)?r:'MULTI_SOURCE_ERROR';summary.state='NO_VERIFIED_OFFER';summary.reason=safe;summary.availability=BOOKMAKERS.flatMap(bookmaker=>props.map(prop=>({bookmaker,prop,state:/QUOTA|ALLOWANCE|ACCOUNT|BUDGET/.test(safe)?'QUOTA_BLOCKED':'SOURCE_ERROR',verifiedQuoteSides:0})));
  if(multiClaimed(store,job.id)){const body={version:VERSION,at:clock(),jobId:job.id,source:p?.lastPrice??null,discovery:p?.discovery??null,decision:{state:'NO_VERIFIED_OFFER',reason:safe,availability:summary.availability},deliveryDecision:'BLOCKED'},id=hash(body);store.transaction(()=>{owned(store,owner,clock());store.db.prepare('INSERT OR IGNORE INTO multi_bookmaker_decisions VALUES (?,?,?,?)').run(id,body.at,event.id,JSON.stringify({...body,id}));});p={...(p??{phase:'blocked'}),phase:'blocked',reason:safe};update(store,job,p,'blocked',owner,clock());}
 }
 if(multiClaimed(store,job.id)){owned(store,owner,clock());store.set('multi:last-result',summary);}return summary;
}
