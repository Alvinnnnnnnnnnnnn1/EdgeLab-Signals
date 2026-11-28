import {hash,ms,quoteFresh,quoteSchema,termsSchema,ev,type Quote,type Terms} from '../core/domain';
import type {Store} from '../core/store';
import type {Config} from '../core/config';
import {probabilities} from '../core/models';
import {comparableSides} from '../research/markets';
import {assessSuggestion,currentPlayerEvidence,type QualifiedSuggestion} from '../suggestions/engine';
import {SUGGESTION_POLICY,retained,type ExperimentalForecast} from '../suggestions/forecasts';
import {marketForecasts} from '../production/router';

export type Category='DATA_IDENTITY_FRESHNESS'|'MODEL_MINUTES_UNCERTAINTY'|'PROBABILITY_PRICE'|'ESTIMATED_EV'|'SENSITIVITY_EV'|'MODEL_DISAGREEMENT'|'DUPLICATE_CORRELATION_EXPOSURE';
export interface Gate {code:string;category:Category;pass:boolean|null;observed:unknown;required:unknown;}
export const opportunityId=(q:Quote)=>hash(['opportunity/1',q.event.id,q.playerId,q.teamId,q.prop,q.line,q.side,q.bookmaker,q.termsId]);
export const familyId=(q:Quote)=>hash([q.event.id,q.playerId,q.prop]);
/** Identity excludes snapshots, forecast revisions and price changes. Both
 * sides and every authentic line remain distinct. Conflicting same-clock
 * prices are held; a later retrieval never extends an original price clock. */
export function canonicalQuotes(input:Quote[]){
 const groups=new Map<string,Quote[]>();for(const q of input){const k=opportunityId(q);groups.set(k,[...(groups.get(k)??[]),q]);}
 const quotes:Quote[]=[],conflicts:Quote[]=[],duplicates:{opportunityId:string;retained:string;observations:string[]}[]=[];
 for(const[k,rows]of groups){const sorted=rows.slice().sort((a,b)=>ms(b.quotedAt)-ms(a.quotedAt)||ms(b.retrievedAt)-ms(a.retrievedAt)||hash(a).localeCompare(hash(b))),latest=sorted[0],same=sorted.filter(q=>q.quotedAt===latest.quotedAt);
  if(new Set(same.map(q=>q.decimalOdds)).size>1){conflicts.push(...same);continue;}quotes.push(latest);if(rows.length>1)duplicates.push({opportunityId:k,retained:hash(latest),observations:rows.map(hash)});
 }return{quotes,conflicts,duplicates,observed:input.length};
}
export function numericMetrics(q:Quote,f:ExperimentalForecast){
 const p=probabilities(f.distribution,q.line,q.side),base=probabilities(f.baseline,q.line,q.side),challenger=probabilities(f.challenger,q.line,q.side),sensitivity=[f.distribution,f.baseline,f.challenger,...f.stress].map(d=>{const v=probabilities(d,q.line,q.side),penalty=.5*Math.sqrt(v.win*(1-v.win)/f.n);return{win:v.win,push:v.push,penalty,EV:ev(Math.max(0,v.win-penalty),v.push,q.decimalOdds)};});
 return{probability:p,conditionalWin:p.win/(1-p.push),estimatedEV:ev(p.win,p.push,q.decimalOdds),conservativeEV:Math.min(...sensitivity.map(x=>x.EV)),disagreement:Math.max(Math.abs(p.win-base.win),Math.abs(p.win-challenger.win)),sensitivity};
}
export function numericGates(q:Quote,f:ExperimentalForecast,at:string){
 const v=numericMetrics(q,f),gates:Gate[]=[],add=(code:string,category:Category,pass:boolean,observed:unknown,required:unknown)=>gates.push({code,category,pass,observed,required});
 add('HISTORY_GAMES','MODEL_MINUTES_UNCERTAINTY',f.n>=10,f.n,'>=10');add('CURRENT_SEASON_GAMES','MODEL_MINUTES_UNCERTAINTY',f.currentSeasonGames>=5,f.currentSeasonGames,'>=5');add('RECENT_HISTORY','DATA_IDENTITY_FRESHNESS',ms(at)-ms(f.lastGameAt)<=30*86400000,f.lastGameAt,'within30days');add('MINUTES_MEAN','MODEL_MINUTES_UNCERTAINTY',f.expectedMinutes>=18,f.expectedMinutes,'>=18');add('MINUTES_SD','MODEL_MINUTES_UNCERTAINTY',f.minutesSD<=6,f.minutesSD,'<=6');add('TEAM_CHANGE','MODEL_MINUTES_UNCERTAINTY',!f.teamChanged,f.teamChanged,false);
 add('ODDS_BAND','PROBABILITY_PRICE',q.decimalOdds>=1.5&&q.decimalOdds<=2.4,q.decimalOdds,'1.5..2.4');add('PROBABILITY_BAND','PROBABILITY_PRICE',v.probability.win>=.55&&v.probability.win<=.85,v.probability.win,'0.55..0.85');add('MODEL_DISAGREEMENT','MODEL_DISAGREEMENT',v.disagreement<=.12,v.disagreement,'<=0.12');add('ESTIMATED_EV','ESTIMATED_EV',v.estimatedEV>=.04,v.estimatedEV,'>=0.04');add('CONSERVATIVE_EV','SENSITIVITY_EV',v.conservativeEV>0,v.conservativeEV,'>0');return{metrics:v,gates};
}
export interface OpportunityEvaluation {id:string;at:string;opportunityId:string;familyId:string;quote:Quote;quoteHash:string;forecastId:string|null;forecastHash:string|null;metrics:ReturnType<typeof numericMetrics>|null;gates:Gate[];authorityError:string|null;classification:'DATA_HOLD'|'WATCH'|'QUALIFIED'|'SUPPRESSED';sourceKind:'LIVE_STAGE'|'HISTORICAL_RESEARCH';issuedId?:string|null;}
/** Diagnosis never supplies authority: the unchanged assessSuggestion and
 * currentPlayerEvidence remain the final eligibility functions. */
export function evaluateOpportunities(s:Store,c:Config,raw:Quote[],terms:Terms[],at:string,provided?:ExperimentalForecast[]){
 const canonical=canonicalQuotes(raw),forecasts=provided??marketForecasts(s,at,[...new Set(raw.map(q=>q.event.id))]),rows:OpportunityEvaluation[]=[],eligible:QualifiedSuggestion[]=[],proofs=new Map<string,string|null>();
 for(const q of [...canonical.quotes,...canonical.conflicts]){
  const gates:Gate[]=[],add=(code:string,pass:boolean|null,observed:unknown,required:unknown,category:Category='DATA_IDENTITY_FRESHNESS')=>gates.push({code,category,pass,observed,required}),matches=forecasts.filter(f=>hash(f.event)===hash(q.event)&&f.playerId===q.playerId&&f.prop===q.prop),f=matches.length===1?matches[0]:null,pairs=canonical.quotes.filter(p=>p.side!==q.side&&p.event.id===q.event.id&&p.playerId===q.playerId&&p.teamId===q.teamId&&p.prop===q.prop&&p.line===q.line&&p.bookmaker===q.bookmaker&&p.termsId===q.termsId),t=terms.filter(t=>t.id===q.termsId);let metrics:ReturnType<typeof numericMetrics>|null=null,authorityError:string|null=null;
  add('QUOTE_SCHEMA',quoteSchema.safeParse(q).success,hash(q),'valid exact quote');add('CONFLICTING_SAME_CLOCK_PRICE',!canonical.conflicts.includes(q),q.quotedAt,'one unambiguous price');add('CURRENT_FORECAST',!!f,matches.length,1);add('OPPOSITE_SIDE',pairs.length===1,pairs.length,1);add('SETTLEMENT_TERMS',t.length===1&&termsSchema.safeParse(t[0]).success,t.length,1);add('ORIGINAL_QUOTE_CLOCK',quoteFresh(q,at,180,120),{quotedAt:q.quotedAt,expiresAt:q.expiresAt},'original180second TTL;120second pretip cutoff');
  for(const[name,source]of Object.entries({PRICE:q.source,EVENT_MAPPING:q.mappingProof?.event?.source,PLAYER_MAPPING:q.mappingProof?.player?.source,TERMS:t[0]?.source})){let pass=false;try{if(source){retained(s,source,at);pass=true;}}catch{}add('RETAINED_'+name,pass,source?.hash??null,'genuine immutable as-of receipt');}
  if(f){add('FORECAST_IDENTITY',f.teamId===q.teamId&&f.prop===q.prop&&f.policy===SUGGESTION_POLICY&&f.validated===false&&f.inputHash===hash(f.inputs)&&ms(f.at)<=ms(at)&&ms(f.at)<ms(f.event.startsAt)-120000,{id:f.id,at:f.at},'exact immutable pretip forecast');try{const n=numericGates(q,f,at);metrics=n.metrics;gates.push(...n.gates);}catch(e){add('DISTRIBUTION',false,(e as Error).message,'valid full PMF');}
   if(!proofs.has(f.id)){try{currentPlayerEvidence(s,f,at);proofs.set(f.id,null);}catch(e){proofs.set(f.id,(e as Error).message);}}add('CURRENT_CONTEXT_AVAILABILITY',!proofs.get(f.id),proofs.get(f.id)??'verified','current fixture,roster,injury,forecast context');
   if(pairs.length===1&&metrics){try{const fair=q.side==='over'?comparableSides(q,pairs[0]).over:comparableSides(pairs[0],q).under;add('NO_VIG_ADVANTAGE',metrics.conditionalWin>fair,{model:metrics.conditionalWin,market:fair},'model>paired market','ESTIMATED_EV');}catch(e){add('COMPARABLE_MARKET',false,(e as Error).message,'same-line same-terms opposite side');}}
  }
  try{if(!f)throw Error('Exact frozen experimental forecast missing/ambiguous');if(pairs.length!==1)throw Error('Exact opposite-side market missing/ambiguous');if(t.length!==1)throw Error('Verified original settlement terms missing');if(gates.some(g=>g.category==='DATA_IDENTITY_FRESHNESS'&&g.pass===false))throw Error(String(gates.find(g=>g.category==='DATA_IDENTITY_FRESHNESS'&&g.pass===false)!.code));currentPlayerEvidence(s,f,at);eligible.push({quote:q,forecast:f,terms:t[0],assessment:assessSuggestion(q,pairs[0],f,t[0],at)});}catch(e){authorityError=(e as Error).message;}
  const classification=authorityError?(gates.some(g=>g.category==='DATA_IDENTITY_FRESHNESS'&&g.pass===false)?'DATA_HOLD':'WATCH'):'QUALIFIED',body={at,opportunityId:opportunityId(q),familyId:familyId(q),quote:q,quoteHash:hash(q),forecastId:f?.id??null,forecastHash:f?hash(f):null,metrics,gates,authorityError,classification,sourceKind:'LIVE_STAGE' as const};rows.push({...body,id:hash(['opportunity-evaluation/1',body.opportunityId,body.quoteHash,body.forecastId,gates,authorityError])}as OpportunityEvaluation);
 }
 eligible.sort((a,b)=>b.assessment.score-a.assessment.score||hash(a.quote).localeCompare(hash(b.quote)));
 const batch=new Set<string>();for(const item of eligible){const row=rows.find(r=>r.quoteHash===hash(item.quote))!,family=familyId(item.quote),duplicate=!!s.db.prepare("SELECT name FROM sqlite_master WHERE name='experimental_suggestion_families'").get()&&!!s.db.prepare('SELECT family FROM experimental_suggestion_families WHERE family=?').get(family),placed=!!s.db.prepare("SELECT name FROM sqlite_master WHERE name='confirmed_placement_families'").get()&&!!s.db.prepare('SELECT family FROM confirmed_placement_families WHERE family=?').get(family),correlated=batch.has(family);batch.add(family);const p=c.recommendationExposure.policy,counts=s.db.prepare("SELECT count(*)n,sum(CASE WHEN json_extract(body,'$.quote.playerId')=? THEN 1 ELSE 0 END)player FROM experimental_suggestions WHERE json_extract(body,'$.quote.event.id')=?").get(item.quote.playerId,item.quote.event.id)!,exposure=!c.recommendationExposure.enabled||!!p&&ms(p.effectiveAt)<=ms(at)&&ms(p.expiresAt)>ms(at)&&Number(counts.n)<p.maxPerFixture&&Number(counts.player??0)<p.maxPerPlayerFixture;
  for(const[code,pass,observed]of [['PERMANENT_FAMILY',!duplicate,duplicate],['CONFIRMED_PLACEMENT_FAMILY',!placed,placed],['CORRELATED_BATCH_FAMILY',!correlated,correlated],['EXPOSURE_POLICY',exposure,counts],['LIVE_SUGGESTIONS_ENABLED',c.liveSuggestionsEnabled,c.liveSuggestionsEnabled]]as const)row.gates.push({code,category:'DUPLICATE_CORRELATION_EXPOSURE',pass,observed,required:code==='LIVE_SUGGESTIONS_ENABLED'?true:'unchanged original policy'});
  if(duplicate||placed||correlated||!exposure||!c.liveSuggestionsEnabled)row.classification='SUPPRESSED';
 }
 return{rows,eligible,forecasts,canonical};
}
