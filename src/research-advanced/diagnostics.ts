import type {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {Store} from '../core/store';
import {hash,ms,quoteSchema,termsSchema,quoteFresh,ev,type Quote,type Terms} from '../core/domain';
import {probabilities} from '../core/models';
import {summary} from '../research/distributions';
import {comparableSides} from '../research/markets';
import {SUGGESTION_POLICY,type ExperimentalForecast} from '../suggestions/forecasts';

export interface GateReason {gate:string;category:'structural'|'policy';reason:string;}
/** Offline mirror of every numeric production condition. It neither issues nor
 * changes thresholds. Structural evidence replay is supplied separately. */
export function numericGateDiagnostics(q:Quote,pair:Quote|null,f:ExperimentalForecast,t:Terms|null,at:string){
 const reasons:GateReason[]=[];
 const add=(condition:boolean,gate:string,category:GateReason['category'],reason:string)=>{if(condition)reasons.push({gate,category,reason});};
 const structural=(gate:string,fn:()=>void)=>{try{fn();}catch(e){reasons.push({gate,category:'structural',reason:(e as Error).message});}};
 structural('QUOTE_SCHEMA',()=>{quoteSchema.parse(q);});
 structural('TERMS_IDENTITY',()=>{if(!t)throw Error('Verified settlement terms missing');termsSchema.parse(t);if(q.bookmaker!==t.bookmaker||q.event.league!=='NBA'||t.league!=='NBA'||t.prop!==q.prop||q.termsId!==t.id)throw Error('Exact bookmaker/market terms mismatch');});
 add(hash(q.event)!==hash(f.event)||q.playerId!==f.playerId||q.teamId!==f.teamId||q.prop!==f.prop,'FORECAST_IDENTITY','structural','Exact frozen forecast identity mismatch');
 add(f.policy!==SUGGESTION_POLICY||f.validated!==false||hash(f.inputs)!==f.inputHash,'FORECAST_INTEGRITY','structural','Frozen policy/input integrity invalid');
 add(ms(f.at)>ms(at)||ms(f.at)>=ms(f.event.startsAt)-120000,'FORECAST_CLOCK','structural','Forecast was unavailable or registered too late');
 add(!quoteFresh(q,at,180,120),'QUOTE_FRESHNESS','structural','Pregame price is stale or past T-2');
 add(f.n<10,'HISTORY_SAMPLE','policy','Fewer than ten complete earlier games');
 add(f.currentSeasonGames<5,'SEASON_SAMPLE','policy','Fewer than five current-season games');
 add(ms(at)-ms(f.lastGameAt)>30*86400000,'HISTORY_RECENCY','policy','History older than thirty days');
 add(f.expectedMinutes<18,'MINUTES_MEAN','policy','Expected minutes below eighteen');
 add(f.minutesSD>6,'MINUTES_VOLATILITY','policy','Minutes SD above six');
 add(f.teamChanged,'TEAM_CHANGE','policy','Recent team change');
 let fair:number|null=null;
 structural('EXACT_OPPOSITE_SIDE',()=>{if(!pair)throw Error('Exact opposite-side market missing/ambiguous');const m=q.side==='over'?comparableSides(q,pair):comparableSides(pair,q);fair=q.side==='over'?m.over:m.under;});
 let values:null|{win:number;push:number;estimatedEV:number;conservativeEV:number;disagreement:number;score:number}=null;
 structural('DISTRIBUTION_VALIDITY',()=>{
  for(const d of [f.distribution,f.baseline,f.challenger,...f.stress])summary(d);
  const p=probabilities(f.distribution,q.line,q.side),base=probabilities(f.baseline,q.line,q.side),challenger=probabilities(f.challenger,q.line,q.side);
  const disagreement=Math.max(Math.abs(p.win-base.win),Math.abs(p.win-challenger.win)),estimatedEV=ev(p.win,p.push,q.decimalOdds);
  const conservativeEV=Math.min(...[f.distribution,f.baseline,f.challenger,...f.stress].map(d=>{const s=probabilities(d,q.line,q.side),penalty=.5*Math.sqrt(s.win*(1-s.win)/f.n);return ev(Math.max(0,s.win-penalty),s.push,q.decimalOdds);}));
  add(q.decimalOdds<1.5||q.decimalOdds>2.4,'PRICE_RANGE','policy','Price outside 1.5–2.4');
  add(p.win<.55||p.win>.85,'PROBABILITY_RANGE','policy','Conditional win probability outside .55–.85');
  add(disagreement>.12,'MODEL_DISAGREEMENT','policy','Model disagreement above .12');
  add(estimatedEV<.04,'ESTIMATED_EV','policy','Estimated EV below .04');
  add(conservativeEV<=0,'HEURISTIC_SENSITIVITY','policy','Heuristic sensitivity EV is not positive');
  add(fair!==null&&p.win/(1-p.push)<=fair,'FAIR_MARKET_ADVANTAGE','policy','No advantage over paired no-vig market');
  values={win:p.win,push:p.push,estimatedEV,conservativeEV,disagreement,score:.65*p.win+.2*Math.min(.2,estimatedEV)+.15*Math.min(1,f.n/30)-.2*disagreement};
 });
 return{eligible:reasons.length===0,firstReason:reasons[0]??null,reasons,fair,values};
}

/** The archive may refer to an active V1.4.7 journal forecast, not a row in
 * experimental_forecasts. Missing either store must remain explicit. */
export function archivedForecast(source:Store,journal:DatabaseSync|null,id:string){
 const original=source.db.prepare('SELECT body FROM experimental_forecasts WHERE id=?').get(id);
 if(original)return{forecast:JSON.parse(String(original.body)) as ExperimentalForecast,origin:'original-store' as const,prediction:null};
 const raw=journal?.prepare('SELECT body FROM challenger_predictions WHERE id=?').get(id);
 if(!raw)throw Error('ARCHIVED_FORECAST_NOT_FOUND');
 const p=JSON.parse(String(raw.body));
 const matches=journal!.prepare('SELECT body FROM production_ready WHERE event_id=? AND player_id=? AND prop=?').all(p.event.id,p.playerId,p.prop).map(r=>JSON.parse(String(r.body))).filter(r=>r.forecast?.id===id&&r.predictionId===id);
 if(matches.length!==1)throw Error('ARCHIVED_FORECAST_NOT_FOUND');const row={body:JSON.stringify(matches[0])};
 const ready=JSON.parse(String(row.body)),f=ready.forecast as ExperimentalForecast;
 if(f.id!==id||ready.bodyHash!==hash(f)||f.artifactHash!==hash(f.inputs.artifact))throw Error('ARCHIVED_ACTIVE_FORECAST_HASH_MISMATCH');
 const {id:predictionId,inputHash,...body}=p;
 if(predictionId!==f.id||inputHash!==hash(body)||p.control?.inputHash!==f.inputHash||p.at!==f.at||hash(p.distribution)!==hash(f.distribution)||hash(p.event)!==hash(f.event)||p.playerId!==f.playerId||p.teamId!==f.teamId||p.prop!==f.prop||ready.artifactId!==p.artifact.id||p.control.at!==f.at||hash(p.control.distribution)!==hash(p.baselines.production.distribution)||p.baselines.production.sameInputHash!==f.inputHash)throw Error('MATCHED_CONTROL_IDENTITY_OR_CLOCK_MISMATCH');
 return{forecast:f,origin:'active-journal' as const,prediction:p};
}

export function verifyForecastInputs(source:Store,journal:DatabaseSync|null,f:ExperimentalForecast,cache=new Map<string,{bodyHash:string;log:any;latestReceipt?:number}>(),manifests=new Map<string,{references:number;latestObserved:number;latestReceipt:number;latestGame:number}>()){
 if(f.inputHash!==hash(f.inputs)||ms(f.inputs.cutoff)>ms(f.at)||ms(f.at)>=ms(f.event.startsAt)-120000)throw Error('FORECAST_INPUT_OR_CUTOFF_INVALID');
 const inputs=f.inputs as typeof f.inputs&{manifestId?:string;inputCount?:number};
 const artifact=f.inputs.artifact as {at?:string;generatedAt?:string};if(ms(artifact.at??artifact.generatedAt??f.at)>ms(f.at))throw Error('FUTURE_ARTIFACT');
 for(const r of [f.inputs.fixtureSource,f.inputs.rosterSource])if(r.simulated||ms(r.retrievedAt)>ms(f.inputs.cutoff)||!source.hasReceipt(r))throw Error('FEATURE_RECEIPT_UNAVAILABLE_AT_CUTOFF');
 const prior=inputs.manifestId?manifests.get(inputs.manifestId):undefined;
 if(prior){if(prior.references!==inputs.inputCount||prior.latestObserved>=ms(f.inputs.cutoff)||prior.latestReceipt>ms(f.inputs.cutoff)||prior.latestGame>=ms(f.event.startsAt))throw Error('FEATURE_CLOCK_OR_REVISION_MISMATCH');return{references:prior.references,cutoff:f.inputs.cutoff,manifestId:inputs.manifestId};}
 let refs:{id:string;bodyHash?:string;observedAt?:string}[]=f.inputs.inputRefs.map(id=>({id}));
 if(inputs.manifestId){const m=journal?.prepare('SELECT body FROM input_manifests WHERE id=?').get(inputs.manifestId);if(!m)throw Error('FROZEN_INPUT_MANIFEST_MISSING');const text=gunzipSync(m.body as Uint8Array).toString();if(hash(text)!==inputs.manifestId)throw Error('FROZEN_INPUT_MANIFEST_HASH_MISMATCH');refs=JSON.parse(text);if(refs.length!==inputs.inputCount)throw Error('FROZEN_INPUT_MANIFEST_COUNT_MISMATCH');}
 const retained=(r:Quote['source'])=>{if(r.simulated||ms(r.retrievedAt)>ms(f.inputs.cutoff)||!source.hasReceipt(r))throw Error('FEATURE_RECEIPT_UNAVAILABLE_AT_CUTOFF');};
 let latestObserved=0,latestReceipt=0,latestGame=0;
 for(const ref of refs){let saved=cache.get(ref.id);if(!saved){const row=source.db.prepare('SELECT body FROM logs WHERE id=?').get(ref.id);if(!row)throw Error('FROZEN_FEATURE_BODY_MISMATCH');saved={bodyHash:hash(String(row.body)),log:JSON.parse(String(row.body))};cache.set(ref.id,saved);}if(ref.bodyHash&&saved.bodyHash!==ref.bodyHash)throw Error('FROZEN_FEATURE_BODY_MISMATCH');const l=saved.log;if(ms(l.observedAt)>=ms(f.inputs.cutoff)||ms(l.event.startsAt)>=ms(f.event.startsAt)||ref.observedAt&&ref.observedAt!==l.observedAt)throw Error('FEATURE_CLOCK_OR_REVISION_MISMATCH');if(saved.latestReceipt===undefined){const receipts=[l.source,...(l.supportingSources??[])];for(const receipt of receipts)retained(receipt);saved.latestReceipt=Math.max(...receipts.map(r=>ms(r.retrievedAt)));}if(saved.latestReceipt>ms(f.inputs.cutoff))throw Error('FEATURE_RECEIPT_UNAVAILABLE_AT_CUTOFF');latestObserved=Math.max(latestObserved,ms(l.observedAt));latestReceipt=Math.max(latestReceipt,saved.latestReceipt);latestGame=Math.max(latestGame,ms(l.event.startsAt));}
 if(inputs.manifestId)manifests.set(inputs.manifestId,{references:refs.length,latestObserved,latestReceipt,latestGame});
 return{references:refs.length,cutoff:f.inputs.cutoff,manifestId:inputs.manifestId??null};
}

export const counterfactualPolicies=[
 {id:'unchanged-production-numeric',omit:[]},
 {id:'without-heuristic-sensitivity',omit:['HEURISTIC_SENSITIVITY']},
 {id:'stricter-history-and-minutes',omit:[]},
] as const;
export function counterfactualEligible(id:typeof counterfactualPolicies[number]['id'],reasons:GateReason[],f:Pick<ExperimentalForecast,'n'|'currentSeasonGames'|'expectedMinutes'|'minutesSD'>){
 const policy=counterfactualPolicies.find(p=>p.id===id)!;
 if(reasons.some(r=>!(policy.omit as readonly string[]).includes(r.gate)))return false;
 return id!=='stricter-history-and-minutes'||f.n>=20&&f.currentSeasonGames>=10&&f.expectedMinutes>=24&&f.minutesSD<=4.5;
}
