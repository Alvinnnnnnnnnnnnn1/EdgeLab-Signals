import { z } from 'zod';
import { hash, ms, stamp, leagueSchema, propSchema, type GameLog, type Prop, type League, type Quote } from './domain';
import { candidates, candidateSchema, MODEL_VERSION, eligibleLogs, fitDistribution, probabilities, type Candidate } from './models';
export const validationSchema=z.object({
  modelVersion:z.literal(MODEL_VERSION), league:leagueSchema, prop:propSchema, selected:candidateSchema,
  generatedAt:stamp, datasetHash:z.string().regex(/^[a-f0-9]{64}$/), reportHash:z.string().regex(/^[a-f0-9]{64}$/),
  samples:z.number().int().nonnegative(), dates:z.number().int().nonnegative(), players:z.number().int().nonnegative(),
  asOfVerified:z.boolean(), simulated:z.boolean(), eligible:z.boolean(),
  selectionBrier:z.number().nullable(), baselineBrier:z.number().nullable(), testBrier:z.number().nullable(), baselineTestBrier:z.number().nullable(),
  testLogLoss:z.number().nullable(), baselineTestLogLoss:z.number().nullable(),
}).strict();
export type Validation=z.infer<typeof validationSchema>;
const lines:Record<League,Record<Prop,number[]>>={NBA:{points:[10.5,20.5,30.5],rebounds:[3.5,6.5,9.5],assists:[2.5,4.5,6.5],threes:[.5,1.5,2.5]},NBL:{points:[8.5,15.5,22.5],rebounds:[2.5,4.5,6.5],assists:[1.5,3.5,5.5],threes:[.5,1.5,2.5]}};
interface Score {eventId:string; playerId:string; at:string; line:number; y:number; predictions:Record<Candidate,number>;}
function metrics(scores:Score[],candidate:Candidate) {
  if(!scores.length)return null;
  return { brier:scores.reduce((n,s)=>n+(s.predictions[candidate]-s.y)**2,0)/scores.length,
    logLoss:scores.reduce((n,s)=>{const p=Math.max(1e-9,Math.min(1-1e-9,s.predictions[candidate]));return n-s.y*Math.log(p)-(1-s.y)*Math.log(1-p);},0)/scores.length };
}
export function evaluate(logs:GameLog[],league:League,prop:Prop,at:string,mode:'as-of'|'retrospective'='as-of') {
  const rows=[...logs].filter(r=>r.event.league===league && r.final && r.participated && r.stats[prop]!==null && r.minutes!==null && ms(r.observedAt)<=ms(at));
  const latest=new Map<string,GameLog>(); for(const r of rows){const key=`${r.event.id}:${r.playerId}`;if(!latest.has(key)||ms(latest.get(key)!.observedAt)<ms(r.observedAt))latest.set(key,r);}
  const unique=[...latest.values()].sort((a,b)=>ms(a.event.startsAt)-ms(b.event.startsAt));
  const scores:Score[]=[];
  for(const target of unique){
    // No target minutes, target stats, future observations, or same-day results enter features.
    const cutoff=target.event.startsAt;
    const q={event:target.event,playerId:target.playerId,prop} as Quote;
    const history=eligibleLogs(unique,q,cutoff,mode==='retrospective');
    if(history.length<30)continue;
    const recent=history.slice(-10),m=recent.reduce((n,r)=>n+r.minutes!,0)/recent.length;
    const sd=Math.sqrt(recent.reduce((n,r)=>n+(r.minutes!-m)**2,0)/recent.length);
    const ds=Object.fromEntries(candidates.map(c=>[c,fitDistribution(history,prop,league,m,sd,c)])) as Record<Candidate,number[]>;
    for(const line of lines[league][prop]) scores.push({eventId:target.event.id,playerId:target.playerId,at:cutoff,line,y:Number(target.stats[prop]!>line),predictions:Object.fromEntries(candidates.map(c=>[c,probabilities(ds[c],line,'over').win])) as Record<Candidate,number>});
  }
  const dates=[...new Set(scores.map(s=>s.at.slice(0,10)))].sort();
  // Candidate selection uses only earlier chronological block; later block remains untouched until scoring.
  const split=dates[Math.floor(dates.length*.6)]??'9999';
  const selection=scores.filter(s=>s.at.slice(0,10)<split),test=scores.filter(s=>s.at.slice(0,10)>=split);
  const selectionMetrics=Object.fromEntries(candidates.map(c=>[c,metrics(selection,c)])) as Record<Candidate,ReturnType<typeof metrics>>;
  const selected=[...candidates].sort((a,b)=>(selectionMetrics[a]?.brier??Infinity)-(selectionMetrics[b]?.brier??Infinity))[0];
  const testMetrics=Object.fromEntries(candidates.map(c=>[c,metrics(test,c)])) as Record<Candidate,ReturnType<typeof metrics>>;
  const b=testMetrics.historical, t=testMetrics[selected];
  const playerGames=new Set(test.map(s=>`${s.playerId}:${s.eventId}`)).size, players=new Set(test.map(s=>s.playerId)).size;
  const bins=Array.from({length:10},(_,i)=>{const rows=test.filter(s=>s.predictions[selected]>=i/10&&s.predictions[selected]<(i+1)/10);return {from:i/10,to:(i+1)/10,n:rows.length,predicted:rows.length?rows.reduce((n,s)=>n+s.predictions[selected],0)/rows.length:null,observed:rows.length?rows.reduce((n,s)=>n+s.y,0)/rows.length:null};});
  const report={mode,league,prop,modelVersion:MODEL_VERSION,generatedAt:at,datasetHash:hash(unique),thresholds:lines[league][prop],selectionMetrics,testMetrics,selected,
    selectionPlayerGames:new Set(selection.map(s=>`${s.playerId}:${s.eventId}`)).size,testPlayerGames:playerGames,thresholdScores:test.length,players,dates:dates.length,testDates:new Set(test.map(s=>s.at.slice(0,10))).size,simulated:unique.some(r=>r.source.simulated),calibration:bins,
    limitations:['Correlated thresholds do not increase independent sample size.','No historical market-price edge, ROI or profit is established.','Context is historical-minutes-only; current injury effects are not validated.',...(mode==='retrospective'?['Original historical publication times unverified; cannot activate live signals.']:[])],scores};
  const simulated=unique.some(r=>r.source.simulated), asOfVerified=mode==='as-of';
  const validation:Validation={modelVersion:MODEL_VERSION,league,prop,selected,generatedAt:at,datasetHash:report.datasetHash,reportHash:hash(report),samples:playerGames,dates:report.testDates,players,
    asOfVerified,simulated,eligible:asOfVerified&&!simulated&&playerGames>=200&&players>=10&&report.testDates>=30&&!!t&&!!b&&t.brier<=b.brier&&t.logLoss<=b.logLoss,
    selectionBrier:selectionMetrics[selected]?.brier??null,baselineBrier:selectionMetrics.historical?.brier??null,testBrier:t?.brier??null,baselineTestBrier:b?.brier??null,testLogLoss:t?.logLoss??null,baselineTestLogLoss:b?.logLoss??null};
  return {report,validation};
}
