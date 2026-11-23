import {hash,type Prop} from '../core/domain';
import {Store} from '../core/store';
import {preparedFeatures,type FeatureSet} from '../research/features';
import {unknownMetadata,type ResearchRow} from '../research/dataset';
import {modelSpec,predict} from '../research/models';
import {thresholds} from '../research/experiment';
import {negativeBinomial,mixPMFs,average,rng,summary} from '../research/distributions';
import {calibrateCDF,fitCalibration,type Calibration} from '../research/calibration';
import {scoreRows,scoreOne,type ScoredPrediction} from '../research/scoring';
import * as original from './models-v146';
import * as corrected from './models';

export const HARDENING_VERSION='research-hardening/1.4.6.1';
type Case={id:string;row:ResearchRow;f:FeatureSet;stage:string};
export function matchedCases(store:Store,target:Prop|'minutes',frozen:any){
 const latest=new Map<string,ResearchRow>();
 for(const log of store.logs().filter(l=>!l.source.simulated&&l.event.league==='NBA')){
  if(![log.source,...(log.supportingSources??[])].every(s=>store.hasReceipt(s)))throw new Error('MISSING_GENUINE_SOURCE');
  const key=hash([log.event.id,log.playerId]),old=latest.get(key);if(!old||old.log.observedAt<log.observedAt)latest.set(key,{log,metadata:log.research??unknownMetadata()});
 }
 const all=[...latest.values()].sort((a,b)=>a.log.event.startsAt.localeCompare(b.log.event.startsAt));
 if(hash(all.map(r=>[r.log.event.id,r.log.playerId,r.log.source.hash,r.log.observedAt]))!==frozen.artifact.sourceDatasetHash)throw new Error('FROZEN_DATASET_MISMATCH');
 const history=new Map<string,ResearchRow[]>(),eligible:ResearchRow[]=[];
 for(const row of all){const l=row.log,p=history.get(l.playerId)??[];if(l.participated===true&&l.minutes!==null&&l.minutes>0&&Object.values(l.stats).every(v=>v!==null)){if(p.filter(r=>r.log.event.startsAt.slice(0,10)<l.event.startsAt.slice(0,10)).length>=10)eligible.push(row);p.push(row);history.set(l.playerId,p);}}
 const split=frozen.split,stage=(r:ResearchRow)=>r.log.event.startsAt.slice(0,10)<split.trainEnd?'train':r.log.event.startsAt.slice(0,10)<split.selectionEnd?'selection':r.log.event.startsAt.slice(0,10)<split.calibrationEnd?'calibration':'test',get=preparedFeatures(all,'retrospective'),cases:Case[]=[];
 for(const name of ['train','selection','calibration','test']){
  const rows=eligible.filter(r=>stage(r)===name).sort((a,b)=>hash([a.log.event.id,a.log.playerId]).localeCompare(hash([b.log.event.id,b.log.playerId]))).slice(0,frozen.boundedDeterministicSampling[name]).sort((a,b)=>a.log.event.startsAt.localeCompare(b.log.event.startsAt)||a.log.playerId.localeCompare(b.log.playerId));
  for(const row of rows){const f=get(row.log,target==='minutes'?'points':target);if(f)cases.push({id:hash([row.log.event.id,row.log.playerId,target]),row,f,stage:name});}
 }
 if(hash(cases.filter(r=>r.stage==='test').map(r=>r.id))!==frozen.cohortHash||hash(cases.filter(r=>r.stage==='train').map(r=>r.id))!==frozen.artifact.trainingIDs)throw new Error('FROZEN_COHORT_MISMATCH');
 return cases;
}
export function metricIntervals(a:ScoredPrediction[],b:ScoredPrediction[],lines:number[],cluster:'date'|'fixture'){
 if(!a.length||a.length!==b.length||a.some((r,i)=>r.id!==b[i].id))throw new Error('EXACT_PAIRED_CASES_REQUIRED');
 const names=['crps','nll','absoluteError','covered80','width80','brier','logLoss'] as const,groups=new Map<string,number[][]>();
 a.forEach((r,i)=>{const x=scoreOne(r.pmf,r.y,lines),y=scoreOne(b[i].pmf,b[i].y,lines),g=groups.get(r[cluster])??[];g.push(names.map(k=>x[k]-y[k]));groups.set(r[cluster],g);});
 const values=[...groups.values()],random=rng(1461),samples=names.map(()=>[] as number[]);
 for(let i=0;i<300;i++){const selected=Array.from({length:values.length},()=>values[Math.floor(random()*values.length)]).flat();names.forEach((_,j)=>samples[j].push(average(selected.map(r=>r[j]))));}
 return{cluster,clusters:groups.size,draws:300,seed:1461,interval95:Object.fromEntries(names.map((k,j)=>{const s=samples[j].sort((a,b)=>a-b);return[k,[s[7],s[292]]];})),exploratory:true};
}
export function hardeningEvaluation(store:Store,target:Prop|'minutes',frozen:any){
 const start=performance.now(),cpu=process.cpuUsage(),cases=matchedCases(store,target,frozen),train=cases.filter(r=>r.stage==='train'),selection=cases.filter(r=>r.stage==='selection'),cal=cases.filter(r=>r.stage==='calibration'),held=cases.filter(r=>r.stage==='test'),model=frozen.artifact.models.minutes as original.MinuteModel,phi=frozen.artifact.models.conditionalExcess,pmfs=new WeakMap<Case,Map<string,number[]>>();
 const attemptsRate=(f:FeatureSet)=>f.history.reduce((n,r)=>n+r.metadata.threeAttempts!,0)/f.history.reduce((n,r)=>n+r.log.minutes!,0),attemptsComplete=target==='threes'&&cases.every(r=>r.row.metadata.threeAttempts!==null&&r.f.history.every(h=>h.metadata.threeAttempts!==null)),attemptPhi=attemptsComplete?corrected.conditionalDispersion(train.map(r=>({f:{...r.f,rate:attemptsRate(r.f)},y:r.row.metadata.threeAttempts!,minutes:r.row.log.minutes!}))):null;
 const lines=target==='minutes'?[15.5,25.5,35.5]:thresholds.NBA[target];
 function old(r:Case,id:string):number[]{if(id==='last10-minutes')return negativeBinomial(r.f.minutes,Math.max(r.f.minutes,r.f.minutesSD**2));if(id==='attempts-makes')return original.attemptsMixture(r.f,original.minutesDistribution(r.f,model,'hierarchical'),phi)!;if(id.startsWith('minutes-')){const kind=id.includes('ridge')?'ridge':id.includes('hierarchical')?'hierarchical':'quantile',m=original.minutesDistribution(r.f,model,kind);return target==='minutes'?m:original.minuteMixture(r.f,m,phi);}return predict(r.f,modelSpec(id as any))!.pmf;}
 const simple=frozen.bestSimple;
 function distribution(r:Case,id:string):number[]{let cache=pmfs.get(r);if(!cache){cache=new Map();pmfs.set(r,cache);}if(cache.has(id))return cache.get(id)!;let result:number[];
  if(id==='original-ensemble')result=calibrateCDF(mixPMFs([old(r,frozen.artifact.selected),old(r,simple)],[frozen.artifact.ensembleWeight,1-frozen.artifact.ensembleWeight]),frozen.calibration);
  else if(id==='selected-corrected')result=mixPMFs([distribution(r,selected),old(r,simple)],[weight,1-weight]);
  else if(id.startsWith('corrected-')){const kind=id.includes('ridge')?'ridge':id.includes('hierarchical')?'hierarchical':'quantile',minutes=corrected.minutesDistribution(r.f,model,kind);result=target==='minutes'?minutes:corrected.minuteMixture(r.f,minutes,phi);}
  else if(id==='integrated-attempts-original-minutes')result=corrected.attemptsMixture(r.f,original.minutesDistribution(r.f,model,'hierarchical'),attemptPhi!)!;
  else if(id==='integrated-attempts-corrected-minutes')result=corrected.attemptsMixture(r.f,corrected.minutesDistribution(r.f,model,'hierarchical'),attemptPhi!)!;
  else result=old(r,id);
  summary(result);cache.set(id,result);return result;
 }
 const scored=(rows:Case[],id:string,calibration:Calibration={method:'raw'}):ScoredPrediction[]=>rows.map(r=>({id:r.id,date:r.row.log.event.startsAt.slice(0,10),fixture:r.row.log.event.id,season:r.row.log.event.season,player:r.row.log.playerId,team:r.row.log.teamId,lowMinute:r.f.minutes<15,y:target==='minutes'?Math.round(r.row.log.minutes!):r.row.log.stats[target]!,pmf:calibrateCDF(distribution(r,id),calibration)}));
 const challengers=['corrected-ridge','corrected-hierarchical','corrected-quantile',...(attemptsComplete?['integrated-attempts-original-minutes','integrated-attempts-corrected-minutes']:[])],selectionScores=challengers.map(id=>({id,crps:scoreRows(scored(selection,id),lines)!.crps})).sort((a,b)=>a.crps-b.crps),selected=selectionScores[0].id;let weight=1,best=Infinity,chosenWeight=1;
 for(const w of [0,.25,.5,.75,1]){weight=w;selection.forEach(r=>pmfs.get(r)?.delete('selected-corrected'));const loss=scoreRows(scored(selection,'selected-corrected'),lines)!.crps;if(loss<best){best=loss;chosenWeight=w;}}weight=chosenWeight;
 const days=[...new Set(cal.map(r=>r.row.log.event.startsAt.slice(0,10)))].sort(),mid=days[Math.floor(days.length/2)],fit=cal.filter(r=>r.row.log.event.startsAt.slice(0,10)<mid),choice=cal.filter(r=>r.row.log.event.startsAt.slice(0,10)>=mid),methods:Calibration[]=[{method:'raw'}];
 for(const method of ['sigmoid','isotonic'] as const){const c=fitCalibration(scored(fit,'selected-corrected'),method);if(c)methods.push(c);}
 const calibration=methods.map(c=>({c,crps:scoreRows(scored(choice,'selected-corrected',c),lines)!.crps})).sort((a,b)=>a.crps-b.crps)[0].c,baseline=scored(held,'original-ensemble'),control=scored(held,simple),originalMetrics=scoreRows(baseline,lines)!;
 if(hash(originalMetrics)!==hash(frozen.evaluations.find((r:any)=>r.id==='ensemble').metrics))throw new Error('ORIGINAL_ENSEMBLE_REPLAY_MISMATCH');
 const ids=[simple,'original-ensemble',...(target==='minutes'?['minutes-quantile']:['hierarchical-nb']),...(attemptsComplete?['attempts-makes']:[]),...challengers,'selected-corrected'];
 const evaluations=ids.map(id=>{if(performance.now()-start>150000)throw new Error('BOUNDED_EVALUATION_TIMEOUT');const rows=scored(held,id,id==='selected-corrected'?calibration:{method:'raw'}),metrics=scoreRows(rows,lines)!;return{id,metrics,versusOriginalByDate:metricIntervals(rows,baseline,lines,'date'),versusOriginalByFixture:metricIntervals(rows,baseline,lines,'fixture'),versusSimpleByDate:metricIntervals(rows,control,lines,'date'),...(target==='minutes'?{unroundedMinutesMAE:average(rows.map((r,i)=>Math.abs(summary(r.pmf).mean-held[i].row.log.minutes!))),tailNLL:rows.filter(r=>r.y<10||r.y>45).map(r=>scoreOne(r.pmf,r.y,lines).nll).reduce((acc,v,_,a)=>acc+v/a.length,0),tailN:rows.filter(r=>r.y<10||r.y>45).length,zeroTargetMass:rows.filter(r=>r.pmf[r.y]===0).length,events:[{name:'minutes below 10',test:(k:number)=>k<10},{name:'minutes above 48',test:(k:number)=>k>48},{name:'minutes above 45',test:(k:number)=>k>45}].map(e=>({name:e.name,n:rows.length,predicted:average(rows.map(r=>r.pmf.reduce((n,p,k)=>n+(e.test(k)?p:0),0))),observed:average(rows.map(r=>Number(e.test(r.y))))}))}:{})};});
 const used=process.cpuUsage(cpu);return{version:HARDENING_VERSION,target,classification:'retrospective development holdout; previously inspected cases; no independent promotion evidence',productionEnabled:false,promotionEligible:false,cohortHash:frozen.cohortHash,originalReplayExact:true,stages:frozen.stages,uncertainty:frozen.uncertainty,sourceDatasetHash:frozen.artifact.sourceDatasetHash,selected,weight,calibration,selectionScores,attemptPhi,calibrationStages:{fit:fit.length,choice:choice.length},evaluations,resources:{elapsedMs:performance.now()-start,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,maxRSSKiB:process.resourceUsage().maxRSS},limitations:['Frozen cohort reused after model deficiencies were inspected; prospective confirmation required','No new source-clock claims or simulated bookmaker prices','Minutes support is conditional positive continuous minutes rounded into bins 0..75; zero bin is not DNP','Training-only residual bandwidth; no test-fitted tail repair','Conditional attempt excess estimated from verified training attempt outcomes, rather than makes dispersion']};
}
