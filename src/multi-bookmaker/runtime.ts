import{Store}from'../core/store';import type{Config}from'../core/config';
import{hash,ms,nowISO,props,type Event,type Receipt,type Terms,type Prop}from'../core/domain';import type{Fetcher}from'../providers/http';import{marketKeys}from'../providers/odds';
import{readRecurringPolicy,recurringHTTP}from'../suggestions/recurring-policy';import{fixtureProof,experimentalForecasts,generateExperimentalForecasts,retained}from'../suggestions/forecasts';import{marketForecasts}from'../production/router';import{issueQualifiedSuggestions,archivePricedCandidates}from'../suggestions/engine';
import{BOOKMAKERS,VERSION,type CycleJob}from'./contracts';import{authorities,cycleGuard,grantAuthority,installMultiSchema}from'./policy';import{normalizeFourBooks,compareOffers}from'./comparison';import{notificationWindow,localParts}from'../research/schedule';import{slatePlan,recordSlatePlan}from'./planner';
interface Progress{phase:'events'|'prices'|'requesting'|'observed'|'complete'|'blocked';discovery?:Receipt;oddsId?:string;lastPrice?:Receipt;requestStartedAt?:string;reason?:string;markets?:Prop[];families?:{family:string;prop:Prop;playerId:string}[];planId?:string;sourceStamps?:{key:string;valueHash:string}[];}
function owned(store:Store,token:string,at:string){if(!store.leaseValid('experimental-cycle',token,at))throw Error('MULTI_OWNERSHIP_LOST');}
function update(store:Store,job:CycleJob,p:Progress,state:string,token:string,at:string){store.transaction(()=>{owned(store,token,at);store.db.prepare('INSERT INTO multi_bookmaker_progress VALUES (?,?,?) ON CONFLICT(job_id) DO UPDATE SET phase=excluded.phase,body=excluded.body').run(job.id,p.phase,JSON.stringify(p));store.db.prepare('UPDATE recurring_market_jobs SET state=?,error=? WHERE id=?').run(state,p.reason??null,job.id);});}
export function multiClaimed(store:Store,jobId:string){return!!store.db.prepare("SELECT name FROM sqlite_master WHERE name='multi_bookmaker_stages'").get()&&!!store.db.prepare('SELECT job_id FROM multi_bookmaker_stages WHERE job_id=?').get(jobId);}
/** Scope survives an expired/missing grant. Only reviewed activation identities
 * select extension jobs; non-target unclaimed work stays on the legacy path. */
export function multiTarget(store:Store,config:Config,job:CycleJob,event:Event,at:string){
 if(multiClaimed(store,job.id))return true;const m=config.multiBookmaker;if(!m.codeEnabled||!m.paidAcquisitionEnabled||localParts(at).date<'2026-11-25')return false;
 const marker=store.get<{eventIds?:string[]}>('multi:active-release');if(!marker?.eventIds?.includes(event.id))return false;
 const a=authorities(m,at);return!a.protection.fixtureIds.includes(event.id)&&!a.protection.jobIds.includes(job.id);
}
export async function runMultiStage(store:Store,config:Config,policyPath:string,job:CycleJob,event:Event,owner:string,options:{clock?:()=>string;fetcher?:Fetcher}={}){
 const clock=options.clock??nowISO,at=clock(),m=config.multiBookmaker,claimed=multiClaimed(store,job.id);if(!multiTarget(store,config,job,event,at))return null;
 const summary:Record<string,any>={at,version:VERSION,state:'NO_VERIFIED_OFFER',networkRequests:0};let p:Progress|undefined;
 try{
  if(!m.codeEnabled||!m.paidAcquisitionEnabled)throw Error('MULTI_DISABLED');const policy=readRecurringPolicy(policyPath,at),authority=grantAuthority(store,m,job,event,at,policy,hash(policy),claimed);owned(store,owner,at);installMultiSchema(store);
  if(!claimed)store.transaction(()=>{owned(store,owner,clock());cycleGuard(store,m,job,event,clock());store.db.prepare('INSERT INTO multi_bookmaker_stages VALUES (?,?,?,?,?,?)').run(job.id,authority.cycleId,event.id,authority.activation.id,clock(),JSON.stringify({job,protectionHash:authority.protection.hash,grantId:authority.grant.id,grantHash:hash(authority.grant)}));});
  const prior=store.db.prepare('SELECT body FROM multi_bookmaker_progress WHERE job_id=?').get(job.id);p=prior?JSON.parse(String(prior.body)):{phase:'events'};
  if(p!.phase==='complete'||p!.phase==='blocked')return{...summary,state:p!.phase,reason:p!.reason??null};
  fixtureProof(store,event,store.get<any>(`live:fixture:${event.id.split(':').at(-1)}`)?.source,at);
  if(ms(at)>=ms(job.deadline)||ms(at)>=ms(event.startsAt)-120000)throw Error('MULTI_DEADLINE_EXPIRED');if(notificationWindow(at,event.startsAt).quiet)return{...summary,state:'quiet_hours'};
  // Existing models only; all other fixtures are inspected by the same planner
  // and independently prepared by the bounded, supervised research child.
  if(!experimentalForecasts(store,[event.id]).some(f=>hash(f.event)===hash(event)))generateExperimentalForecasts(store,event.id,at,clock);
  const plan=slatePlan(store,config,policy,authority.activation.operatingDate,clock());recordSlatePlan(store,plan,()=>owned(store,owner,clock()));summary.planId=plan.id;summary.coverage=plan.coverage;
  const selected=plan.actions.find(a=>a.jobId===job.id);if(!selected)throw Error('MULTI_EXACT_STAGE_NOT_IN_SLATE');
  if(p!.phase==='requesting'){
   const r=store.db.prepare("SELECT q.id,q.outcome,o.body FROM multi_bookmaker_requests r JOIN quota q ON q.id=r.quota_id LEFT JOIN odds_account_observations o ON o.quota_id=q.id WHERE r.job_id=? AND q.credits>0 AND q.at>=? ORDER BY q.rowid DESC LIMIT 1").get(job.id,p!.requestStartedAt!);
   if(!r){p!.phase='prices';update(store,job,p!,'queued',owner,clock());}
   else{const o=r.body?JSON.parse(String(r.body)):null;if(r.outcome!=='success'||!o?.receiptHash||o.endpoint!==`/v4/sports/basketball_nba/events/${p!.oddsId}/odds`)throw Error('MULTI_INTERRUPTED_REQUEST_UNCERTAIN');const sources=store.db.prepare('SELECT body FROM source_receipts WHERE hash=?').all(o.receiptHash).map(r=>JSON.parse(String(r.body))as Receipt).filter(r=>r.provider==='odds'&&ms(r.retrievedAt)>=ms(p!.requestStartedAt!));if(sources.length!==1)throw Error('MULTI_RECOVERY_RECEIPT_AMBIGUOUS');p!.lastPrice=sources[0];p!.phase='observed';update(store,job,p!,'observed',owner,clock());}
  }
  const http=()=>recurringHTTP(store,config,policyPath,clock,{fetcher:options.fetcher,oddsId:p!.oddsId,multi:{job,event,owner,markets:p!.markets,families:p!.families,sourceStamps:p!.sourceStamps}});
  if(p!.phase!=='observed'){
   if(plan.research.counters.fixturesResearched<plan.research.counters.fixturesDiscovered)return{...summary,state:'full_slate_research_required',reason:'FULL_SLATE_RESEARCH_INCOMPLETE'};
   const potential=selected.eligibleMarkets.length>0;
   if(potential&&plan.budget.grantRemaining>0&&plan.budget.grantRequestsRemaining>0&&['ACCOUNT_EVIDENCE_STALE','UNATTRIBUTED_SHARED_ACCOUNT_USAGE','ACCOUNT_PLAN_OR_HEADERS_CHANGED'].includes(selected.reason??'')){
    const recent=store.db.prepare("SELECT max(at) at FROM quota WHERE provider='odds'").get()as{at:string|null};if(recent.at&&ms(clock())-ms(recent.at)<config.providers.odds.minIntervalSeconds*1000)return{...summary,state:'cooldown'};
    await http().get('/v4/sports',{},0,0,true);return{...summary,state:'account_refreshed',networkRequests:1};
   }
   if(!selected.funded){
    p!.phase='complete';p!.reason=selected.reason??'NO_SOURCE_QUALIFIED_CANDIDATES';const body={version:VERSION,at:clock(),eventId:event.id,jobId:job.id,cycleId:authority.cycleId,activationId:authority.activation.id,grantId:authority.grant.id,planId:plan.id,decision:{state:'NO_VERIFIED_OFFER',reason:p!.reason,omittedMarkets:selected.omittedMarkets},deliveryDecision:'RESEARCH_ONLY'},id=hash(body);
    store.transaction(()=>{owned(store,owner,clock());store.db.prepare('INSERT OR IGNORE INTO multi_bookmaker_decisions VALUES (?,?,?,?)').run(id,body.at,event.id,JSON.stringify({...body,id}));});update(store,job,p!,'complete',owner,clock());return{...summary,reason:p!.reason,state:'omitted',decisionId:id};
   }
   if(plan.next&&plan.next.jobId!==job.id)return{...summary,state:'planner_priority_yield'};
   p!.markets=selected.markets;p!.families=plan.research.fixtures.find(f=>f.event.id===event.id)!.candidates.filter(c=>!c.suppressed&&selected.markets.includes(c.prop)).map(c=>({family:c.family,prop:c.prop,playerId:c.playerId}));p!.planId=plan.id;p!.sourceStamps=plan.research.fixtures.find(f=>f.event.id===event.id)!.sourceStamps;
   const reuse=plan.research.fixtures.find(f=>f.event.id===event.id)!.reusable;
   if(selected.reuse&&reuse){p!.lastPrice=reuse.source;p!.discovery=reuse.discovery;p!.oddsId=JSON.parse(String(store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(reuse.source.hash)!.body)).id;p!.phase='observed';update(store,job,p!,'observed',owner,clock());summary.reused=true;}
   else{
    const recent=store.db.prepare("SELECT max(at) at FROM quota WHERE provider='odds'").get()as{at:string|null};if(recent.at&&ms(clock())-ms(recent.at)<config.providers.odds.minIntervalSeconds*1000)return{...summary,state:'cooldown'};
    if(p!.phase==='events'){
     const page=await http().get('/v4/sports/basketball_nba/events',{},900,0);if(!Array.isArray(page.body))throw Error('MULTI_DISCOVERY_SCHEMA_ERROR');const matches=page.body.filter((e:any)=>e&&e.sport_key==='basketball_nba'&&e.home_team===event.home&&e.away_team===event.away&&typeof e.commence_time==='string'&&e.commence_time.slice(0,10)===event.startsAt.slice(0,10)&&ms(e.commence_time)>=ms(event.startsAt)&&ms(e.commence_time)-ms(event.startsAt)<=15*60000);if(matches.length!==1||!/^[a-zA-Z0-9_-]+$/.test(matches[0].id))throw Error('MULTI_EXACT_FIXTURE_AMBIGUOUS');p!.discovery=page.receipt;p!.oddsId=matches[0].id;p!.phase='prices';update(store,job,p!,'queued',owner,clock());if(!page.cached)return{...summary,state:'fixture_discovered',networkRequests:1};
    }
    if(p!.phase==='prices'){
     p!.phase='requesting';p!.requestStartedAt=clock();update(store,job,p!,'requesting',owner,clock());
     const response=await http().get(`/v4/sports/basketball_nba/events/${p!.oddsId}/odds`,{bookmakers:BOOKMAKERS.join(','),markets:p!.markets!.map(p=>marketKeys[p]).join(','),oddsFormat:'decimal',dateFormat:'iso'},120,p!.markets!.length,true);summary.networkRequests=1;p!.lastPrice=response.receipt;p!.phase='observed';update(store,job,p!,'observed',owner,clock());
    }
   }
  }
  if(p!.phase==='observed'){
   const receipt=p!.lastPrice!;retained(store,receipt,clock());const raw=JSON.parse(String(store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(receipt.hash)!.body)),terms=store.get<{terms:Terms[]}>('multi:terms')?.terms??store.get<{terms:Terms[]}>('suggestions:terms')?.terms??[],normal=normalizeFourBooks(store,raw,receipt,event.id,p!.discovery!,terms,clock()),quotes=normal.quotes.filter(q=>p!.markets!.includes(q.prop));
   const forecasts=m.comparisonEnabled?marketForecasts(store,clock(),[event.id]):[];if(m.comparisonEnabled)archivePricedCandidates(store,quotes,clock());
   const decision=compareOffers(store,quotes,terms,forecasts,clock(),m.enabledMarkets,normal.exclusions,m.comparisonEnabled),body={version:VERSION,at:clock(),jobId:job.id,cycleId:authority.cycleId,activationId:authority.activation.id,grantId:authority.grant.id,researchFingerprint:plan.research.fixtures.find(f=>f.event.id===event.id)!.fingerprint,planId:p!.planId,requestedMarkets:p!.markets,source:receipt,discovery:p!.discovery,normalizationExclusions:normal.exclusions,normalisedQuoteEvidence:quotes,decision,deliveryDecision:m.comparisonEnabled&&m.telegramEnabled?'RECHECK_AT_ISSUE_AND_DISPATCH':'RESEARCH_ONLY'},audit={...body,id:hash(body)};
   store.transaction(()=>{owned(store,owner,clock());store.db.prepare('INSERT OR IGNORE INTO multi_bookmaker_decisions VALUES (?,?,?,?)').run(audit.id,audit.at,event.id,JSON.stringify(audit));});
   let issuance:ReturnType<typeof issueQualifiedSuggestions>|null=null;
   if(m.comparisonEnabled&&m.telegramEnabled){const items=decision.selected.map(o=>({quote:o.quote,forecast:forecasts.find(f=>f.id===o.forecastId)!,terms:terms.find(t=>t.id===o.quote.termsId)!,assessment:o.assessment,marketComparison:{decisionId:audit.id,comparisonAt:decision.at,selectedQuoteHash:hash(o.quote),opposite:o.opposite,alternatives:decision.alternatives[hash(o.quote)].map(a=>a.quote),jobId:job.id,cycleId:authority.cycleId,activationId:authority.activation.id}}));issuance=issueQualifiedSuggestions(store,config,items,clock(),clock,{assertOwner:()=>owned(store,owner,clock())});}
   Object.assign(summary,{source:receipt,state:m.comparisonEnabled?decision.state:'COVERAGE_ONLY',decisionId:audit.id,issuance,availability:decision.availability,excluded:decision.exclusions.length,selected:decision.selected.length,requestedMarkets:p!.markets});p!.phase='complete';update(store,job,p!,'complete',owner,clock());
  }
 }catch(e){const r=(e as Error).message,safe=/^[A-Z_]+$/.test(r)?r:'MULTI_SOURCE_ERROR';if(p?.phase==='requesting'&&['MULTI_SOURCE_PLAN_CHANGED','MULTI_CANDIDATE_PLAN_CHANGED'].includes(safe)&&!store.db.prepare("SELECT q.id FROM multi_bookmaker_requests r JOIN quota q ON q.id=r.quota_id WHERE r.job_id=? AND q.credits>0 AND q.at>=? LIMIT 1").get(job.id,p.requestStartedAt!)){p.phase='prices';p.reason=safe;update(store,job,p,'queued',owner,clock());return{...summary,state:'replan_required',reason:safe};}summary.state='NO_VERIFIED_OFFER';summary.reason=safe;summary.availability=BOOKMAKERS.flatMap(bookmaker=>props.map(prop=>({bookmaker,prop,state:/QUOTA|ALLOWANCE|ACCOUNT|BUDGET/.test(safe)?'QUOTA_BLOCKED':'SOURCE_ERROR',verifiedQuoteSides:0})));
  if(multiClaimed(store,job.id)){const body={version:VERSION,at:clock(),jobId:job.id,source:p?.lastPrice??null,discovery:p?.discovery??null,decision:{state:'NO_VERIFIED_OFFER',reason:safe,availability:summary.availability},deliveryDecision:'BLOCKED'},id=hash(body);store.transaction(()=>{owned(store,owner,clock());store.db.prepare('INSERT OR IGNORE INTO multi_bookmaker_decisions VALUES (?,?,?,?)').run(id,body.at,event.id,JSON.stringify({...body,id}));});p={...(p??{phase:'blocked'}),phase:'blocked',reason:safe};update(store,job,p,'blocked',owner,clock());}
 }
 if(multiClaimed(store,job.id)){owned(store,owner,clock());store.set('multi:last-result',summary);}return summary;
}
