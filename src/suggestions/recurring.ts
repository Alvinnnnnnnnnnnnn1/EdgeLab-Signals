import{slatePlan}from'../multi-bookmaker/planner';
import {runMultiStage,multiClaimed,multiTarget} from '../multi-bookmaker/runtime';
import {marketForecasts} from '../production/router';
import {Store} from '../core/store';
import {hash,ms,nowISO,type Event,type Receipt,type Terms} from '../core/domain';
import type {Config} from '../core/config';
import type {Fetcher} from '../providers/http';
import {normalizeOdds,marketKeys} from '../providers/odds';
import {Telegram} from '../core/telegram';
import {notificationWindow,researchSchedule} from '../research/schedule';
import {buildSportsbetRegistry} from './cycle';
import {upcomingFixtures,fixtureProof,retained,generateExperimentalForecasts,experimentalForecasts,SUGGESTION_POLICY} from './forecasts';
import {rankAndIssue,dispatchSuggestions,settleSuggestions,scoreExperimentalForecasts,currentPlayerEvidence} from './engine';
import {recurringHTTP,recurringBudget,readRecurringPolicy,type RecurringPolicy} from './recurring-policy';

type Job={id:string;event_id:string;stage:string;due_at:string;deadline:string;state:string;body:string;error:string|null};
type Body={event:Event;manualVerification?:boolean;retryAt?:string;discovery?:Receipt;oddsId?:string;lastPrice?:Receipt;selection?:unknown;reservationFloor?:number;requestStartedAt?:string};
function setJob(store:Store,job:Job,state:string,body:Body,error:string|null=null){store.db.prepare('UPDATE recurring_market_jobs SET state=?,body=?,error=? WHERE id=?').run(state,JSON.stringify(body),error,job.id);}
export function seedRecurringJobs(store:Store,at:string,earlyFixtureId?:string){
  for(const fixture of upcomingFixtures(store,at)){
    for(const minutes of [90,20]){const due=new Date(ms(fixture.event.startsAt)-minutes*60000).toISOString(),deadline=new Date(minutes===90?ms(due)+15*60000:ms(fixture.event.startsAt)-120000).toISOString();
      store.db.prepare("INSERT OR IGNORE INTO recurring_market_jobs VALUES (?,?,?,?,?,'queued',?,NULL)").run(hash([hash(fixture.event),minutes]),fixture.event.id,`T-${minutes}`,due,deadline,JSON.stringify({event:fixture.event}));
    }
    if(fixture.event.id===earlyFixtureId){store.db.prepare("INSERT OR IGNORE INTO recurring_market_jobs VALUES (?,?,?,?,?,'queued',?,NULL)").run(hash([hash(fixture.event),'early']),fixture.event.id,'early',at,new Date(Math.min(ms(at)+15*60000,ms(fixture.event.startsAt)-120000)).toISOString(),JSON.stringify({event:fixture.event,manualVerification:true}));}
  }
}
function termsEvidence(store:Store,at:string){const terms=store.get<{terms:Terms[]}>('suggestions:terms')?.terms;if(!terms||terms.length!==4)throw new Error('SPORTSBET_TERMS_MISSING');for(const t of terms){retained(store,t.source,at);if(ms(at)-ms(t.source.retrievedAt)>30*86400000)throw new Error('SPORTSBET_TERMS_STALE');}return terms;}
export function evaluationInputVersion(store:Store){return hash([store.db.prepare('SELECT max(rowid) AS n FROM logs').get(),store.db.prepare('SELECT count(*) AS n FROM experimental_forecasts').get(),store.db.prepare('SELECT count(*) AS n FROM experimental_candidates').get()]);}
export function reconcileHypothetical(store:Store,at:string){
  const settlement=settleSuggestions(store,at),version=evaluationInputVersion(store);
  if(store.get('recurring:evaluation-version')!==version){try{const report=scoreExperimentalForecasts(store,at);store.set('recurring:evaluation-version',version);store.set('recurring:evaluation',{at,report});}catch{store.set('recurring:evaluation-error',{at,reason:'BACKEND_EVALUATION_FAILED; acquisition and outcome grading remain independent'});}}
  return settlement;
}
export async function recurringCycle(store:Store,config:Config,policyPath:string,options:{clock?:()=>string;fetcher?:Fetcher;transport?:Telegram;earlyFixtureId?:string}={}){
  const clock=options.clock??nowISO,at=clock(),result:Record<string,unknown>={at,state:'waiting',networkRequests:0};
  if(config.operatingMode==='disabled')return Object.assign(result,{state:'disabled'});
  // Grading precedes all policy and acquisition checks, including expiry.
  result.grading=settleSuggestions(store,at);
  if(!config.liveSuggestionsEnabled)return Object.assign(result,{state:'new_suggestions_disabled'});
  const lease=store.acquire('experimental-cycle',at,150);if(!lease)return Object.assign(result,{state:'busy'});
  const before=Number((store.db.prepare("SELECT count(*) AS n FROM quota WHERE provider='odds'").get() as {n:number}).n);
  let selected:Job|undefined;
  try{
    const policy=readRecurringPolicy(policyPath,clock());seedRecurringJobs(store,at,options.earlyFixtureId);
    store.db.prepare("UPDATE recurring_market_jobs SET state='expired',error='Missed original pregame deadline' WHERE deadline<=? AND state NOT IN ('complete','expired')").run(at);
    for(const job of store.db.prepare("SELECT * FROM recurring_market_jobs WHERE state='requesting'").all() as unknown as Job[]){
      if(multiClaimed(store,job.id)){store.db.prepare("UPDATE recurring_market_jobs SET state='observed' WHERE id=? AND state='requesting'").run(job.id);continue;}
      const b=JSON.parse(job.body) as Body,rows=store.db.prepare("SELECT q.id,q.outcome,o.body FROM quota q LEFT JOIN odds_account_observations o ON o.quota_id=q.id WHERE q.provider='odds' AND q.rowid>? ORDER BY q.rowid LIMIT 2").all(b.reservationFloor??Number.MAX_SAFE_INTEGER) as {id:string;outcome:string;body:string|null}[];
      if(!rows.length){setJob(store,job,'queued',b,'Recovered before transport reservation');continue;}
      const observation=rows.length===1&&rows[0].body?JSON.parse(rows[0].body) as {receiptHash:string|null;endpoint:string}:null;
      if(!observation?.receiptHash||observation.endpoint!==`/v4/sports/basketball_nba/events/${b.oddsId}/odds`)throw new Error('INTERRUPTED_MARKET_REQUEST_REQUIRES_ACCOUNT_RECONCILIATION');
      const sources=store.db.prepare('SELECT body FROM source_receipts WHERE hash=?').all(observation.receiptHash) as {body:string}[];
      b.lastPrice=sources.map(r=>JSON.parse(r.body) as Receipt).filter(r=>r.provider==='odds'&&ms(r.retrievedAt)>=ms(b.requestStartedAt??job.due_at)).sort((a,c)=>ms(c.retrievedAt)-ms(a.retrievedAt))[0];
      if(!b.lastPrice)throw new Error('INTERRUPTED_MARKET_SOURCE_EVIDENCE_MISSING');setJob(store,job,'observed',b,'Recovered genuine response; no repeated paid request');
    }
    const jobs=store.db.prepare("SELECT * FROM recurring_market_jobs WHERE state IN ('queued','deferred','observed') AND due_at<=? AND deadline>? ORDER BY CASE stage WHEN 'T-20' THEN 0 WHEN 'T-90' THEN 1 ELSE 2 END,deadline,id").all(at,at) as unknown as Job[];
    selected=jobs.find(j=>{const b=JSON.parse(j.body) as Body;return!b.retryAt||ms(b.retryAt)<=ms(at);});
    if(selected&&multiTarget(store,config,selected,JSON.parse(selected.body).event,at)){const marker=store.get<{operatingDate?:string}>('multi:active-release');if(marker?.operatingDate){const plan=slatePlan(store,config,policy,marker.operatingDate,at),next=jobs.find(j=>j.id===plan.next?.jobId);if(next)selected=next;}}
    if(!selected){
      // Initial/ongoing prospective forecasts are independent of market funding.
      const next=upcomingFixtures(store,at).find(f=>ms(f.event.startsAt)-ms(at)<=24*3600000&&!store.get(`suggestions:forecast-complete:${SUGGESTION_POLICY}:${hash(f.event)}`));
      if(next&&researchSchedule(at).activeWindow){try{const f=generateExperimentalForecasts(store,next.event.id,at,clock);store.set(`suggestions:forecast-complete:${SUGGESTION_POLICY}:${hash(next.event)}`,{at:clock(),...f});result.forecasts=f;}catch{result.forecasts='CURRENT_SOURCE_EVIDENCE_REQUIRED';}}
      return result;
    }
    const body=JSON.parse(selected.body) as Body,current=upcomingFixtures(store,at).find(f=>f.event.id===selected!.event_id);
    if(!current||hash(current.event)!==hash(body.event)){setJob(store,selected,'expired',body,'Fixture canceled or rescheduled');return Object.assign(result,{state:'fixture_changed'});}
    if(ms(selected.deadline)-ms(at)<60000){setJob(store,selected,'expired',body,'Insufficient time for fresh acquisition and delivery');return Object.assign(result,{state:'deadline_expired'});}
    const window=notificationWindow(at,new Date(ms(body.event.startsAt)-120000).toISOString());
    if(window.quiet){body.retryAt=window.nextAt;setJob(store,selected,ms(window.nextAt)>=ms(selected.deadline)?'expired':'deferred',body,'MELBOURNE_QUIET_HOURS');return Object.assign(result,{state:'quiet_hours'});}
    const multi=await runMultiStage(store,config,policyPath,selected,body.event,lease,{clock,fetcher:options.fetcher});if(multi)return Object.assign(result,multi);
    fixtureProof(store,current.event,current.source,at);const terms=termsEvidence(store,at);
    if(!experimentalForecasts(store,[body.event.id]).some(f=>hash(f.event)===hash(body.event))){const f=generateExperimentalForecasts(store,body.event.id,at,clock);result.forecasts=f;if(!f.inserted&&!f.existing)throw new Error('INSUFFICIENT_PLAYER_FORECAST_EVIDENCE');}
    const candidates=marketForecasts(store,at,[body.event.id]).filter(f=>hash(f.event)===hash(body.event)&&f.n>=10&&f.currentSeasonGames>=5&&f.expectedMinutes>=18&&f.minutesSD<=6&&!f.teamChanged);
    if(!candidates.some(f=>{try{currentPlayerEvidence(store,f,at);return true;}catch{return false;}}))throw new Error('INSUFFICIENT_CURRENT_PLAYER_EVIDENCE');
    const finishObservation=(receipt:Receipt,raw:unknown)=>{
      const registry=buildSportsbetRegistry(store,raw as Parameters<typeof buildSportsbetRegistry>[1],body.event.id,body.discovery!,clock()),normalized=normalizeOdds(raw,receipt,registry,terms,'sportsbet',true);
      const selection=rankAndIssue(store,config,normalized.quotes,terms,clock(),clock);body.lastPrice=receipt;body.selection=selection;
      store.set('suggestions:last-market',{at:clock(),source:receipt,quotes:normalized.quotes.length,exclusions:normalized.exclusions,bookmaker:'sportsbet'});
      setJob(store,selected!,'complete',body,normalized.quotes.length?null:'NO_EXACT_CURRENT_MARKETS');result.selection=selection;result.state='complete';
    };
    if(selected.state==='observed'&&body.lastPrice){retained(store,body.lastPrice,at);const raw=JSON.parse((store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(body.lastPrice.hash) as {body:string}).body);finishObservation(body.lastPrice,raw);return result;}
    const recent=store.db.prepare("SELECT max(at) AS at FROM quota WHERE provider='odds'").get() as {at:string|null};
    if(recent.at&&ms(at)-ms(recent.at)<config.providers.odds.minIntervalSeconds*1000)return Object.assign(result,{state:'cooldown'});
    let budget:ReturnType<typeof recurringBudget>;
    try{budget=recurringBudget(store,policy,at);}catch(e){
      const reason=e instanceof Error?e.message:'';
      if(['ACCOUNT_EVIDENCE_STALE','UNATTRIBUTED_SHARED_ACCOUNT_USAGE','ACCOUNT_PLAN_OR_HEADERS_CHANGED'].includes(reason)){
        const response=await recurringHTTP(store,config,policyPath,clock,{fetcher:options.fetcher}).get('/v4/sports',{},0,0,true);result.accountEvidence=response.receipt;result.state='account_refreshed';return result;
      }throw e;
    }
    result.budget=budget;
    if(budget.dailyRemaining<4){body.retryAt=new Date(ms(`${at.slice(0,10)}T00:00:00Z`)+86400000).toISOString();setJob(store,selected,'deferred',body,'DAILY_OR_PROTECTED_CREDIT_BUDGET');return Object.assign(result,{state:'budget_exhausted'});}
    if(selected.stage==='T-90'){
      const primary=Number((store.db.prepare("SELECT count(*) AS n FROM recurring_market_jobs WHERE stage='T-20' AND state IN ('queued','deferred') AND due_at LIKE ? AND deadline>?").get(`${at.slice(0,10)}%`,at) as {n:number}).n);
      if(budget.dailyRemaining<4+Math.min(primary*4,budget.dailyRemaining)){body.retryAt=new Date(ms(at)+5*60000).toISOString();setJob(store,selected,'deferred',body,'CREDITS_RESERVED_FOR_PRIMARY_T20_COVERAGE');return Object.assign(result,{state:'primary_coverage_reserved'});}
    }
    if(!body.discovery||ms(at)-ms(body.discovery.retrievedAt)>=900000){
      const page=await recurringHTTP(store,config,policyPath,clock,{fetcher:options.fetcher}).get('/v4/sports/basketball_nba/events',{},900,0);
      if(!Array.isArray(page.body))throw new Error('NBA_DISCOVERY_SCHEMA_ERROR');const matches=page.body.filter(e=>e.sport_key==='basketball_nba'&&e.home_team===body.event.home&&e.away_team===body.event.away&&e.commence_time.slice(0,10)===body.event.startsAt.slice(0,10)&&ms(e.commence_time)>=ms(body.event.startsAt)&&ms(e.commence_time)-ms(body.event.startsAt)<=15*60000);
      if(matches.length!==1||!/^[a-zA-Z0-9_-]+$/.test(matches[0].id))throw new Error('EXACT_BOOKMAKER_FIXTURE_MISSING');
      body.discovery=page.receipt;body.oddsId=matches[0].id;setJob(store,selected,'queued',body);
      if(!page.cached)return Object.assign(result,{state:'fixture_discovered'});
    }
    // Exactly one current price observation serves discovery, selection and send
    // revalidation. Do not pay for an immediate identical second refresh.
    body.reservationFloor=Number((store.db.prepare("SELECT coalesce(max(rowid),0) AS n FROM quota WHERE provider='odds'").get() as {n:number}).n);body.requestStartedAt=clock();setJob(store,selected,'requesting',body);
    try{
      const response=await recurringHTTP(store,config,policyPath,clock,{fetcher:options.fetcher,oddsId:body.oddsId}).get(`/v4/sports/basketball_nba/events/${body.oddsId}/odds`,{bookmakers:'sportsbet',markets:Object.values(marketKeys).join(','),oddsFormat:'decimal',dateFormat:'iso'},120,4,true);
      body.lastPrice=response.receipt;setJob(store,selected,'observed',body);finishObservation(response.receipt,response.body);
    }catch(e){
      const debit=store.db.prepare("SELECT o.body FROM quota q JOIN odds_account_observations o ON o.quota_id=q.id WHERE q.rowid>? AND q.provider='odds' ORDER BY q.rowid DESC LIMIT 1").get(body.reservationFloor??Number.MAX_SAFE_INTEGER) as {body:string}|undefined;
      const paid=debit&&Number(JSON.parse(debit.body).charged)>0;
      setJob(store,selected,body.lastPrice||paid?'blocked':'deferred',{...body,retryAt:new Date(ms(clock())+5*60000).toISOString()},'ACQUISITION_OR_PRICE_EVIDENCE_FAILED');throw e;
    }
  }catch(e){const message=e instanceof Error?e.message:'RECURRING_CYCLE_FAILED';result.state='blocked';result.reason=/^[A-Z][A-Z0-9_ ;:-]+$/.test(message)?message:'SOURCE_OR_ACCOUNT_EVIDENCE_REQUIRED';
    if(selected&&(!multiClaimed(store,selected.id)||store.leaseValid('experimental-cycle',lease,clock()))){const current=store.db.prepare('SELECT body,state FROM recurring_market_jobs WHERE id=?').get(selected.id) as {body:string;state:string};if(!['complete','blocked','expired'].includes(current.state)){const body=JSON.parse(current.body) as Body;body.retryAt=new Date(ms(clock())+5*60000).toISOString();setJob(store,selected,'deferred',body,String(result.reason));}}
  }finally{
    try{result.delivery=selected&&multiClaimed(store,selected.id)&&!store.leaseValid('experimental-cycle',lease,clock())?{state:'ownership_lost'}:await dispatchSuggestions(store,config,options.transport??new Telegram(config,store,options.fetcher,clock),clock);}catch{result.delivery={state:'dispatch_error'};}
    result.at=clock();result.networkRequests=Number((store.db.prepare("SELECT count(*) AS n FROM quota WHERE provider='odds'").get() as {n:number}).n)-before;
    if(!selected||!multiClaimed(store,selected.id)||store.leaseValid('experimental-cycle',lease,clock()))store.set('recurring:last-run',result);store.release('experimental-cycle',lease);
  }
  return result;
}
