import {evaluateOpportunities} from '../opportunities/engine';
import {persistOpportunityRows,persistOpportunityObservations,type OpportunityOwner} from '../opportunities/journal';
import {exposureBlock} from './exposure';
import{hasPlacedFamily}from'./placements';
import {marketMessage} from '../multi-bookmaker/message';
import {BOOKMAKERS,type Bookmaker} from '../multi-bookmaker/contracts';
import {assertMultiDelivery,type MultiEvidence} from '../multi-bookmaker/delivery-policy';
import {marketForecasts} from '../production/router';
import {assertTrialFreshness} from '../m1-trial/context';
import {randomUUID} from 'node:crypto';
import {Store,type Outcome} from '../core/store';
import {compactExistingBatch} from './compact-message';
import {hash,ms,quoteSchema,termsSchema,quoteFresh,ev,type Quote,type Terms,type Prop,type GameLog} from '../core/domain';
import type {Config} from '../core/config';
import {probabilities} from '../core/models';
import {grade} from '../core/settlement';
import {Telegram,TelegramFailure,telegramBinding} from '../core/telegram';
import {notificationWindow,MELBOURNE} from '../research/schedule';
import {comparableSides} from '../research/markets';
import {experimentalForecasts,fixtureProof,rosterProof,retained,SUGGESTION_POLICY,type ExperimentalForecast} from './forecasts';
import {scoreRows,pairedDifference,type ScoredPrediction} from '../research/scoring';
import {thresholds} from '../research/experiment';
import {ensureSuggestionFamilies,duplicateFamilyDelivery} from './families';

export interface Suggestion {id:string;at:string;quote:Quote;forecastId:string;forecast:ExperimentalForecast;win:number;push:number;estimatedEV:number;conservativeEV:number;disagreement:number;score:number;reasoning:string;confidence:string;terms:Terms;hypotheticalStakeAUD:5;experimental:true;validated:false;supersedes:string|null;issueEvidence?:ReturnType<typeof currentPlayerEvidence>;marketComparison?:MultiEvidence;exposurePolicy?:{id:string;hash:string;maxPerFixture:number;maxPerPlayerFixture:number};}
export function suggestions(store:Store):Suggestion[]{return(store.db.prepare('SELECT body FROM experimental_suggestions ORDER BY at,id').all() as {body:string}[]).map(r=>JSON.parse(r.body));}
export function currentPlayerEvidence(store:Store,f:ExperimentalForecast,at:string){
  assertTrialFreshness(store,f,at);
  const current=store.get<{event:Quote['event'];source:Quote['source'];status:string}>(`live:fixture:${f.event.id.split(':').at(-1)}`);
  if(!current||current.status!=='scheduled'||hash(current.event)!==hash(f.event))throw new Error('Fixture changed or canceled');fixtureProof(store,current.event,current.source,at);
  const p=store.get<{playerId:string;teamId:string;observedAt:string;source:Quote['source']}>(`live:roster:${f.playerId.split(':').at(-1)}`);if(!p||p.teamId!==f.teamId)throw new Error('Current roster identity changed');rosterProof(store,p,at);
  const complete=store.get<{at:string;source:Quote['source']}>('live:injuries-complete');if(!complete||ms(complete.at)>ms(at)||ms(at)-ms(complete.at)>4*3600000)throw new Error('Fresh completed injury source missing');retained(store,complete.source,at);
  const injury=store.get<{status:string;observedAt:string;source:Quote['source']}>(`live:injury:${f.playerId.split(':').at(-1)}`);
  if(injury&&ms(injury.observedAt)<=ms(at)&&ms(at)-ms(injury.observedAt)<4*3600000){retained(store,injury.source,at);if(injury.status.toLowerCase()!=='available')throw new Error('Player listed on current injury evidence: '+injury.status);}
  return{fixture:current.source,roster:p.source,injurySnapshot:complete.source,availability:'unconfirmed_not_assumed',conditionalOnParticipating:true};
}
export function assessSuggestion(q:Quote,paired:Quote,f:ExperimentalForecast,terms:Terms,at:string){return assessOffer(q,paired,f,terms,at,'sportsbet');}
export function assessBookmakerOffer(q:Quote,paired:Quote,f:ExperimentalForecast,terms:Terms,at:string){if(!BOOKMAKERS.includes(q.bookmaker as Bookmaker))throw new Error('BOOKMAKER_NOT_ALLOWLISTED');return assessOffer(q,paired,f,terms,at,q.bookmaker);}
function assessOffer(q:Quote,paired:Quote,f:ExperimentalForecast,terms:Terms,at:string,bookmaker:string){
  quoteSchema.parse(q);termsSchema.parse(terms);
  if(q.bookmaker!==bookmaker||q.event.league!=='NBA'||hash(q.event)!==hash(f.event)||q.playerId!==f.playerId||q.teamId!==f.teamId||q.prop!==f.prop||q.termsId!==terms.id||terms.bookmaker!==bookmaker||terms.prop!==q.prop||terms.league!=='NBA')throw new Error(bookmaker==='sportsbet'?'Exact Sportsbet identity/settlement mismatch':'Exact bookmaker identity/settlement mismatch');
  if(f.policy!==SUGGESTION_POLICY||f.validated!==false||f.inputHash!==hash(f.inputs)||ms(f.at)>ms(at)||ms(f.at)>=ms(f.event.startsAt)-120000||!quoteFresh(q,at,180,120))throw new Error('Forecast or pregame quote invalid/stale');
  if(f.n<10||f.currentSeasonGames<5||ms(at)-ms(f.lastGameAt)>30*86400000||f.expectedMinutes<18||f.minutesSD>6||f.teamChanged)throw new Error('History, role or minutes insufficient');
  const market=q.side==='over'?comparableSides(q,paired):comparableSides(paired,q),p=probabilities(f.distribution,q.line,q.side),base=probabilities(f.baseline,q.line,q.side),challenger=probabilities(f.challenger,q.line,q.side);
  const disagreement=Math.max(Math.abs(p.win-base.win),Math.abs(p.win-challenger.win)),estimatedEV=ev(p.win,p.push,q.decimalOdds);
  const sensitivity=[f.distribution,f.baseline,f.challenger,...f.stress].map(d=>{const s=probabilities(d,q.line,q.side),penalty=.5*Math.sqrt(s.win*(1-s.win)/f.n);return ev(Math.max(0,s.win-penalty),s.push,q.decimalOdds);}),conservativeEV=Math.min(...sensitivity);
  if(q.decimalOdds<1.5||q.decimalOdds>2.4||p.win<.55||p.win>.85||disagreement>.12||estimatedEV<.04||conservativeEV<=0)throw new Error('Practical probability, price or uncertainty screen not met');
  const fair=q.side==='over'?market.over:market.under;if(p.win/(1-p.push)<=fair)throw new Error('No model advantage over two-sided fair market');
  const score=.65*p.win+.2*Math.min(.2,estimatedEV)+.15*Math.min(1,f.n/30)-.2*disagreement;
  return{win:p.win,push:p.push,estimatedEV,conservativeEV,disagreement,score,confidence:'Experimental · limited validation',reasoning:`Estimated ${f.expectedMinutes.toFixed(1)} minutes from ${f.n} earlier complete games; ${f.model} supports this side. Minutes sensitivity and the simple-model comparison retain a positive estimated edge; participation is unconfirmed.`,market};
}
export function rankAndIssue(store:Store,config:Config,quotes:Quote[],terms:Terms[],at:string,clock=()=>at,owner?:OpportunityOwner){
  ensureSuggestionFamilies(store);
  persistOpportunityObservations(store,quotes,at,owner,clock);
  const plan=evaluateOpportunities(store,config,quotes,terms,at);
  archivePricedCandidates(store,plan.canonical.quotes,at,plan.forecasts);
  persistOpportunityRows(store,plan.rows,owner,clock);
  const issued=issueQualifiedSuggestions(store,config,plan.eligible,at,clock);
  for(const row of plan.rows){const match=issued.ids.map(id=>store.db.prepare('SELECT body FROM experimental_suggestions WHERE id=?').get(id)).find(r=>r&&hash(JSON.parse(String(r.body)).quote)===row.quoteHash);if(match)row.issuedId=JSON.parse(String(match.body)).id;else if(row.classification==='QUALIFIED'){const exposure=issued.exposureSuppressed.find(x=>x.family===row.familyId),reason=exposure?.reason??(!quoteFresh(row.quote,clock(),180,120)?'ORIGINAL_QUOTE_EXPIRED_DURING_EVALUATION':notificationWindow(clock(),row.quote.expiresAt).state!=='ready'?'DELIVERY_WINDOW_NOT_READY':'NOT_ISSUED_BY_UNCHANGED_FAMILY_OR_EXPOSURE_POLICY');row.classification='SUPPRESSED';row.gates.push({code:'ISSUANCE_DISPOSITION',category:'DUPLICATE_CORRELATION_EXPOSURE',pass:false,observed:reason,required:'actual source recommendation transaction'});}}
  persistOpportunityRows(store,plan.rows,owner,clock);
  return{at,pricedCandidates:quotes.length,uniqueOpportunities:plan.canonical.quotes.length,duplicateSnapshots:plan.canonical.duplicates.length,eligible:plan.eligible.length,...issued,excluded:plan.rows.filter(r=>r.authorityError).map(r=>({playerId:r.quote.playerId,prop:r.quote.prop,reason:r.authorityError!})),funnel:{watch:plan.rows.filter(r=>r.classification==='WATCH').length,dataHeld:plan.rows.filter(r=>r.classification==='DATA_HOLD').length,suppressed:plan.rows.filter(r=>r.classification==='SUPPRESSED').length}};
}
export interface QualifiedSuggestion {quote:Quote;forecast:ExperimentalForecast;terms:Terms;assessment:ReturnType<typeof assessSuggestion>;marketComparison?:MultiEvidence;}
/** Shared original transaction/outbox/family path. New-book callers must carry
 * a valid immutable decision and current activation authority. */
export function issueQualifiedSuggestions(store:Store,config:Config,eligible:QualifiedSuggestion[],at:string,clock=()=>at,scope?:{assertOwner:()=>void}){
  if(eligible.some(i=>i.marketComparison)&&!scope)throw new Error('MULTI_ISSUANCE_OWNERSHIP_REQUIRED');scope?.assertOwner();ensureSuggestionFamilies(store);
  const issued:Suggestion[]=[],families=new Set<string>();let permanentlySuppressed=0;const exposureSuppressed:{family:string;reason:string}[]=[];
  for(const item of (config.recommendationExposure.enabled?[...eligible].sort((a,b)=>b.assessment.score-a.assessment.score||hash(a.quote).localeCompare(hash(b.quote))):eligible)){const {quote:q,forecast:f}=item,family=hash([q.event.id,q.playerId,q.prop]);if(families.has(family))continue;families.add(family);if(!config.liveSuggestionsEnabled)continue;
    const now=clock();if(!quoteFresh(q,now,180,120)||notificationWindow(now,q.expiresAt).state!=='ready')continue;currentPlayerEvidence(store,f,now);if(item.marketComparison){assertMultiDelivery(store,config,item.marketComparison,q,now,f);const current=assessBookmakerOffer(q,item.marketComparison.opposite,f,item.terms,now);if(hash(current)!==hash(item.assessment))throw new Error('MULTI_ASSESSMENT_CHANGED');}else if(q.bookmaker!=='sportsbet')throw new Error('MULTI_ISSUANCE_AUTHORITY_REQUIRED');
    const issueEvidence=store.get<any>('production:m1-trial')?.enabled?currentPlayerEvidence(store,f,now):undefined;
    const record:Suggestion={...(issueEvidence?{issueEvidence}:{}),id:hash([SUGGESTION_POLICY,f.id,q,now]),at:now,quote:q,forecastId:f.id,forecast:f,...item.assessment,terms:item.terms,hypotheticalStakeAUD:5,experimental:true,validated:false,supersedes:null,...(config.recommendationExposure.enabled&&config.recommendationExposure.policy?{exposurePolicy:{id:config.recommendationExposure.policy.id,hash:hash(config.recommendationExposure.policy),maxPerFixture:config.recommendationExposure.policy.maxPerFixture,maxPerPlayerFixture:config.recommendationExposure.policy.maxPerPlayerFixture}}:{}),...(item.marketComparison?{marketComparison:item.marketComparison}:{})};
    const created=store.transaction(()=>{scope?.assertOwner();if(item.marketComparison)assertMultiDelivery(store,config,item.marketComparison,q,clock(),f);if(store.db.prepare('SELECT family FROM experimental_suggestion_families WHERE family=?').get(family)||hasPlacedFamily(store,family))return false;const exposure=exposureBlock(store,config.recommendationExposure,q,clock());if(exposure){exposureSuppressed.push({family,reason:exposure});return false;}store.db.prepare('INSERT INTO experimental_suggestions VALUES (?,?,?,?)').run(record.id,now,family,JSON.stringify(record));enqueueSuggestionBatch(store,[record],now);scope?.assertOwner();if(item.marketComparison&&!quoteFresh(q,clock(),180,120))throw new Error('MULTI_ISSUANCE_CROSSED_DEADLINE');return true;});if(created)issued.push(record);else if(!exposureSuppressed.some(r=>r.family===family))permanentlySuppressed++;
  }
  // Consolidate new recommendations from this fixture into bounded Telegram pages.
  if(issued.length>1){store.transaction(()=>{scope?.assertOwner();const pending=issued.filter(s=>store.db.prepare("SELECT id FROM experimental_outbox WHERE id=? AND state='pending'").get(hash(['suggestion-batch',[s.id]])));for(const s of pending)store.db.prepare("UPDATE experimental_outbox SET state='consolidated' WHERE id=? AND state='pending'").run(hash(['suggestion-batch',[s.id]]));let batch:Suggestion[]=[];for(const s of pending){if(batch.length&&suggestionMessage([...batch,s]).length>3500){enqueueSuggestionBatch(store,batch,at);batch=[];}batch.push(s);}if(batch.length)enqueueSuggestionBatch(store,batch,at);scope?.assertOwner();});}
  return{issued:issued.length,ids:issued.map(s=>s.id),permanentlySuppressed,exposureSuppressed};
}

export function archivePricedCandidates(store:Store,quotes:Quote[],at:string,provided?:ExperimentalForecast[]){
  const forecasts=provided??marketForecasts(store,at,[...new Set(quotes.map(q=>q.event.id))]);let inserted=0;
  for(const raw of quotes){const q=quoteSchema.parse(raw);retained(store,q.source,at);if(ms(at)>=ms(q.event.startsAt)||ms(q.retrievedAt)>=ms(q.event.startsAt)||ms(q.quotedAt)>=ms(q.event.startsAt))continue;
    const matches=forecasts.filter(f=>hash(f.event)===hash(q.event)&&f.playerId===q.playerId&&f.teamId===q.teamId&&f.prop===q.prop&&ms(f.at)<=ms(at)&&f.inputHash===hash(f.inputs)),f=matches.length===1?matches[0]:null,id=hash(['observed-pregame-candidate',q,f?.id??null]);
    let trialQualification:undefined|{state:'ELIGIBLE'|'REJECTED';reason:string|null};
    if(store.get<any>('production:m1-trial')?.enabled){try{if(!f)throw Error('NO_CURRENT_FROZEN_FORECAST');const pair=quotes.filter(p=>hash(p.event)===hash(q.event)&&p.playerId===q.playerId&&p.teamId===q.teamId&&p.prop===q.prop&&p.line===q.line&&p.bookmaker===q.bookmaker&&p.termsId===q.termsId&&p.side!==q.side);if(pair.length!==1)throw Error('EXACT_OPPOSITE_SIDE_MISSING_OR_AMBIGUOUS');const terms=store.get<{terms:Terms[]}>('suggestions:terms')?.terms.filter(t=>t.id===q.termsId);if(terms?.length!==1)throw Error('EXACT_SETTLEMENT_TERMS_MISSING');currentPlayerEvidence(store,f,at);assessBookmakerOffer(q,pair[0],f,terms[0],at);trialQualification={state:'ELIGIBLE',reason:null};}catch(e){trialQualification={state:'REJECTED',reason:(e as Error).message};}}
    const record={id,at,sourceObservedAt:q.retrievedAt,kind:'observed-pregame-candidate',quote:q,forecastId:f?.id??null,forecastArtifact:f?.inputs.artifact??null,probability:f?probabilities(f.distribution,q.line,q.side):null,baseline:f?probabilities(f.baseline,q.line,q.side):null,challenger:f?probabilities(f.challenger,q.line,q.side):null,recommendationIndependent:true,...(trialQualification?{trialQualification}:{})};
    inserted+=Number(store.db.prepare('INSERT OR IGNORE INTO experimental_candidates VALUES (?,?,?)').run(id,at,JSON.stringify(record)).changes);
  }return{inserted};
}
const labels={points:'Points',rebounds:'Rebounds',assists:'Assists',threes:'Made threes'};
export function suggestionMessage(rows:Suggestion[]){return['EdgeLab Signals — NBA Picks','Experimental models · probabilities conditional on playing',...rows.map(s=>{const q=s.quote;return[`Player: ${q.player}`,`Market: ${q.side.toUpperCase()} ${q.line} ${labels[q.prop]}`,s.marketComparison?marketMessage(s):`Sportsbet: ${q.decimalOdds.toFixed(2)}`,`Model probability (if plays): ${(s.win*100).toFixed(1)}%`,`Confidence: ${s.confidence}`,`Reasoning: ${s.reasoning}`,`Game: ${q.event.away} at ${q.event.home} · ${new Intl.DateTimeFormat('en-AU',{timeZone:MELBOURNE,dateStyle:'medium',timeStyle:'short'}).format(new Date(q.event.startsAt))} Melbourne`,`Quote: ${q.quotedAt}`,`Reference: ${s.id}`].join('\n');})].join('\n\n');}
function enqueueSuggestionBatch(store:Store,rows:Suggestion[],at:string){const ids=rows.map(s=>s.id),id=hash(['suggestion-batch',ids]);let text=suggestionMessage(rows);try{text=compactExistingBatch(rows,ids).text;}catch{/* Preserve the original batch if compact text cannot safely fit. */}store.db.prepare("INSERT OR IGNORE INTO experimental_outbox(id,at,body,binding,state,next_at) VALUES (?,?,?,?,'pending',?)").run(id,at,JSON.stringify({ids,text}),telegramBinding(),at);store.db.prepare("UPDATE experimental_outbox SET state='pending',next_at=? WHERE id=? AND state='consolidated'").run(at,id);}
export async function dispatchSuggestions(store:Store,config:Config,transport=new Telegram(config,store),clock=()=>new Date().toISOString()){
  if(!config.liveSuggestionsEnabled||!config.networkEnabled||config.operatingMode==='disabled')return{accepted:0,state:'disabled'};const lease=store.acquire('experimental-delivery',clock(),90);if(!lease)return{accepted:0,state:'busy'};let accepted=0;
  try{ensureSuggestionFamilies(store);store.db.prepare("UPDATE experimental_outbox SET state='uncertain',error='Interrupted submission; no blind resend' WHERE state='sending'").run();
    const records=new Map(suggestions(store).map(s=>[s.id,s]));const rows=store.db.prepare("SELECT * FROM experimental_outbox WHERE state IN ('pending','retryable_failed') AND next_at<=? ORDER BY at,id").all(clock()) as {id:string;body:string;binding:string;attempts:number}[];
    for(const out of rows){if(!store.renew('experimental-delivery',lease,clock(),90))break;const body=JSON.parse(out.body) as {ids:string[];text:string},signals=body.ids.map(id=>records.get(id));
      const now=clock();if(signals.some(s=>!s||!quoteFresh(s.quote,now,180,120)||notificationWindow(now,s.quote.expiresAt).state==='expired')){store.db.prepare("UPDATE experimental_outbox SET state='expired',error='Pregame price expired before permitted delivery' WHERE id=?").run(out.id);continue;}
      const window=notificationWindow(now);if(window.quiet){store.db.prepare('UPDATE experimental_outbox SET next_at=? WHERE id=?').run(window.nextAt,out.id);continue;}
      if(out.binding!==telegramBinding()||out.attempts>=3||!transport.verified(now))continue;
      try{for(const s of signals){currentPlayerEvidence(store,s!.forecast,clock());if(s!.marketComparison){assertMultiDelivery(store,config,s!.marketComparison,s!.quote,clock(),s!.forecast);assessBookmakerOffer(s!.quote,s!.marketComparison.opposite,s!.forecast,s!.terms,clock());}}}catch{store.db.prepare("UPDATE experimental_outbox SET state='expired',error='Current source evidence changed or expired' WHERE id=?").run(out.id);continue;}
      const claimed=store.transaction(()=>{const row=store.db.prepare('SELECT state,message_id FROM experimental_outbox WHERE id=?').get(out.id)as{state:string;message_id:string|null};if(!['pending','retryable_failed'].includes(row.state))return false;if(row.message_id!==null||duplicateFamilyDelivery(store,out.id,body.ids)){store.db.prepare("UPDATE experimental_outbox SET state='expired',error='PERMANENT_FAMILY_DUPLICATE; original records retained' WHERE id=?").run(out.id);return false;}return!!store.db.prepare("UPDATE experimental_outbox SET state='sending',attempts=attempts+1 WHERE id=? AND state IN ('pending','retryable_failed')").run(out.id).changes;});if(!claimed)continue;
      try{const result=await transport.sendSuggestions(body.text);store.db.prepare("UPDATE experimental_outbox SET state='accepted',message_id=?,error=NULL WHERE id=?").run(result.guid,out.id);accepted++;}
      catch(e){const f=e instanceof TelegramFailure?e:new TelegramFailure('uncertain_suggestion_submission',true);if(f.kind==='telegram_quiet_hours'&&f.deferUntil){store.db.prepare("UPDATE experimental_outbox SET state='expired',error='Quote expires before quiet-hour release' WHERE id=?").run(out.id);continue;}store.db.prepare('UPDATE experimental_outbox SET state=?,error=?,next_at=? WHERE id=?').run(f.uncertain?'uncertain':f.retryAfter?'retryable_failed':'rejected',f.kind,new Date(ms(clock())+(f.retryAfter??60)*1000).toISOString(),out.id);}
    }return{accepted,state:'completed',deviceDelivery:'unobservable'};
  }finally{store.release('experimental-delivery',lease);}
}
// Load only fixtures being reconciled; repeatedly parsing the full historical
// source archive must not delay live market deadlines.
function eventLogReader(store:Store){const cache=new Map<string,GameLog[]>();return(id:string)=>{if(!cache.has(id))cache.set(id,(store.db.prepare('SELECT body FROM logs WHERE event_id=? ORDER BY observed_at').all(id) as {body:string}[]).map(r=>JSON.parse(r.body) as GameLog));return cache.get(id)!;};}
export function settleSuggestions(store:Store,at:string){let settled=0;const held:{id:string;reason:string}[]=[],pendingFinalEvidence:{id:string;reason:string}[]=[],logs=eventLogReader(store);
  for(const s of suggestions(store)){const final=logs(s.quote.event.id).filter(l=>l.playerId===s.quote.playerId).sort((a,b)=>ms(b.observedAt)-ms(a.observedAt))[0];if(!final){if(!store.db.prepare('SELECT id FROM experimental_grades WHERE signal_id=? LIMIT 1').get(s.id))pendingFinalEvidence.push({id:s.id,reason:'FINAL_PLAYER_STATISTICS_NOT_RETAINED'});continue;}
    try{for(const source of [final.source,...(final.supportingSources??[])])retained(store,source,at);const result=grade({id:s.id,issuedAt:s.at,simulated:false,decision:{quote:s.quote}},final,at);
      const previous=(store.db.prepare('SELECT body FROM experimental_grades WHERE signal_id=? ORDER BY at DESC,id DESC LIMIT 1').get(s.id) as {body:string}|undefined),old=previous?JSON.parse(previous.body) as Outcome:null;
      if(old&&old.result===result.result&&old.value===result.value)continue;if(old&&ms(result.evidence.observedAt)<=ms(old.evidence.observedAt))throw new Error('Older/ambiguous correction held');
      settled+=Number(store.db.prepare('INSERT OR IGNORE INTO experimental_grades VALUES (?,?,?,?)').run(result.id,s.id,at,JSON.stringify({...result,...(old?{corrects:old.id}:{}),hypotheticalProfitAUD:result.units*5})).changes);
    }catch(e){held.push({id:s.id,reason:(e as Error).message});}
  }return{settled,held,pendingFinalEvidence};
}
export function scoreExperimentalForecasts(store:Store,at:string,forecasts:Iterable<ExperimentalForecast>=experimentalForecasts(store)){const logs=eventLogReader(store),groups=new Map<Prop,{chosen:ScoredPrediction[];baseline:ScoredPrediction[];challenger:ScoredPrediction[];minutes:{predicted:number;actual:number}[]}>();
  for(const f of forecasts){if(f.inputHash!==hash(f.inputs)||ms(f.at)>=ms(f.event.startsAt)-120000)continue;const final=logs(f.event.id).filter(l=>!l.source.simulated&&hash(l.event)===hash(f.event)&&l.playerId===f.playerId&&l.teamId===f.teamId&&l.final&&l.participated===true&&l.stats[f.prop]!==null&&ms(l.observedAt)>ms(f.event.startsAt)&&ms(l.observedAt)<=ms(at)).sort((a,b)=>ms(b.observedAt)-ms(a.observedAt))[0];if(!final)continue;
    for(const source of [final.source,...(final.supportingSources??[])])retained(store,source,at);const common={id:f.id,date:f.event.startsAt.slice(0,10),fixture:f.event.id,player:f.playerId,team:f.teamId,season:f.event.season,lowMinute:f.expectedMinutes<15,y:final.stats[f.prop]!},g=groups.get(f.prop)??{chosen:[],baseline:[],challenger:[],minutes:[]};g.chosen.push({...common,pmf:f.distribution});g.baseline.push({...common,pmf:f.baseline});g.challenger.push({...common,pmf:f.challenger});if(final.minutes!==null)g.minutes.push({predicted:f.expectedMinutes,actual:final.minutes});groups.set(f.prop,g);
  }
  const binary:{p:number;y:number;fixture:string;player:string}[]=[];
  for(const row of store.db.prepare('SELECT body FROM experimental_candidates').all() as {body:string}[]){const c=JSON.parse(row.body);if(!c.probability||ms(c.at)>=ms(c.quote.event.startsAt))continue;
    const final=logs(c.quote.event.id).filter(l=>l.playerId===c.quote.playerId&&ms(l.observedAt)<=ms(at)).sort((a,b)=>ms(b.observedAt)-ms(a.observedAt))[0];if(!final)continue;
    try{for(const source of [final.source,...(final.supportingSources??[])])retained(store,source,at);const o=grade({id:c.id,issuedAt:c.at,simulated:false,decision:{quote:c.quote}},final,at);if(o.result==='won'||o.result==='lost')binary.push({p:c.probability.win/(1-c.probability.push),y:Number(o.result==='won'),fixture:c.quote.event.id,player:c.quote.playerId});}catch{/* Unresolved participation and unknown results remain excluded. */}
  }
  const marketMetrics=binary.length?{decisiveQuoteSides:binary.length,fixtures:new Set(binary.map(r=>r.fixture)).size,players:new Set(binary.map(r=>r.player)).size,brier:binary.reduce((n,r)=>n+(r.p-r.y)**2,0)/binary.length,logLoss:binary.reduce((n,r)=>n-r.y*Math.log(Math.max(1e-9,r.p))-(1-r.y)*Math.log(Math.max(1e-9,1-r.p)),0)/binary.length,
    calibration:Array.from({length:10},(_,i)=>{const rows=binary.filter(r=>r.p>=i/10&&(i===9?r.p<=1:r.p<(i+1)/10));return{from:i/10,to:(i+1)/10,n:rows.length,predicted:rows.length?rows.reduce((n,r)=>n+r.p,0)/rows.length:null,observed:rows.length?rows.reduce((n,r)=>n+r.y,0)/rows.length:null};}),limitation:'Opposite sides, lines and props are correlated; quote sides are not independent player-games.'}:null;
  const evaluated=[...groups].map(([prop,g])=>{
    const chosen=scoreRows(g.chosen,thresholds.NBA[prop]),baseline=scoreRows(g.baseline,thresholds.NBA[prop]),paired=pairedDifference(g.chosen,g.baseline,thresholds.NBA[prop]);
    const state=!chosen||chosen.playerGames<30?'insufficient_forward_evidence':baseline&&chosen.dates>=5&&chosen.crps>baseline.crps*1.05&&paired.interval95.crps[0]>0?'degradation_observed':'provisional';
    store.set(`experimental:model-health:${prop}`,{at,state,validated:false,modelAutomaticallyChanged:false});
    return{prop,chosen,baseline,challenger:scoreRows(g.challenger,thresholds.NBA[prop]),paired,challengerVersusChosen:pairedDifference(g.challenger,g.chosen,thresholds.NBA[prop]),
      minutes:g.minutes.length?{playerGames:g.minutes.length,mae:g.minutes.reduce((n,r)=>n+Math.abs(r.predicted-r.actual),0)/g.minutes.length,bias:g.minutes.reduce((n,r)=>n+r.predicted-r.actual,0)/g.minutes.length}:null,health:state};
  });
  const report={evaluationVersion:'backend-evaluation/1.4.3',policy:SUGGESTION_POLICY,validated:false,marketMetrics,groups:evaluated};store.db.prepare('INSERT OR IGNORE INTO research_grades VALUES (?,?,?,?)').run(hash(report),at,'experimental-all-candidates',JSON.stringify({...report,at}));return report;
}
