import{hash,type Prop}from'../core/domain';
import{chronologicalSplit,thresholds}from'../research/experiment';
import{fitBoosted,boostedMean}from'../research/boost';
import{negativeBinomial,attemptMakeDistribution,summary}from'../research/distributions';
import{fitCalibration,calibrateCDF,type Calibration}from'../research/calibration';
import{scoreRows,pairedDifference,type ScoredPrediction}from'../research/scoring';
import{INTELLIGENCE_VERSION}from'./types';
import type{FeatureObservation}from'./features';

const avg=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
const median=(xs:number[])=>{const a=xs.slice().sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
export function fitResearchEncoding(train:FeatureObservation[]){
 if(!train.length||train.some(r=>hash(r.names)!==hash(train[0].names)))throw new Error('CONSISTENT_RESEARCH_FEATURES_REQUIRED');
 const indices=train[0].names.map((_,i)=>i).filter(i=>train.some(r=>r.values[i]!==null)),medians=indices.map(i=>median(train.map(r=>r.values[i]).filter((v):v is number=>v!==null)));
 return{indices,medians,names:[...indices.map(i=>train[0].names[i]),...indices.map(i=>`${train[0].names[i]}:missing`)],encode:(r:FeatureObservation)=>[...indices.map((i,j)=>r.values[i]??medians[j]),...indices.map(i=>Number(r.values[i]===null))]};
}
type Candidate={id:string;predict:(r:FeatureObservation)=>number[];artifact:unknown};
type Labeled=FeatureObservation&{outcome:NonNullable<FeatureObservation['outcome']>};
function baselineMean(r:FeatureObservation,id:string,minutes:boolean){if(minutes)return r.values[4]!;const i=['last5','last10','ewa','season-shrunk'].indexOf(id);return i>=0?r.values[i]!:r.values[4]!*r.values[6]!;}
function baseline(r:FeatureObservation,id:string,minutes:boolean){const mean=baselineMean(r,id,minutes),dispersion=Math.max(.5,r.historyMean**2/Math.max(.1,r.historyVariance-r.historyMean));return minutes?negativeBinomial(mean,mean+Math.max(0,r.values[5]!**2-mean)):negativeBinomial(mean,mean+mean**2/dispersion);}
function score(r:Labeled,pmf:number[],minutes:boolean):ScoredPrediction{return{id:r.id,date:r.event.startsAt.slice(0,10),fixture:r.event.id,season:r.event.season,player:r.playerId,team:r.teamId,lowMinute:r.role==='low-minutes',y:minutes?Math.round(r.outcome.minutes):r.outcome.value,pmf};}
export function evaluateChallengers(input:FeatureObservation[],target:Prop|'minutes',guard:()=>void=()=>{}){
 if(input.some(r=>r.mode!=='as-of'||!r.sourceTimeVerified||!r.provenance.fixtureSourceHash))throw new Error('ORIGINAL_PREGAME_SOURCE_AVAILABILITY_REQUIRED');
 if(input.some(r=>r.prop!==(target==='minutes'?'points':target)))throw new Error('EXACT_EVALUATION_PROP_REQUIRED');
 if(new Set(input.map(r=>r.id)).size!==input.length||new Set(input.map(r=>r.mode)).size>1)throw new Error('UNIQUE_SINGLE_MODE_COHORT_REQUIRED');
 const rows=input.filter((r):r is Labeled=>r.outcome!==null).sort((a,b)=>a.event.startsAt.localeCompare(b.event.startsAt)||a.id.localeCompare(b.id)),split=chronologicalSplit(rows.map(r=>r.event.startsAt.slice(0,10)));
 const base={version:INTELLIGENCE_VERSION,target,namespace:`ri-challenger/1.4.4/${target}`,snapshotIds:[...new Set(input.map(r=>r.provenance.snapshotId))],mode:'as-of',inputRows:rows.length,pendingObservations:input.length-rows.length,split,productionEnabled:false,promotion:{eligible:false,reasons:['Observational research only; later owner-approved versioned deployment required','Retrospective improvements cannot establish prospective superiority']}};
 if(!split)return{...base,state:'blocked',reasons:['At least 20 source-qualified dates required'],models:[]};
 const date=(r:FeatureObservation)=>r.event.startsAt.slice(0,10),train=rows.filter(r=>date(r)<split.trainEnd),selection=rows.filter(r=>date(r)>=split.trainEnd&&date(r)<split.selectionEnd),calibration=rows.filter(r=>date(r)>=split.selectionEnd&&date(r)<split.calibrationEnd),test=rows.filter(r=>date(r)>=split.calibrationEnd),minutes=target==='minutes',lines=minutes?[15.5,25.5,35.5]:thresholds.NBA[target];
 if(train.length<200||![selection,calibration,test].every(r=>r.length))return{...base,state:'blocked',reasons:['Require 200 earlier training rows and nonempty ordered selection/calibration/holdout stages'],models:[]};
 guard();const encoding=fitResearchEncoding(train),fit=train.slice().sort((a,b)=>hash(a.id).localeCompare(hash(b.id))).slice(0,1000),x=fit.map(encoding.encode),y=fit.map(r=>minutes?r.outcome.minutes:r.outcome.value),boost=fitBoosted(x,y,x[0].map((_,i)=>i),12);
 const baselineIDs=minutes?['last10-minutes']:['last5','last10','ewa','season-shrunk','recent-rate'];
 const baselineID=baselineIDs.slice().sort((a,b)=>scoreRows(selection.map(r=>score(r,baseline(r,a,minutes),minutes)),lines)!.crps-scoreRows(selection.map(r=>score(r,baseline(r,b,minutes),minutes)),lines)!.crps)[0];
 const candidates:Candidate[]=[{id:'opportunity-context-boost',artifact:boost,predict:r=>{const mean=Math.min(minutes?48:150,boostedMean(boost,encoding.encode(r)));return negativeBinomial(mean,mean+boost.varianceExcess);}}];
 if(!minutes){const minutesBoost=fitBoosted(x,fit.map(r=>r.outcome.minutes),x[0].map((_,i)=>i),12),getMinutes=(r:FeatureObservation)=>Math.max(1,Math.min(48,boostedMean(minutesBoost,encoding.encode(r))));
  candidates.push({id:'minutes-opportunity-nb',artifact:{minutesBoost},predict:r=>{const mean=r.values[6]!*getMinutes(r),d=Math.max(.5,r.historyMean**2/Math.max(.1,r.historyVariance-r.historyMean));return negativeBinomial(mean,mean+mean**2/d);}});
  const ai=input[0].names.indexOf('threeAttemptsPerMinute'),pi=input[0].names.indexOf('threeMakeRate');
  if(target==='threes'&&rows.every(r=>r.values[ai]!==null&&r.values[pi]!==null))candidates.push({id:'attempts-makes-context',artifact:{minutesBoost,shootingPrior:'Past-player smoothed percentage; fixed concentration 20'},predict:r=>{const attempts=r.values[ai]!*getMinutes(r),p=r.values[pi]!;return attemptMakeDistribution(attempts,Math.max(attempts,attempts*1.5),Math.max(.001,p*20),Math.max(.001,(1-p)*20));}});
 }
 guard();const selectionMetrics=candidates.map(c=>({id:c.id,metrics:scoreRows(selection.map(r=>score(r,c.predict(r),minutes)),lines)!})),selectedID=selectionMetrics.slice().sort((a,b)=>a.metrics.crps-b.metrics.crps)[0].id,selected=candidates.find(c=>c.id===selectedID)!;
 // Fit calibration on the first half and choose its method on the second half.
 // Neither the test labels nor candidate holdout scores participate in fitting.
 const calibrationDates=[...new Set(calibration.map(date))].sort(),mid=calibrationDates[Math.floor(calibrationDates.length/2)],calFit=calibration.filter(r=>date(r)<mid),calChoose=calibration.filter(r=>date(r)>=mid),fitRows=calFit.map(r=>score(r,selected.predict(r),minutes));
 const methods:Calibration[]=[{method:'raw'}];if(fitRows.length)for(const method of ['sigmoid','isotonic']as const){const c=fitCalibration(fitRows,method);if(c)methods.push(c);}
 const choices=methods.map(method=>({method,metrics:scoreRows(calChoose.map(r=>score(r,calibrateCDF(selected.predict(r),method),minutes)),lines)})),raw=choices[0].metrics;
 const calibrationMethod=choices.filter(c=>c.metrics&&raw&&c.metrics.brier<=raw.brier&&c.metrics.logLoss<=raw.logLoss).sort((a,b)=>a.metrics!.brier-b.metrics!.brier)[0]?.method??methods[0];
 const testIDs=hash(test.map(r=>r.id)),baseTest=test.map(r=>score(r,baseline(r,baselineID,minutes),minutes));
 const models=candidates.map(c=>{guard();const predicted=test.map(r=>score(r,calibrateCDF(c.predict(r),c.id===selectedID?calibrationMethod:{method:'raw'}),minutes)),metrics=scoreRows(predicted,lines)!;
  return{id:c.id,selected:c.id===selectedID,metrics,matchedCohortHash:testIDs,versusSimpleByDate:pairedDifference(predicted,baseTest,lines,144,200,'date'),versusSimpleByFixture:pairedDifference(predicted,baseTest,lines,145,200,'fixture'),roles:Object.fromEntries(['low-minutes','rotation','high-minutes'].map(role=>[role,scoreRows(predicted.filter((_,i)=>test[i].role===role),lines)])),minutesAccuracy:minutes?{mae:avg(predicted.map((p,i)=>Math.abs(summary(p.pmf).mean-test[i].outcome.minutes))),bias:avg(predicted.map((p,i)=>summary(p.pmf).mean-test[i].outcome.minutes)),distributionLabels:'Rounded to whole minutes; point MAE uses original minutes'}:null};});
 const frozenMatched=test.filter(r=>r.deployed),frozenPredictions=frozenMatched.map(r=>score(r,r.deployed!.pmf,false)),selectedPredictions=frozenMatched.map(r=>score(r,calibrateCDF(selected.predict(r),calibrationMethod),minutes));
 const frozenComparison=!minutes&&frozenMatched.length?{rows:frozenMatched.length,metrics:scoreRows(frozenPredictions,lines),challenger:scoreRows(selectedPredictions,lines),pairedByFixture:pairedDifference(selectedPredictions,frozenPredictions,lines,146,200,'fixture')}:null;
 const artifact={namespace:base.namespace,snapshotIds:base.snapshotIds,target,featureNames:rows[0].names,encoding:{indices:encoding.indices,medians:encoding.medians,names:encoding.names},fittedTrainingIDs:hash(fit.map(r=>r.id)),trainedBefore:split.trainEnd,selectedBefore:split.selectionEnd,calibratedBefore:split.calibrationEnd,selected:selectedID,calibration:calibrationMethod,candidates:candidates.map(c=>({id:c.id,artifact:c.artifact})),testCohortHash:testIDs,productionEnabled:false};
 return{...base,state:'evaluated',stages:{train:train.length,boundedTrainingFit:fit.length,selection:selection.length,calibration:calibration.length,calibrationFit:calFit.length,calibrationChoose:calChoose.length,heldOut:test.length},featureCoverage:rows[0].names.map((name,i)=>({name,known:rows.filter(r=>r.values[i]!==null).length,total:rows.length,usedByChallenger:encoding.indices.includes(i)})),baseline:{id:baselineID,selectionOnly:true,metrics:scoreRows(baseTest,lines),matchedCohortHash:testIDs},selectionMetrics,models,frozenDeployedComparison:frozenComparison,frozenDeployedUnavailable:minutes?'No separate deployed minutes artifact':frozenComparison?null:'No matched held-out outcomes after original artifact publication/registration; no future artifact replay',marketComparison:{matchedFinalPrices:0,state:'Not evaluated; no exact historical market-price cohort supplied'},artifact:{...artifact,id:hash(artifact)},limitations:['Conditional on participation, not a DNP/availability model','Chronological labels do not establish original pregame source availability in retrospective mode','All candidate exploratory holdout scores are disclosed; do not reuse this holdout to promote a challenger','Threshold scores and player props within one fixture are correlated; bootstrap clusters retain those dependencies','Sparse season/player coverage can bias team/opponent estimates; no causal teammate-absence inference']};
}
