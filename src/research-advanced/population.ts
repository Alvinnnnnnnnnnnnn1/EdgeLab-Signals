import {Store} from '../core/store';
import {hash,ms,assertReceipt,quoteSchema,type Quote,type GameLog,type Terms,type Prop} from '../core/domain';
import {grade} from '../core/settlement';
import {probabilities} from '../core/models';
import {assessSuggestion} from '../suggestions/engine';
import {metrics} from './audit';
import {policyDecision,policyVersions} from './policies';
import {localParts} from '../research/schedule';
import {summary,rng,average} from '../research/distributions';
import {scoreRows,type ScoredPrediction} from '../research/scoring';
import {thresholds} from '../research/experiment';
import {sourceHistory} from './source-history';
import {notificationWindow} from '../research/schedule';


function opportunityMetrics(rows:any[]){
 const {issued,profitAUD,roi,issuanceDates,...scores}=metrics(rows.map(r=>({...r,profit:0})));
 return{opportunities:issued,observationDates:issuanceDates,...scores};
}
function clusteredScores(rows:any[],cluster:'fixture'|'fixtureDate'){
 const groups=new Map<string,number[][]>();for(const r of rows.filter(r=>['won','lost'].includes(r.result))){const p=Math.max(1e-9,Math.min(1-1e-9,r.p)),y=Number(r.result==='won'),g=groups.get(r[cluster])??[];g.push([(p-y)**2,-y*Math.log(p)-(1-y)*Math.log(1-p),p-y]);groups.set(r[cluster],g);}
 if(groups.size<2)return{cluster,clusters:groups.size,interval95:null,reason:'Insufficient independent clusters',exploratory:true};
 const all=[...groups.values()],random=rng(1461),samples=[[],[],[]] as number[][];
 for(let i=0;i<300;i++){const draw=Array.from({length:all.length},()=>all[Math.floor(random()*all.length)]).flat();samples.forEach((s,j)=>s.push(average(draw.map(r=>r[j]))));}
 return{cluster,clusters:groups.size,draws:300,seed:1461,interval95:Object.fromEntries(['brier','logLoss','calibrationBias'].map((key,j)=>{const s=samples[j].sort((a,b)=>a-b);return[key,[s[7],s[292]]];})),exploratory:true};
}

/** Complete retained observation population, not just recommendations. This
 * does not recreate overwritten historical injury/availability snapshots. */
export function populationEvaluation(store:Store,at:string){
 const history=sourceHistory(store),started=performance.now(),observed=(store.db.prepare('SELECT body FROM experimental_candidates WHERE at<=? ORDER BY at,id').all(at) as {body:string}[]).map(r=>JSON.parse(r.body)),issues=(store.db.prepare('SELECT body FROM experimental_suggestions ORDER BY at,id').all() as {body:string}[]).map(r=>JSON.parse(r.body)),issuedIds=new Set(issues.map(s=>s.id)),issuedFamilies=new Set(issues.map(s=>hash([s.quote.event.id,s.quote.playerId,s.quote.prop]))),terms=new Map<string,Terms>();
 for(const s of issues)terms.set(s.terms.id,s.terms);for(const t of store.get<{terms:Terms[]}>('suggestions:terms')?.terms??[])if(!terms.has(t.id))terms.set(t.id,t);
 const logs=store.logs(),inputIndex=new Map(logs.map(l=>[hash([l.event.id,l.playerId,l.source.hash]),l])),latest=new Map<string,GameLog>();for(const l of logs)if(l.final&&ms(l.observedAt)<=ms(at)){const key=hash([l.event.id,l.playerId]),old=latest.get(key);if(!old||old.observedAt<l.observedAt)latest.set(key,l);}
 const proofs=new WeakMap<Quote['source'],number>(),clocks=new Map<string,number>(),clock=(s:string)=>{if(!clocks.has(s))clocks.set(s,ms(s));return clocks.get(s)!;};
 const sourceValid=(s:Quote['source'],cutoff:string)=>{const known=proofs.get(s);if(known!==undefined){if(known>clock(cutoff))throw new Error('Future source evidence');return;}assertReceipt(s,cutoff);if(!store.hasReceipt(s))throw new Error('Unretained exact source');proofs.set(s,clock(s.retrievedAt));},forecastCache=new Map<string,any>(),forecastValidated=new Set<string>(),firstScores=new Map<string,{prop:Prop;chosen:ScoredPrediction;baseline:ScoredPrediction;challenger:ScoredPrediction}>();
 const pairIndex=new Map<string,Map<string,Quote>>();const pairKey=(q:Quote)=>hash([q.event,q.playerId,q.teamId,q.prop,q.line,q.bookmaker,q.termsId,q.source.hash,q.quotedAt]);for(const c of observed){const group=pairIndex.get(pairKey(c.quote))??new Map<string,Quote>();group.set(hash(c.quote),c.quote);pairIndex.set(pairKey(c.quote),group);}
 const rows=observed.map(c=>{const q=c.quote as Quote,family=hash([q.event.id,q.playerId,q.prop]),pairs=[...(pairIndex.get(pairKey(q))?.values()??[])].filter(p=>p.side!==q.side),pair=pairs.length===1?pairs[0]:null;let sourceQualified=false,numericBaseline=false,reason:string|null=null,assessment:any=null,f:any=null,outcome:any=null,sourceGate:{verified:boolean;reason:string|null;sourceRefs:string[];participation:string}={verified:false,reason:'Source-qualified forecast unavailable',sourceRefs:[],participation:'unconfirmed_not_assumed'};
  try{
   quoteSchema.parse(q);sourceValid(q.source,c.at);if(ms(q.mappingProof.event.verifiedAt)>ms(c.at)||ms(q.mappingProof.player.verifiedAt)>ms(c.at))throw new Error('Identity verification after observation cutoff');if(q.bookmaker!=='sportsbet'||q.event.league!=='NBA'||ms(c.at)>=ms(q.event.startsAt)||ms(c.at)>ms(at))throw new Error('Not a genuine pregame Sportsbet observation');
   for(const s of [q.mappingProof.event.source,q.mappingProof.player.source])sourceValid(s,c.at);
   if(!c.forecastId)throw new Error('Frozen source-qualified forecast unavailable');
   f=forecastCache.get(c.forecastId);if(!f){const r=store.db.prepare('SELECT body FROM experimental_forecasts WHERE id=?').get(c.forecastId);if(!r)throw new Error('Missing frozen forecast');f=JSON.parse(r.body as string);if(forecastCache.size>=8)forecastCache.delete(forecastCache.keys().next().value!);forecastCache.set(c.forecastId,f);}
   if(hash(f.event)!==hash(q.event)||f.playerId!==q.playerId||f.teamId!==q.teamId||f.prop!==q.prop||ms(f.at)>ms(c.at)||ms(f.at)>=ms(q.event.startsAt)-120000)throw new Error('Forecast identity/clock mismatch');
   if(!forecastValidated.has(f.id)){
    if(f.inputHash!==hash(f.inputs)||ms(f.inputs.cutoff)>ms(f.at)||ms(f.inputs.artifact.generatedAt)>ms(f.at))throw new Error('Frozen model/input hash or clock mismatch');
    for(const s of [f.inputs.fixtureSource,f.inputs.rosterSource])sourceValid(s,f.at);
    for(const id of f.inputs.inputRefs){const l=inputIndex.get(id);if(!l||!l.final||clock(l.observedAt)>clock(f.inputs.cutoff)||l.event.startsAt.slice(0,10)>=f.inputs.cutoff.slice(0,10))throw new Error('Unavailable historical feature input');for(const s of [l.source,...(l.supportingSources??[])])sourceValid(s,f.inputs.cutoff);}
    for(const p of [f.distribution,f.baseline,f.challenger])summary(p);forecastValidated.add(f.id);
   }
   if(hash(c.probability)!==hash(probabilities(f.distribution,q.line,q.side)))throw new Error('Archived probability differs from frozen forecast');sourceQualified=true;sourceGate=history.assessment(f,c.at);
   const t=terms.get(q.termsId!);if(!pair||!t)throw new Error('Complete exact two-sided market/terms unavailable');sourceValid(pair.source,c.at);sourceValid(t.source,c.at);
   try{assessment=assessSuggestion(q,pair,f,t,c.at);numericBaseline=true;}catch(e){reason=(e as Error).message;}
   const final=latest.get(hash([q.event.id,q.playerId]));if(final){for(const s of [final.source,...(final.supportingSources??[])])sourceValid(s,at);outcome=grade({id:c.id,issuedAt:c.at,simulated:false,decision:{quote:q}},final,at);}
   if(final?.participated===true&&final.stats[q.prop]!==null&&!firstScores.has(family)){
    const common={id:family,date:q.event.startsAt.slice(0,10),fixture:q.event.id,season:q.event.season,player:q.playerId,team:q.teamId,lowMinute:f.expectedMinutes<15,y:final.stats[q.prop]!};firstScores.set(family,{prop:q.prop,chosen:{...common,pmf:f.distribution},baseline:{...common,pmf:f.baseline},challenger:{...common,pmf:f.challenger}});
   }
  }catch(e){reason=(e as Error).message;}
  const fair=pair?(1/q.decimalOdds)/(1/q.decimalOdds+1/pair.decimalOdds):null;
  return{id:c.id,at:c.at,family,fixture:q.event.id,fixtureDate:localParts(q.event.startsAt).date,date:localParts(c.at).date,playerId:q.playerId,prop:q.prop,side:q.side,line:q.line,odds:q.decimalOdds,sourceQualified,completeTwoSided:!!pair,numericBaseline,sourceGate,deliveryWindowReady:notificationWindow(c.at,q.expiresAt).state==='ready',availabilityReplay:'Retained fixture/roster/injury evidence; historical runtime authorisation not inferred',reason,forecastId:c.forecastId,issuedFamily:issuedFamilies.has(family),p:c.probability?c.probability.win/(1-c.probability.push):null,fair,result:outcome?.result??null,expectedMinutes:f?.expectedMinutes??null,minutesSD:f?.minutesSD??null,actualMinutes:outcome?.evidence.minutes??null,historyN:f?.n??null,currentSeason:f?.currentSeasonGames??null,disagreement:assessment?.disagreement??null,estimatedEV:assessment?.estimatedEV??null,conservativeEV:assessment?.conservativeEV??null,score:assessment?.score??-Infinity,timing:(ms(q.event.startsAt)-ms(c.at))/60000>=75?'early/T-90':'late/T-20'};
 });
 const policies=policyVersions.map(version=>{const seen=new Set<string>(),selected:typeof rows=[];
  // Earliest eligible observation wins; within its acquisition timestamp use
  // the unchanged numeric score. Outcomes never choose a line or direction.
  for(const r of rows.slice().sort((a,b)=>a.at.localeCompare(b.at)||b.score-a.score||a.id.localeCompare(b.id)))if(r.sourceQualified&&r.sourceGate.verified&&r.deliveryWindowReady&&r.numericBaseline&&!seen.has(r.family)&&policyDecision(version,{baselinePassed:true,historyN:r.historyN!,currentSeason:r.currentSeason!,expectedMinutes:r.expectedMinutes!,minutesSD:r.minutesSD!,at:r.at}).eligible){seen.add(r.family);selected.push(r);}
  return{version,classification:'Retained pregame source/numeric/window replay; historical runtime authorisation and delivery state not inferred',selected:opportunityMetrics(selected),byFixture:clusteredScores(selected,'fixture'),byDate:clusteredScores(selected,'fixtureDate'),ids:selected.map(r=>r.id),improvementEstablished:false,productionEnabled:false};
 });
 return{version:'population-policy/1.4.6.1',at,counts:{observedQuoteSides:rows.length,uniqueFamilies:new Set(rows.map(r=>r.family)).size,completeTwoSidedQuoteSides:rows.filter(r=>r.completeTwoSided).length,exactTwoSidedSnapshots:pairIndex.size,sourceQualifiedForecastQuoteSides:rows.filter(r=>r.sourceQualified).length,sourceQualifiedFamilies:new Set(rows.filter(r=>r.sourceQualified).map(r=>r.family)).size,numericBaselineQuoteSides:rows.filter(r=>r.numericBaseline).length,evidenceQualifiedQuoteSides:rows.filter(r=>r.sourceQualified&&r.sourceGate.verified).length,evidenceAndNumericQuoteSides:rows.filter(r=>r.numericBaseline&&r.sourceGate.verified&&r.deliveryWindowReady).length,issuedRecommendations:issuedIds.size,issuedFamilies:issuedFamilies.size,settledDistinctPlayerFixtureProps:firstScores.size,prospectiveChallengers:null,prospectiveRegistry:'Separate journal, not joined by this audit'},sourceHistory:history.completeInjurySnapshots,policies,firstSourceQualifiedForecastScores:['points','rebounds','assists','threes'].map(prop=>{const g=[...firstScores.values()].filter(r=>r.prop===prop);return{prop,chosen:scoreRows(g.map(r=>r.chosen),thresholds.NBA[prop as Prop]),simple:scoreRows(g.map(r=>r.baseline),thresholds.NBA[prop as Prop]),originalChallenger:scoreRows(g.map(r=>r.challenger),thresholds.NBA[prop as Prop])};}),rows,limitations:['All observed sides retained, not all sides source-qualified or independently settled','Cursor-linked historical injury/fixture/roster receipts are replayed where complete; missing or stale evidence blocks the source gate','A uses unchanged source/numeric/window rules but cannot recreate historical owner authorisation, binding or delivery execution; selected evidence-qualified opportunities are not issued recommendations','One earliest forecast per player/fixture/prop for count scoring; first eligible snapshot per policy family; line/side selection never uses outcomes','Unissued observations are scored for accuracy only: no hypothetical positions, stake, P/L or ROI are assigned','The heuristic conservative EV remains an uncalibrated sensitivity penalty, not a confidence bound','No policy tuning or promotion; C/D abstention is missing evidence, not quality'],resources:{elapsedMs:performance.now()-started},networkRequests:0,outboundMessages:0,productionPolicyUnchanged:true};
}
