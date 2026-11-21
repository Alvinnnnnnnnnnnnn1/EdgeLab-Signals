import { type Dataset,rowKey,utcDay } from './dataset';
import { type Experiment } from './experiment';
import { preparedFeatures,type FeatureSet } from './features';
import { average,rng } from './distributions';

const methods=['last5','last10','minutes-ewa','empirical-bootstrap'] as const;
type Method=typeof methods[number];
export function minutesPrediction(f:FeatureSet,method:Method){
  const all=f.history.slice(-20).map(r=>r.log.minutes!),recent=all.slice(method==='last5'?-5:-10),weights=all.map((_,i)=>Math.exp(-Math.LN2*(all.length-1-i)/5));
  const mean=method==='last5'||method==='last10'?average(recent):method==='minutes-ewa'?all.reduce((n,m,i)=>n+m*weights[i],0)/weights.reduce((n,w)=>n+w,0):average(all);
  const residual=all.map(m=>m-average(all)).sort((a,b)=>a-b);
  return{mean,low:Math.max(0,mean+residual[Math.floor(.1*(residual.length-1))]),high:Math.min(f.league==='NBA'?75:65,mean+residual[Math.floor(.9*(residual.length-1))])};
}
export function evaluateMinutes(dataset:Dataset,report:Experiment){
  if(report.state!=='evaluated')return{state:'blocked',reason:'A frozen chronological benchmark is required'};
  const source=dataset.rows.filter(r=>r.log.event.league==='NBA'&&['regular','playoffs'].includes(r.metadata.phase)),get=preparedFeatures(source,report.mode),latest=new Map(source.map(r=>[rowKey(r),r]));
  const examples=[...latest.values()].filter(r=>(!report.cohort?.targetSeasons||report.cohort.targetSeasons.includes(r.log.event.season))&&r.log.participated===true&&r.log.minutes!==null).map(r=>({r,f:get(r.log,report.prop)})).filter((x):x is typeof x&{f:FeatureSet}=>x.f!==null);
  const selection=examples.filter(x=>utcDay(x.r.log.event.startsAt)>=report.split.selectionEnd&&utcDay(x.r.log.event.startsAt)<report.split.calibrationEnd);
  // Match the original earlier model-selection dates, before calibration.
  const choose=examples.filter(x=>utcDay(x.r.log.event.startsAt)>=report.split.trainEnd&&utcDay(x.r.log.event.startsAt)<report.split.selectionEnd);
  const testIds=new Set(report.frozenPredictions.map(r=>r.id)),test=examples.filter(x=>testIds.has(rowKey(x.r)));
  const metrics=(rows:typeof test,method:Method)=>{const scores=rows.map(x=>{const p=minutesPrediction(x.f,method),actual=x.r.log.minutes!;return{error:p.mean-actual,absolute:Math.abs(p.mean-actual),covered:Number(actual>=p.low&&actual<=p.high),width:p.high-p.low};});return{playerGames:rows.length,mae:scores.length?average(scores.map(s=>s.absolute)):null,bias:scores.length?average(scores.map(s=>s.error)):null,coverage80:scores.length?average(scores.map(s=>s.covered)):null,width80:scores.length?average(scores.map(s=>s.width)):null};};
  const selected=methods.slice().sort((a,b)=>metrics(choose,a).mae!-metrics(choose,b).mae!)[0],groups=new Map<string,number[]>();
  for(const x of test){const day=utcDay(x.r.log.event.startsAt),delta=Math.abs(minutesPrediction(x.f,selected).mean-x.r.log.minutes!)-Math.abs(minutesPrediction(x.f,'last10').mean-x.r.log.minutes!);groups.set(day,[...(groups.get(day)??[]),delta]);}
  const clusters=[...groups.values()],random=rng(991),samples=Array.from({length:500},()=>average(Array.from({length:clusters.length},()=>clusters[Math.floor(random()*clusters.length)]).flat())).sort((a,b)=>a-b);
  return{state:'evaluated',datasetId:dataset.id,mode:report.mode,targetSeasons:report.cohort?.targetSeasons??null,selectionRows:choose.length,calibrationRows:selection.length,selectedByEarlierMAE:selected,baseline:'last10',testPlayerGames:test.length,testDates:groups.size,
    models:methods.map(method=>({method,...metrics(test,method),projectedRoles:{lowMinute:metrics(test.filter(x=>x.f.minutes<15),method),regularRotation:metrics(test.filter(x=>x.f.minutes>=15),method)}})),pairedMAEInterval95:clusters.length?[samples[12],samples[487]]:null,
    limitations:['Retrospective research; no historical publication availability claim.','Actual target minutes used only as a scoring label.','Starter/bench, teammate-absence and restriction effects are unverified and were not fabricated.','The existing minutes Monte Carlo propagates earlier minutes uncertainty; this diagnostic does not silently replace its projector.'],qualifiedEligible:false};
}
