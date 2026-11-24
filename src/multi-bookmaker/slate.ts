import{Store}from'../core/store';
import{hash,ms,nowISO,props,eventSchema,quoteFresh,type Event,type Prop,type Receipt,type Quote}from'../core/domain';
import{localParts}from'../research/schedule';
import{experimentalForecasts,generateExperimentalForecasts,fixtureProof,SUGGESTION_POLICY,type ExperimentalForecast}from'../suggestions/forecasts';
import{currentPlayerEvidence}from'../suggestions/engine';
import{productionRouting}from'../production/router';
import{operatingDate,VERSION}from'./contracts';

export interface SlateFixture{event:Event;source:Receipt;status:string;}
export interface ResearchCandidate{family:string;forecastId:string;playerId:string;prop:Prop;history:number;explicitAvailability:boolean;suppressed:boolean;}
export interface ResearchFixture{event:Event;source:Receipt;researched:boolean;deadlinePassed:boolean;missedTiming:boolean;sourceBlocked:boolean;candidates:ResearchCandidate[];eligibleMarkets:Prop[];exclusions:{playerId?:string;prop?:Prop;reason:string}[];forecastRefs:{id:string;artifactHash:string;inputHash:string}[];priorCoverage:Prop[];priorQualified:Prop[];reusable:null|{source:Receipt;discovery:Receipt;quotes:Quote[]};lastDecision:any;fingerprint:string;sourceStamps:{key:string;valueHash:string}[];}
export function discoverSlate(store:Store,date:string){
 operatingDate.parse(date);const fixtures:SlateFixture[]=[],rejected:{key:string;reason:string}[]=[];
 for(const row of store.db.prepare("SELECT key,value FROM meta WHERE key LIKE 'live:fixture:%'").all())try{
  const f=JSON.parse(String(row.value)),parsed=eventSchema.safeParse(f.event);if(!parsed.success){rejected.push({key:String(row.key),reason:'INVALID_CANONICAL_FIXTURE'});continue;}
  if(parsed.data.league==='NBA'&&f.status==='scheduled'&&localParts(parsed.data.startsAt).date===date)fixtures.push({...f,event:parsed.data});
 }catch{rejected.push({key:String(row.key),reason:'INVALID_FIXTURE_METADATA'});}
 fixtures.sort((a,b)=>ms(a.event.startsAt)-ms(b.event.startsAt)||a.event.id.localeCompare(b.event.id));return{date,timezone:'Australia/Melbourne',fixtures,rejected};
}
export function researchFingerprint(store:Store,fixture:SlateFixture){
 const roster=store.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%' ORDER BY key").all().map(r=>JSON.parse(String(r.value))).filter(p=>[fixture.event.homeId,fixture.event.awayId].includes(p.teamId));
 return hash([fixture,roster,store.get('live:injuries-complete'),roster.map(p=>store.get(`live:injury:${p.playerId.split(':').at(-1)}`)),store.db.prepare('SELECT count(*) n,max(rowid) last FROM logs').get(),store.db.prepare('SELECT id,body FROM research_models ORDER BY id').all()]);
}
/** Same non-price gates as the original assessment; no invented quote, EV,
 * player availability, model promotion or new probability threshold. */
export function researchEligibility(store:Store,f:ExperimentalForecast,at:string){
 if(f.policy!==SUGGESTION_POLICY||f.validated!==false||f.inputHash!==hash(f.inputs)||ms(f.at)>ms(at)||ms(f.at)>=ms(f.event.startsAt)-120000)throw Error('FROZEN_FORECAST_INVALID');
 if(f.n<10||f.currentSeasonGames<5||ms(at)-ms(f.lastGameAt)>30*86400000||f.expectedMinutes<18||f.minutesSD>6||f.teamChanged)throw Error('HISTORY_ROLE_OR_MINUTES_INSUFFICIENT');
 currentPlayerEvidence(store,f,at);
}
function placedFamilies(store:Store){
 const set=new Set(store.db.prepare('SELECT family FROM experimental_suggestions').all().map(r=>String(r.family)));
 if(store.db.prepare("SELECT name FROM sqlite_master WHERE name='confirmed_placement_families'").get())for(const r of store.db.prepare('SELECT family FROM confirmed_placement_families').all())set.add(String(r.family));
 for(const r of store.db.prepare("SELECT s.family FROM experimental_annotations a JOIN experimental_suggestions s ON s.id=a.signal_id WHERE json_extract(a.body,'$.placed')='placed'").all())set.add(String(r.family));return set;
}
export function retainedDecisions(store:Store,eventId:string,at:string){
 if(!store.db.prepare("SELECT name FROM sqlite_master WHERE name='multi_bookmaker_decisions'").get())return[];
 return store.db.prepare('SELECT body FROM multi_bookmaker_decisions WHERE event_id=? AND at<=? ORDER BY at DESC,id DESC').all(eventId,at).flatMap(row=>{try{const d=JSON.parse(String(row.body)),{id,...body}=d;if(hash(body)!==id||d.source?.simulated||!d.source||ms(d.source.retrievedAt)>ms(at)||!store.hasReceipt(d.source))return[];return[d];}catch{return[];}});
}
/** Read-only inspection. It never creates forecasts, jobs, receipts, quota,
 * recommendations, placements or notification records. */
export function readSnapshot<T>(store:Store,fn:()=>T):T{const outer=store.db.isTransaction;if(!outer)store.db.exec('BEGIN DEFERRED');try{return fn();}finally{if(!outer&&store.db.isTransaction)store.db.exec('ROLLBACK');}}
export function inspectSlate(store:Store,date:string,at:string,options:{previewMissing?:boolean;clock?:()=>string}={}){return readSnapshot(store,()=>inspectSnapshot(store,date,at,options));}
function inspectSnapshot(store:Store,date:string,at:string,options:{previewMissing?:boolean;clock?:()=>string}){
 const found=discoverSlate(store,date),routing={advancedAssists:0,originalPrecomputed:0,originalFallbacks:0,sourceBlocked:0,artifactMismatch:0},suppressed=placedFamilies(store),roster=store.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%'").all().map(r=>JSON.parse(String(r.value)));
 const fixtures:ResearchFixture[]=found.fixtures.map(f=>{
  const routed=productionRouting(store,at,[f.event.id]);for(const key of Object.keys(routing)as(keyof typeof routing)[])routing[key]+=routed.counts[key];const fingerprint=researchFingerprint(store,f),exclusions:ResearchFixture['exclusions']=[],candidates:ResearchCandidate[]=[],missedTiming=ms(at)>=ms(f.event.startsAt)-120000;let forecasts=routed.forecasts.filter(p=>p.event.id===f.event.id&&hash(p.event)===hash(f.event)),previewAttempted=false;if(options.previewMissing&&!missedTiming){previewAttempted=true;try{const result=generateExperimentalForecasts(store,f.event.id,at,options.clock??nowISO,{persist:false});exclusions.push(...result.exclusions);const originals=result.forecasts??[];forecasts=originals.map(p=>routed.forecasts.find(r=>r.playerId===p.playerId&&r.prop===p.prop&&r.teamId===p.teamId)??p);}catch(e){exclusions.push({reason:(e as Error).message});}}
  let sourceBlocked=false;try{fixtureProof(store,f.event,f.source,at);}catch(e){sourceBlocked=!missedTiming;exclusions.push({reason:missedTiming?'PREGAME_DEADLINE_PASSED':(e as Error).message});}
  const players=roster.filter(p=>[f.event.homeId,f.event.awayId].includes(p.teamId));if(!players.length){sourceBlocked=true;exclusions.push({reason:'NO_CURRENT_CANONICAL_ROSTER'});}
  const evidence=new Map<string,string|null>();
  for(const player of players)for(const prop of props){
   const matches=forecasts.filter(p=>p.playerId===player.playerId&&p.teamId===player.teamId&&p.prop===prop);if(matches.length!==1){exclusions.push({playerId:player.playerId,prop,reason:matches.length?'AMBIGUOUS_FORECAST':'NO_FROZEN_FORECAST'});continue;}
   const prediction=matches[0];try{
    if(sourceBlocked||missedTiming)throw Error(missedTiming?'PREGAME_DEADLINE_PASSED':'FIXTURE_SOURCE_BLOCKED');
    // Cache source validation by immutable identity within this read snapshot.
    const key=hash([f.event,player.playerId,player.teamId]);if(!evidence.has(key)){try{currentPlayerEvidence(store,prediction,at);evidence.set(key,null);}catch(e){evidence.set(key,(e as Error).message);}}if(evidence.get(key))throw Error(evidence.get(key)!);
    if(prediction.policy!==SUGGESTION_POLICY||prediction.validated!==false||prediction.inputHash!==hash(prediction.inputs)||ms(prediction.at)>ms(at)||ms(prediction.at)>=ms(f.event.startsAt)-120000)throw Error('FROZEN_FORECAST_INVALID');
    if(prediction.n<10||prediction.currentSeasonGames<5||ms(at)-ms(prediction.lastGameAt)>30*86400000||prediction.expectedMinutes<18||prediction.minutesSD>6||prediction.teamChanged)throw Error('HISTORY_ROLE_OR_MINUTES_INSUFFICIENT');
    const family=hash([f.event.id,player.playerId,prop]),injury=store.get<{status:string;observedAt:string}>(`live:injury:${player.playerId.split(':').at(-1)}`);
    candidates.push({family,forecastId:prediction.id,playerId:player.playerId,prop,history:prediction.n,explicitAvailability:!!injury&&injury.status.toLowerCase()==='available'&&ms(injury.observedAt)<=ms(at)&&ms(at)-ms(injury.observedAt)<4*3600000,suppressed:suppressed.has(family)});
   }catch(e){exclusions.push({playerId:player.playerId,prop,reason:(e as Error).message});}
  }
  const prior=retainedDecisions(store,f.event.id,at),lastDecision=prior[0]??null,quotes:Quote[]=lastDecision?.normalisedQuoteEvidence??[],fresh=quotes.filter(q=>quoteFresh(q,at,180,120)),priorCoverage=props.filter(prop=>prior.some(d=>d.decision?.availability?.some((r:any)=>r.prop===prop&&r.state==='AVAILABLE_VERIFIED'))),priorQualified=props.filter(prop=>prior.some(d=>d.decision?.offers?.some((o:any)=>o.quote.prop===prop)));
  const checkpoint=store.get<{fingerprint:string;complete:boolean}>(`multi:research:${date}:${f.event.id}`);
  return{event:f.event,source:f.source,researched:previewAttempted||!!forecasts.length||!!checkpoint,deadlinePassed:missedTiming,missedTiming:missedTiming&&!priorCoverage.length,sourceBlocked:sourceBlocked||!forecasts.length||!candidates.length&&exclusions.some(e=>/missing|stale|unretained|fresh|ambiguous|identity/i.test(e.reason)),candidates,eligibleMarkets:props.filter(prop=>candidates.some(p=>p.prop===prop&&!p.suppressed)),exclusions,forecastRefs:forecasts.map(p=>({id:p.id,artifactHash:p.artifactHash,inputHash:p.inputHash})),priorCoverage,priorQualified,reusable:fresh.length&&lastDecision.discovery?{source:lastDecision.source,discovery:lastDecision.discovery,quotes:fresh}:null,lastDecision,fingerprint,sourceStamps:[...new Set([`live:fixture:${f.event.id.split(':').at(-1)}`,'live:injuries-complete',...candidates.flatMap(p=>[`live:roster:${p.playerId.split(':').at(-1)}`,`live:injury:${p.playerId.split(':').at(-1)}`])])].map(key=>({key,valueHash:hash(store.get(key))}))};
 });
 return{at,date,timezone:'Australia/Melbourne',implementation:VERSION,researchMode:options.previewMissing?'READ_ONLY_PREVIEW':'REGISTERED_FORECASTS',fixtures,rejected:found.rejected,routing,counters:{fixturesDiscovered:fixtures.length,fixturesResearched:fixtures.filter(f=>f.researched).length,eligiblePlayerPropCandidates:fixtures.reduce((n,f)=>n+f.candidates.filter(c=>!c.suppressed).length,0),suppressedFamilies:fixtures.reduce((n,f)=>n+f.candidates.filter(c=>c.suppressed).length,0),fixturesWithBookmakerQuotations:fixtures.filter(f=>f.priorCoverage.length).length,fixturesWithFreshQuotations:fixtures.filter(f=>f.reusable).length,eligibleMarketsWithValidQuotations:fixtures.reduce((n,f)=>n+f.eligibleMarkets.filter(prop=>f.reusable?.quotes.some(q=>q.prop===prop)).length,0),fixturesBlockedByMissingData:fixtures.filter(f=>f.sourceBlocked&&!f.missedTiming).length,fixturesMissedBecauseOfTiming:fixtures.filter(f=>f.missedTiming).length,fixturesWithoutEligibleCandidates:fixtures.filter(f=>!f.candidates.some(c=>!c.suppressed)).length}};
}
export function installSlateResearch(store:Store){store.db.exec(`CREATE TABLE IF NOT EXISTS multi_slate_research(id TEXT PRIMARY KEY,at TEXT NOT NULL,operating_date TEXT NOT NULL,event_id TEXT NOT NULL,body TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS experimental_forecasts_event_player_prop ON experimental_forecasts(event_id,player_id,prop);
 CREATE TRIGGER IF NOT EXISTS immutable_multi_slate_research_update BEFORE UPDATE ON multi_slate_research BEGIN SELECT RAISE(ABORT,'Slate research is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS immutable_multi_slate_research_delete BEFORE DELETE ON multi_slate_research BEGIN SELECT RAISE(ABORT,'Slate research is immutable'); END;`);}
/** Bounded, resumable local research only. A supervised market child supplies
 * ownership fences and a wall-clock deadline. Paid acquisition is independent. */
export function researchSlateBatch(store:Store,date:string,at:string,options:{clock?:()=>string;assertOwner?:()=>void;maxFixtures?:number;codeCommit?:string|null}={}){
 if(localParts(at).date<'2026-11-25'||date<'2026-11-25')throw Error('PROTECTED_OPERATING_DATE');const clock=options.clock??nowISO,check=options.assertOwner??(()=>{}),max=options.maxFixtures??1;if(!Number.isInteger(max)||max<1||max>30)throw Error('BOUNDED_RESEARCH_BATCH_REQUIRED');
 installSlateResearch(store);const processed:unknown[]=[];
 for(const fixture of discoverSlate(store,date).fixtures){
  const fingerprint=researchFingerprint(store,fixture),key=`multi:research:${date}:${fixture.event.id}`,prior=store.get<{fingerprint:string}>(key);if(prior?.fingerprint===fingerprint)continue;if(processed.length>=max)break;check();
  let result:unknown,complete=false;try{result=generateExperimentalForecasts(store,fixture.event.id,at,clock);complete=true;}catch(e){result={reason:(e as Error).message};}check();
  const body={implementation:VERSION,codeCommit:options.codeCommit??null,at:clock(),operatingDate:date,event:fixture.event,source:fixture.source,fingerprint,complete,result,forecastRefs:experimentalForecasts(store,[fixture.event.id]).map(f=>({id:f.id,at:f.at,artifactHash:f.artifactHash,inputHash:f.inputHash})),providerRequests:0,outboundMessages:0},id=hash(body);
  store.transaction(()=>{check();store.db.prepare('INSERT OR IGNORE INTO multi_slate_research VALUES (?,?,?,?,?)').run(id,body.at,date,fixture.event.id,JSON.stringify({...body,id}));store.set(key,{at:body.at,id,fingerprint,complete});check();});processed.push({eventId:fixture.event.id,complete,result});
 }
 return{at,date,processed,slate:inspectSlate(store,date,clock()),providerRequests:0,outboundMessages:0};
}
export function nextSlateResearch(store:Store,at:string){
 if(localParts(at).date<'2026-11-25')return null;
 const fixtures=store.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:fixture:%'").all().flatMap(r=>{try{const f=JSON.parse(String(r.value)),e=eventSchema.parse(f.event);return f.status==='scheduled'&&e.league==='NBA'&&ms(e.startsAt)>ms(at)+120000&&ms(e.startsAt)<=ms(at)+48*3600000?[f as SlateFixture]:[];}catch{return[];}}).sort((a,b)=>ms(a.event.startsAt)-ms(b.event.startsAt)||a.event.id.localeCompare(b.event.id));
 for(const f of fixtures){const date=localParts(f.event.startsAt).date,fingerprint=researchFingerprint(store,f),previous=store.get<{fingerprint:string}>(`multi:research:${date}:${f.event.id}`);if(previous?.fingerprint!==fingerprint)return{date,eventId:f.event.id,fingerprint};}return null;
}
