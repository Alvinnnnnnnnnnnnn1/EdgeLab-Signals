import {observedMarketComparison} from './market-metrics';
import {gzipSync} from 'node:zlib';
import {Store} from '../core/store';
import {hash,ms,nowISO,props,quoteFresh,quoteSchema,termsSchema,type Prop,type Quote,type GameLog} from '../core/domain';
import {preparedFeatures} from '../research/features';
import {researchRows} from '../research/metadata';
import {researchModels} from '../research/shadow';
import {artifactSchema} from '../research/inference';
import {predict,modelSpec} from '../research/models';
import {calibrateCDF} from '../research/calibration';
import {mixPMFs,summary,negativeBinomial} from '../research/distributions';
import {scoreRows,type ScoredPrediction} from '../research/scoring';
import {metricIntervals} from '../research-advanced/hardening';
import {minutesDistribution,minuteMixture} from '../research-advanced/models';
import {ChallengerJournal,challengerCode} from '../research-advanced/prospective';
import {fixtureProof,rosterProof,retained,SUGGESTION_POLICY,type ExperimentalForecast} from '../suggestions/forecasts';
import {assessSuggestion,currentPlayerEvidence} from '../suggestions/engine';
import {grade} from '../core/settlement';
import {notificationWindow} from '../research/schedule';
import {ROUTING_VERSION,type RoutingPlan} from './router';

export interface ComparisonPlan extends RoutingPlan {sourcePath:string;artifacts:Record<Prop,string>;originalArtifacts:Record<Prop,string>;code:ReturnType<typeof challengerCode>;}
const parse=(r:any)=>JSON.parse(String(r.body));
/** Separate read-only source / journal-only writer. Heavy inference belongs in
 * a disposable child; the original forecasts and four model rows are untouched. */
export class HybridJournal {
 readonly journal:ChallengerJournal;
 constructor(readonly plan:ComparisonPlan,readonly clock=nowISO,initialize=true){
  if(plan.version!==ROUTING_VERSION||plan.code.dirty||plan.artifacts.assists!==plan.artifactId)throw new Error('INVALID_COMPARISON_PLAN');
  this.journal=new ChallengerJournal(plan.journalPath,true,clock,()=>plan.code,false,!initialize);
  if(!initialize)return;
  this.journal.db.exec(`CREATE TABLE IF NOT EXISTS input_manifests(id TEXT PRIMARY KEY,body BLOB NOT NULL);
   CREATE TABLE IF NOT EXISTS original_models(id TEXT PRIMARY KEY,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS production_ready(route_id TEXT NOT NULL,event_id TEXT NOT NULL,player_id TEXT NOT NULL,prop TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(route_id,event_id,player_id,prop));
   CREATE TABLE IF NOT EXISTS comparison_markets(id TEXT PRIMARY KEY,at TEXT NOT NULL,prediction_id TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS comparison_selections(model TEXT NOT NULL,family TEXT NOT NULL,observation_id TEXT NOT NULL,PRIMARY KEY(model,family));
   CREATE TABLE IF NOT EXISTS comparison_outcomes(id TEXT PRIMARY KEY,observation_id TEXT NOT NULL,at TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS comparison_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS leases(name TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at TEXT NOT NULL);`);
  for(const table of ['input_manifests','original_models','production_ready','comparison_markets','comparison_selections','comparison_outcomes'])for(const op of ['UPDATE','DELETE'])this.journal.db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${table}_${op} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Comparison evidence is immutable'); END;`);
 }
 registerBatch(source:Store,limit=4){
  if(limit<1||limit>4)throw new Error('BOUNDED_COMPARISON_BATCH_REQUIRED');
  const at=this.clock(),models=researchModels(source),get=preparedFeatures(researchRows(source),'as-of'),results:any[]=[];let attempted=0;
  const fixtures=source.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:fixture:%' AND json_extract(value,'$.status')='scheduled' AND json_extract(value,'$.event.startsAt')>? AND json_extract(value,'$.event.startsAt')<? ORDER BY json_extract(value,'$.event.startsAt')").all(new Date(ms(at)+120000).toISOString(),new Date(ms(at)+48*3600000).toISOString());
  for(const row of fixtures){const fixture=JSON.parse(String(row.value));
   try{fixtureProof(source,fixture.event,fixture.source,at);}catch(e){results.push({eventId:fixture.event.id,held:(e as Error).message});continue;}
   const keys=source.db.prepare("SELECT json_extract(value,'$.playerId') player_id FROM meta WHERE key LIKE 'live:roster:%' AND json_extract(value,'$.teamId') IN (?,?) ORDER BY player_id").all(fixture.event.homeId,fixture.event.awayId).flatMap(r=>props.map(prop=>({player_id:String(r.player_id),prop})));
   for(const key of keys){if(attempted>=limit)return results;
    const prop=key.prop as Prop,playerId=String(key.player_id),artifactId=this.plan.artifacts[prop];
    if(this.journal.db.prepare('SELECT id FROM challenger_predictions WHERE event_id=? AND player_id=? AND prop=? AND artifact_id=?').get(fixture.event.id,playerId,prop,artifactId))continue;
    const attemptKey=`attempt:${fixture.event.id}:${playerId}:${prop}`,stamp=hash([fixture.source,source.get(`live:roster:${playerId.split(':').at(-1)}`),source.db.prepare('SELECT max(observed_at) at FROM logs').get()]),prior=this.journal.db.prepare('SELECT value FROM comparison_meta WHERE key=?').get(attemptKey);
    if(prior&&JSON.parse(String(prior.value)).stamp===stamp)continue;
    attempted++;
    try{
     const artifactRow=this.journal.db.prepare('SELECT body FROM challenger_artifacts WHERE id=?').get(artifactId);if(!artifactRow)throw new Error('FROZEN_ARTIFACT_MISSING');const artifact=parse(artifactRow);
     if(artifact.prop!==prop||hash(artifact.code)!==hash(this.plan.code)||ms(artifact.at)>ms(at))throw new Error('ARTIFACT_CODE_OR_CLOCK_CHANGED');
     for(const ref of artifact.trainingRefs){const row=source.db.prepare('SELECT body FROM logs WHERE id=?').get(ref.id);if(!row||hash(row.body)!==ref.bodyHash)throw new Error('FROZEN_FITTING_EVIDENCE_CHANGED');}
     const player=source.get<{playerId:string;player:string;teamId:string;observedAt:string;source:any}>(`live:roster:${playerId.split(':').at(-1)}`);
     if(!player||player.playerId!==playerId||![fixture.event.homeId,fixture.event.awayId].includes(player.teamId))throw new Error('EXACT_CURRENT_PLAYER_REQUIRED');rosterProof(source,player,at);
     const model=models.find(m=>m.prop===prop);if(!model)throw new Error('ORIGINAL_MODEL_REQUIRED');const original=artifactSchema.parse(model.artifact);
     if(hash(original)!==model.artifactHash||this.plan.originalArtifacts[prop]!==model.artifactHash||ms(original.generatedAt)>ms(at))throw new Error('ORIGINAL_ARTIFACT_INVALID');
     const originalRow=source.db.prepare('SELECT body FROM experimental_forecasts WHERE event_id=? AND player_id=? AND prop=? ORDER BY at,id LIMIT 1').get(fixture.event.id,playerId,prop),first=originalRow?parse(originalRow):null;
     if(first&&(first.artifactHash!==model.artifactHash||hash(first.event)!==hash(fixture.event)||first.inputHash!==hash(first.inputs)))throw new Error('ORIGINAL_FORECAST_REVISION_MISMATCH');
     const f=get({event:fixture.event,...player},prop,at);if(!f)throw new Error('INSUFFICIENT_AVAILABLE_HISTORY');
     const refs=new Map<string,unknown>();for(const r of [...f.history,...f.leagueHistory,...f.opportunities]){const l=r.log,id=hash([l.event.id,l.playerId,l.source.hash]),body=source.db.prepare('SELECT body FROM logs WHERE id=?').get(id);if(!body||ms(l.observedAt)>=ms(at))throw new Error('FEATURE_INPUT_UNAVAILABLE');for(const receipt of [l.source,...(l.supportingSources??[])])retained(source,receipt,at);refs.set(id,{id,bodyHash:hash(body.body),observedAt:l.observedAt,sources:[l.source,...(l.supportingSources??[])]});}
     const manifest=JSON.stringify([...refs.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>value)),manifestId=hash(manifest);
     const simple=predict(f,original.bestSimple)!,selected=predict(f,original.selected)!,useSimple=prop==='assists'||prop==='threes',oldSpec=useSimple?original.bestSimple:original.selected,oldCalibration=useSimple?{method:'raw' as const}:original.calibration,oldChosen=predict(f,oldSpec)!;
     const oldDistribution=calibrateCDF(oldChosen.pmf,oldCalibration),minutes=minutesDistribution(f,artifact.parameters.minutes,'quantile');
     const active=prop==='assists'?mixPMFs([minuteMixture(f,minutes,artifact.parameters.conditionalExcess),predict(f,modelSpec('ewa'))!.pmf],[.25,.75]):oldDistribution;
     summary(active);summary(minutes);
     const stress=[oldChosen.scenarios.low,oldChosen.scenarios.high].map(m=>{
      if(prop!=='assists')return calibrateCDF(predict({...f,minutes:m},oldSpec)!.pmf,oldCalibration);
      // Shift the distribution's location, retaining its variance once. This
      // is sensitivity analysis, never a calibrated lower confidence bound.
      const shifted=new Array<number>(minutes.length).fill(0),delta=Math.round(m-f.minutes);minutes.forEach((p,k)=>{if(k+delta>=0&&k+delta<=75)shifted[k+delta]+=p;});const mass=shifted.reduce((a,b)=>a+b,0);if(!(mass>0))throw new Error('INVALID_MINUTES_SENSITIVITY');for(let k=0;k<shifted.length;k++)shifted[k]/=mass;
      return mixPMFs([minuteMixture({...f,minutes:m},shifted,artifact.parameters.conditionalExcess),predict({...f,minutes:m},modelSpec('ewa'))!.pmf],[.25,.75]);
     });
     const frozenAt=this.clock();if(ms(frozenAt)<ms(at)||ms(frozenAt)-ms(at)>45000||ms(frozenAt)>=ms(fixture.event.startsAt)-120000)throw new Error('COMPARISON_CROSSED_PREGAME_DEADLINE');
     const artifactHeader={id:artifact.id,at:artifact.at,prop,code:artifact.code,parametersHash:hash(artifact.parameters),calibration:prop==='assists'?{method:'raw'}:oldCalibration,originalArtifactHash:model.artifactHash,originalModelVersion:original.modelVersion,routingVersion:ROUTING_VERSION};
     const inputs={fixtureSource:fixture.source,rosterSource:player.source,artifact:artifactHeader,featureNames:f.names,features:f.values,inputRefs:[],manifestId,inputCount:refs.size,cutoff:at,routingVersion:ROUTING_VERSION};
     const id=hash([ROUTING_VERSION,this.plan.routeId,fixture.event.id,playerId,prop]);
     const control:ExperimentalForecast={id:hash([id,'original-control']),at:frozenAt,event:fixture.event,playerId,player:player.player,teamId:player.teamId,prop,policy:SUGGESTION_POLICY,model:oldSpec.candidate,modelVersion:original.modelVersion,routingVersion:ROUTING_VERSION,artifactHash:hash(artifactHeader),distribution:oldDistribution,baseline:simple.pmf,challenger:calibrateCDF(selected.pmf,original.calibration),stress:[oldChosen.scenarios.low,oldChosen.scenarios.high].map(m=>calibrateCDF(predict({...f,minutes:m},oldSpec)!.pmf,oldCalibration)),n:f.history.length,currentSeasonGames:f.history.filter(r=>r.log.event.season===fixture.event.season).length,lastGameAt:f.history.at(-1)!.log.event.startsAt,expectedMinutes:f.minutes,minutesSD:f.minutesSD,teamChanged:f.recentTeamChanged,participationProbability:null,conditionalOnParticipating:true,validated:false,inputs,inputHash:hash(inputs)};
     const forecast:ExperimentalForecast={...control,id,distribution:active,stress,modelVersion:prop==='assists'?'quantile-NB25-EWA75/1.4.7':original.modelVersion,model:prop==='assists'?'quantile-minutes-NB25/EWA75 (experimental 1.4.7)':oldSpec.candidate};
     const body={kind:ROUTING_VERSION,at:frozenAt,event:fixture.event,playerId,teamId:player.teamId,prop,artifact:artifactHeader,inputs,distribution:active,minutesDistribution:minutes,baselines:{production:{id:control.id,at:frozenAt,distribution:oldDistribution,minutes:f.minutes,sameInputHash:control.inputHash,originalArtifactHash:model.artifactHash},originalFrozen:first?{id:first.id,at:first.at,bodyHash:hash(originalRow!.body),differentCutoff:first.at!==frozenAt}:null,simple:simple.pmf,hierarchical:predict(f,modelSpec('hierarchical-nb'))!.pmf},market:null,control,conditionalOnParticipating:true,participationProbability:null,promotionEligible:false,productionEnabled:prop==='assists'};
     const prediction={...body,id,inputHash:hash(body)},ready={routeId:this.plan.routeId,artifactId,originalArtifactHash:model.artifactHash,predictionId:id,forecast,bodyHash:hash(forecast)};
     this.journal.db.exec('BEGIN IMMEDIATE');try{
      fixtureProof(source,fixture.event,fixture.source,this.clock());rosterProof(source,player,this.clock());const current=source.get<any>(`live:fixture:${fixture.event.id.split(':').at(-1)}`),currentPlayer=source.get<any>(`live:roster:${playerId.split(':').at(-1)}`);if(hash(current.event)!==hash(fixture.event)||current.status!=='scheduled'||!currentPlayer||currentPlayer.playerId!==playerId||currentPlayer.teamId!==player.teamId)throw new Error('FIXTURE_OR_ROSTER_CHANGED');
      this.journal.db.prepare('INSERT OR IGNORE INTO input_manifests VALUES (?,?)').run(manifestId,gzipSync(manifest));this.journal.db.prepare('INSERT OR IGNORE INTO original_models VALUES (?,?)').run(model.artifactHash,JSON.stringify(original));
      this.journal.db.prepare('INSERT INTO challenger_predictions VALUES (?,?,?,?,?,?,?)').run(id,frozenAt,fixture.event.id,playerId,prop,artifactId,JSON.stringify(prediction));
      this.journal.db.prepare('INSERT INTO production_ready VALUES (?,?,?,?,?)').run(this.plan.routeId,fixture.event.id,playerId,prop,JSON.stringify(ready));
      if(ms(this.clock())>=ms(fixture.event.startsAt)-120000)throw new Error('PREGAME_DEADLINE');this.journal.db.exec('COMMIT');results.push({inserted:true,id,eventId:fixture.event.id,playerId,prop});
     }catch(e){this.journal.db.exec('ROLLBACK');throw e;}
    }catch(e){const reason=(e as Error).message;results.push({eventId:fixture.event.id,playerId,prop,held:reason});if(!/busy|locked/i.test(reason))this.journal.db.prepare('INSERT INTO comparison_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(attemptKey,JSON.stringify({at:this.clock(),stamp,reason}));}
   }
  }return results;
 }
 captureMarkets(source:Store,limit=1000){
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('BOUNDED_MARKET_CAPTURE_REQUIRED');
  const at=this.clock(),rows=source.db.prepare("SELECT body FROM experimental_candidates WHERE at>? ORDER BY at,id LIMIT ?").all(new Date(ms(at)-180000).toISOString(),limit);let inserted=0;
  for(const row of rows){const c=parse(row),q=c.quote as Quote;
   if(!quoteFresh(q,at,180,120)||q.bookmaker!=='sportsbet'||ms(c.at)>ms(at))continue;
   const readyRow=this.journal.db.prepare('SELECT body FROM production_ready WHERE route_id=? AND event_id=? AND player_id=? AND prop=?').get(this.plan.routeId,q.event.id,q.playerId,q.prop);if(!readyRow)continue;const ready=parse(readyRow),p=parse(this.journal.db.prepare('SELECT body FROM challenger_predictions WHERE id=?').get(ready.predictionId));if(ms(p.at)>ms(c.at))continue;
   const opposite=rows.map(parse).filter(o=>o.quote.event.id===q.event.id&&o.quote.playerId===q.playerId&&o.quote.prop===q.prop&&o.quote.teamId===q.teamId&&o.quote.line===q.line&&o.quote.side!==q.side&&o.quote.bookmaker===q.bookmaker&&o.quote.termsId===q.termsId&&o.quote.source.hash===q.source.hash&&o.quote.quotedAt===q.quotedAt),pairs=new Map(opposite.map(o=>[hash(o.quote),o.quote]));if(pairs.size!==1)continue;const pair=[...pairs.values()][0] as Quote;
   const terms=source.get<{terms:any[]}>('suggestions:terms')?.terms.filter(t=>t.id===q.termsId)??[];if(terms.length!==1)continue;
   try{quoteSchema.parse(q);quoteSchema.parse(pair);const t=termsSchema.parse(terms[0]);if(hash(q.event)!==hash(pair.event)||hash(q.event)!==hash(p.event)||q.teamId!==p.teamId||t.prop!==q.prop||t.bookmaker!=='sportsbet'||t.league!=='NBA'||!quoteFresh(pair,at,180,120))continue;for(const receipt of [q.source,pair.source,q.mappingProof.event.source,q.mappingProof.player.source,pair.mappingProof.event.source,pair.mappingProof.player.source,t.source])retained(source,receipt,at);}catch{continue;}
   for(const [model,f]of [['active',ready.forecast],['original',p.control]] as const){const id=hash([ROUTING_VERSION,c.id,p.id,model]);if(this.journal.db.prepare('SELECT id FROM comparison_markets WHERE id=?').get(id))continue;
    let assessment:any=null,reason:string|null=null;try{for(const receipt of [q.source,pair.source,q.mappingProof.event.source,q.mappingProof.player.source,terms[0].source])retained(source,receipt,at);currentPlayerEvidence(source,f,at);if(notificationWindow(at,q.expiresAt).state!=='ready')throw new Error('DELIVERY_WINDOW_NOT_READY');assessment=assessSuggestion(q,pair,f,terms[0],at);}catch(e){reason=(e as Error).message;}
    const probability=(()=>{let win=0,push=0;f.distribution.forEach((p:number,k:number)=>{if(k===q.line)push+=p;else if(q.side==='over'?k>q.line:k<q.line)win+=p;});return{win,push};})();
    const body={id,at:this.clock(),predictionId:p.id,model,quote:q,opposite:pair,terms:terms[0],probability,fair:(1/q.decimalOdds)/(1/q.decimalOdds+1/pair.decimalOdds),eligible:!!assessment,assessment,reason,hypotheticalStakeAUD:5,notIssued:true};
    this.journal.db.exec('BEGIN IMMEDIATE');try{if(!quoteFresh(q,body.at,180,120))throw new Error('REGISTRATION_CROSSED_QUOTE_DEADLINE');this.journal.db.prepare('INSERT INTO comparison_markets VALUES (?,?,?,?)').run(id,body.at,p.id,JSON.stringify(body));if(assessment)this.journal.db.prepare('INSERT OR IGNORE INTO comparison_selections VALUES (?,?,?)').run(model,hash([q.event.id,q.playerId,q.prop]),id);this.journal.db.exec('COMMIT');inserted++;}catch{this.journal.db.exec('ROLLBACK');}
   }
  }return{inserted,providerRequests:0,outboundMessages:0};
 }
 report(source:Store){
  const at=this.clock();this.journal.grade(source,100);
  for(const row of this.journal.db.prepare('SELECT body FROM comparison_markets').all()){
   const o=parse(row),final=source.db.prepare('SELECT body FROM logs WHERE event_id=? AND player_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 1').get(o.quote.event.id,o.quote.playerId);if(!final)continue;
   try{const l=parse(final) as GameLog;for(const receipt of [l.source,...(l.supportingSources??[])])retained(source,receipt,at);const result=grade({id:o.id,issuedAt:o.at,simulated:false,decision:{quote:o.quote}},l,at),id=hash([o.id,result.id]);this.journal.db.prepare('INSERT OR IGNORE INTO comparison_outcomes VALUES (?,?,?,?)').run(id,o.id,at,JSON.stringify(result));this.journal.db.prepare('DELETE FROM comparison_meta WHERE key=?').run(`outcome-hold:${o.id}`);}catch{this.journal.db.prepare('INSERT INTO comparison_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`outcome-hold:${o.id}`,JSON.stringify({at,reason:'Latest verified final unresolved'}));}
  }
  const settledObservation=(o:any)=>{if(this.journal.db.prepare('SELECT value FROM comparison_meta WHERE key=?').get(`outcome-hold:${o.id}`))return null;const r=this.journal.db.prepare('SELECT body FROM comparison_outcomes WHERE observation_id=? ORDER BY at DESC,rowid DESC LIMIT 1').get(o.id);return r?parse(r):null;};
  const strategies=['active','original'].map(model=>{const selected=this.journal.db.prepare('SELECT m.body FROM comparison_selections s JOIN comparison_markets m ON m.id=s.observation_id WHERE s.model=?').all(model).map(parse),settled=selected.flatMap(o=>{const result=settledObservation(o);return result?[{o,result}]:[];}),profit=settled.reduce((n,r)=>n+r.result.units*5,0),risked=settled.filter(r=>!['void','push'].includes(r.result.result)).length;return{model,selections:selected.length,settled:settled.length,pending:selected.length-settled.length,decisive:risked,hypotheticalProfitAUD:profit,roi:risked?profit/(risked*5):null};});
  const minutes=new Map<Prop,{active:ScoredPrediction[];reference:ScoredPrediction[];absoluteError:number;referenceError:number}>();
  for(const row of this.journal.db.prepare('SELECT body FROM challenger_predictions').all()){
   const p=parse(row),check=this.journal.db.prepare('SELECT state FROM challenger_checks WHERE prediction_id=?').get(p.id);if(check?.state==='held')continue;const raw=this.journal.db.prepare('SELECT body FROM challenger_grades WHERE prediction_id=? ORDER BY at DESC,rowid DESC LIMIT 1').get(p.id);if(!raw)continue;const g=parse(raw);if(!g.minutes)continue;
   const group=minutes.get(p.prop)??{active:[],reference:[],absoluteError:0,referenceError:0},common={...g.common,y:Math.round(g.minutes.actual)},reference=negativeBinomial(p.control.expectedMinutes,Math.max(p.control.expectedMinutes,p.control.minutesSD**2));group.active.push({...common,pmf:p.minutesDistribution});group.reference.push({...common,pmf:reference});group.absoluteError+=g.minutes.challengerAbsoluteError;group.referenceError+=g.minutes.productionAbsoluteError;minutes.set(p.prop,group);
  }
  const markets=this.journal.db.prepare('SELECT body FROM comparison_markets').all().map(parse).map(o=>({...o,outcome:settledObservation(o)}));
  const marketScores=props.map(prop=>{const matched=markets.filter(o=>o.quote.prop===prop&&['won','lost'].includes(o.outcome?.result)&&o.probability.push<1),earliest=new Map<string,any>();for(const o of matched){const key=hash([o.model,o.quote.event.id,o.quote.playerId,o.quote.prop,o.quote.line,o.quote.side]);if(!earliest.has(key))earliest.set(key,o);}return{prop,allObservedQuoteSides:markets.filter(o=>o.quote.prop===prop).length,firstDecisiveExactLineSides:[...earliest.values()].map(o=>({model:o.model,predictionId:o.predictionId,fixture:o.quote.event.id,player:o.quote.playerId,date:o.quote.event.startsAt.slice(0,10),line:o.quote.line,side:o.quote.side,at:o.at,quoteAt:o.quote.quotedAt,price:o.quote.decimalOdds,probability:o.probability.win/(1-o.probability.push),fair:o.fair,outcome:o.outcome.result,brier:(o.probability.win/(1-o.probability.push)-Number(o.outcome.result==='won'))**2,marketBrier:(o.fair-Number(o.outcome.result==='won'))**2}))};});
  return{at,version:ROUTING_VERSION,routeId:this.plan.routeId,artifacts:this.plan.artifacts,comparison:this.journal.comparison(),minutes:[...minutes].map(([prop,g])=>({prop,reference:'Recent-ten NB reference; old production exposes a mean, not a full minutes PMF',n:g.active.length,unroundedMAE:g.absoluteError/g.active.length,originalMeanMAE:g.referenceError/g.active.length,metrics:scoreRows(g.active,[9.5,24.5,47.5]),referenceMetrics:scoreRows(g.reference,[9.5,24.5,47.5]),date:metricIntervals(g.active,g.reference,[9.5,24.5,47.5],'date'),fixture:metricIntervals(g.active,g.reference,[9.5,24.5,47.5],'fixture')})),marketScores,marketSummary:marketScores.map(g=>observedMarketComparison(g.prop,g.firstDecisiveExactLineSides)),strategies,originalIssuedRecommendations:Number(source.db.prepare('SELECT count(*) n FROM experimental_suggestions').get()!.n),coverage:this.coverage(source),limitation:'Same-input original controls are paired; pre-existing original frozen forecasts may have a different cutoff and are not pooled. Original-model selections use matched inputs, not historical issued recommendations. Quote sides and selections are correlated; strategies are different populations, not paired returns. No automatic retraining, promotion, outbox or live position writes.'};
 }
 coverage(source:Store){
  const at=this.clock(),get=preparedFeatures(researchRows(source),'as-of'),fixtures=source.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:fixture:%' AND json_extract(value,'$.status')='scheduled' AND json_extract(value,'$.event.startsAt')>? AND json_extract(value,'$.event.startsAt')<?").all(at,new Date(ms(at)+48*3600000).toISOString()).map(r=>JSON.parse(String(r.value)));
  const rows=fixtures.map(fixture=>{let fixtureHold:string|null=null;try{fixtureProof(source,fixture.event,fixture.source,at);}catch(e){fixtureHold=(e as Error).message;}const players=source.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%' AND json_extract(value,'$.teamId') IN (?,?)").all(fixture.event.homeId,fixture.event.awayId).map(r=>JSON.parse(String(r.value)));let eligible=0,staleRoster=0;
   for(const p of players){try{rosterProof(source,p,at);}catch{staleRoster++;continue;}for(const prop of props)if(get({event:fixture.event,...p},prop,at))eligible++;}
   const n=Number(this.journal.db.prepare('SELECT count(*) n FROM challenger_predictions WHERE event_id=? AND artifact_id IN (?,?,?,?)').get(fixture.event.id,...props.map(p=>this.plan.artifacts[p]))!.n),holds=this.journal.db.prepare("SELECT value FROM comparison_meta WHERE key LIKE ?").all(`attempt:${fixture.event.id}:%`).map(r=>JSON.parse(String(r.value)));return{eventId:fixture.event.id,startsAt:fixture.event.startsAt,rosterPlayers:players.length,historyEligibleOpportunities:eligible,conditionalOnParticipation:true,registered:n,unprocessed:Math.max(0,eligible-n),fixtureHold,staleRoster,holds};});
  return{at,fixturesDiscovered:rows.length,registrationBatchSize:4,minimumBatchCadenceSeconds:15,nominalOpportunitiesPerHour:960,actualThroughputDependsOnChildRuntimeAndProductionDeadlines:true,fixtures:rows};
 }
 close(){this.journal.close();}
}
