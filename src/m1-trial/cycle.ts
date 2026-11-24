import { hash, ms, props, type Prop } from '../core/domain';
import type { Store } from '../core/store';
import { preparedFeatures } from '../research/features';
import { artifactSchema } from '../research/inference';
import { predict, modelSpec } from '../research/models';
import { calibrateCDF } from '../research/calibration';
import { summary,mixPMFs } from '../research/distributions';
import { minutesDistribution,minuteMixture } from '../research-advanced/models';
import { retainedRows,knownAt } from '../model-engineering/data';
import { predictM1,type M1Artifact } from '../model-engineering/m1';
import { assessFreshness } from '../model-engineering/freshness';
import { EngineeringJournal } from '../model-engineering/journal';
import { fixtureProof,rosterProof,upcomingFixtures,SUGGESTION_POLICY,type ExperimentalForecast } from '../suggestions/forecasts';
import { trialContext } from './context';
import { ready } from './journal';
import { TRIAL_VERSION,type TrialProtocol } from './contracts';

export function trialIdle(s:Store,at:string){
  if(s.db.prepare("SELECT name FROM leases WHERE name IN ('live-cycle','reliable-source-task','experimental-cycle','experimental-delivery','multi-slate-research') AND expires_at>? LIMIT 1").get(at))return false;
  if(s.db.prepare("SELECT id FROM quota WHERE provider='odds' AND outcome='reserved' LIMIT 1").get()||s.get('recurring:uncertain-debit')||s.db.prepare("SELECT id FROM experimental_outbox WHERE state IN ('sending','uncertain') LIMIT 1").get())return false;
  return true;
}
/** The statistical implementation stays frozen. Two clocks are explicit:
 * receipts/final availability are filtered at actual generation; target tip is
 * used only to calculate scheduled rest and exclude target-day outcomes. */
export function generationFeatures(rows:ReturnType<typeof retainedRows>,at:string){
  const known=rows.filter(r=>knownAt(r.log)<ms(at)&&ms(r.log.event.startsAt)<ms(at)&&(!r.log.completedAt||ms(r.log.completedAt)<ms(at))&&r.log.final);
  const get=preparedFeatures(known,'as-of');
  // The underlying legacy index excludes its cutoff's whole UTC day. Its
  // availability filter is already applied above, so advance only that index
  // boundary, not the real generation/receipt clock or scheduled rest feature.
  return ((target,prop)=>get(target,prop,new Date(ms(target.event.startsAt)+86400000).toISOString())) as ReturnType<typeof preparedFeatures>;
}
export class TrialForecaster {
  private epoch=''; private rows:ReturnType<typeof retainedRows>=[]; private get:ReturnType<typeof preparedFeatures>|null=null;
  private attempted=new Map<string,string>();
  constructor(private protocol:TrialProtocol,private model:M1Artifact,private hybrid:any,private journal:EngineeringJournal,private clock=()=>new Date().toISOString()){}
  cycle(s:Store,budgetMs=2000,maxRecords=4){
    const began=performance.now(),at=this.clock();if(!trialIdle(s,at))return{state:'YIELDED_TO_SOURCE_OR_MARKETS',inserted:0,networkRequests:0};
    if(budgetMs<100||budgetMs>10000||maxRecords<1||maxRecords>8)throw Error('BOUNDED_TRIAL_BATCH_REQUIRED');
    let inserted=0,examined=0;const holds:any[]=[];
    s.db.exec('BEGIN DEFERRED');try{
      const epoch=hash(s.db.prepare('SELECT rowid,id FROM logs ORDER BY rowid DESC LIMIT 1').get());
      if(!this.get||epoch!==this.epoch){this.rows=retainedRows(s,at);this.get=generationFeatures(this.rows,at);this.epoch=epoch;this.attempted.clear();}
      const rowRefs=new Map(this.rows.map(r=>[r.log,r.ref]));
      const models=s.db.prepare('SELECT body FROM research_models ORDER BY at,id').all().map(r=>JSON.parse(String(r.body))),inferenceStart=performance.now(),contexts=new Map<string,ReturnType<typeof trialContext>>();
      for(const fixture of upcomingFixtures(s,at)){
        try{fixtureProof(s,fixture.event,fixture.source,this.clock());}catch(e){holds.push({eventId:fixture.event.id,reason:(e as Error).message});continue;}
        const players=s.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%' AND json_extract(value,'$.teamId') IN (?,?) ORDER BY key").all(fixture.event.homeId,fixture.event.awayId).map(r=>JSON.parse(String(r.value)));
        for(const player of players)for(const prop of props){
          const now=this.clock(),key=hash([fixture.event,player.playerId,prop]);
          if(performance.now()-inferenceStart>=budgetMs||examined>=maxRecords)return{state:'YIELDED',inserted,examined,holds,preparationMs:inferenceStart-began,networkRequests:0};
          try{
            const contextKey=hash([fixture.event,player.playerId]);let context=contexts.get(contextKey);if(!context){rosterProof(s,player,now);context=trialContext(s,fixture.event,player.playerId,player.teamId,now);contexts.set(contextKey,context);}const stamp=context.hash;
            if(this.attempted.get(key)===stamp)continue;this.attempted.set(key,stamp);examined++;
            const f=this.get!({event:fixture.event,...player},prop,fixture.event.startsAt);if(!f)throw Error('INSUFFICIENT_KNOWN_COMPLETED_HISTORY');f.cutoff=now;
            // Verify target outcome and all later receipt revisions remain outside.
            const refs=[...new Map([...f.history,...f.leagueHistory,...f.opportunities].map(r=>{const ref=rowRefs.get(r.log);if(!ref||r.log.event.id===fixture.event.id||knownAt(r.log)>=ms(now))throw Error('FUTURE_OR_TARGET_FEATURE');return[ref.id,{...ref,knownAt:new Date(knownAt(r.log)).toISOString()}];})).values()].sort((a,b)=>a.id.localeCompare(b.id));
            const featureHash=hash({protocol:this.protocol.id,features:f.values,refs,context:context.hash});
            if(this.journal.db.prepare('SELECT id FROM engineering_predictions WHERE id=?').get(hash([this.model.id,fixture.event.id,player.playerId,prop,featureHash])))continue;
            const original=models.find(m=>m.prop===prop&&m.artifactHash===this.protocol.originalArtifacts[prop]);if(!original)throw Error('FROZEN_ORIGINAL_MODEL_REQUIRED');
            const a=artifactSchema.parse(original.artifact);if(hash(a)!==original.artifactHash||ms(a.generatedAt)>ms(now))throw Error('ORIGINAL_MODEL_CHANGED_OR_FUTURE');
            const simple=predict(f,a.bestSimple)!,selected=predict(f,a.selected)!,old=calibrateCDF((prop==='assists'||prop==='threes'?simple:selected).pmf,prop==='assists'||prop==='threes'?{method:'raw'}:a.calibration);
            const originalActive=prop==='assists'?mixPMFs([minuteMixture(f,minutesDistribution(f,this.hybrid.parameters.minutes,'quantile'),this.hybrid.parameters.conditionalExcess),predict(f,modelSpec('ewa'))!.pmf],[.25,.75]):old;
            const m1=predictM1(f,this.model)!;const controls=Object.fromEntries(['last5','last10','ewa','season-shrunk','hierarchical-nb'].map(c=>[c,predict(f,modelSpec(c as Parameters<typeof modelSpec>[0]))!.pmf]));
            const priorRow=this.journal.db.prepare('SELECT body FROM engineering_predictions WHERE model_id=? AND event_id=? AND player_id=? AND prop=? ORDER BY registered_at DESC,id DESC LIMIT 1').get(this.model.id,fixture.event.id,player.playerId,prop),prior=priorRow?JSON.parse(String(priorRow.body)):null;
            const oldRow=s.db.prepare('SELECT body FROM experimental_forecasts WHERE event_id=? AND player_id=? AND prop=? ORDER BY at,id LIMIT 1').get(fixture.event.id,player.playerId,prop),frozen=oldRow?JSON.parse(String(oldRow.body)):null;
            const registered=this.journal.register({asOf:now,state:context.state,artifact:this.model,featureHash,featureRefs:refs,featureAvailability:'COMPLETED_FINAL_RECEIPT_AS_OF_GENERATION',prop,distribution:m1.pmf,minutesDistribution:m1.minutesPMF,originalControl:{modelHash:prop==='assists'?this.protocol.hybridArtifactHash:original.artifactHash,distribution:originalActive},frozenProduction:frozen?{id:frozen.id,at:frozen.at,bodyHash:hash(frozen),distribution:frozen.distribution}:null,controls,freshness:assessFreshness(prior?.state??context.state,context.state,prior?.registeredAt??now,now),previousRevisionId:prior?.id??null,market:null},s);
            inserted+=Number(registered.inserted);if(prop==='threes')continue;
            const prediction=registered.record,artifact={modelId:this.model.id,statisticalSourceHash:this.model.sourceHash,protocolId:this.protocol.id,calibration:'raw',trainingCutoff:this.model.trainingCutoff,trainedAt:this.model.trainedAt,routing:TRIAL_VERSION};
            const inputs={fixtureSource:fixture.source,rosterSource:player.source,artifact,featureNames:f.names,features:f.values,inputRefs:[],manifestId:prediction.featureRefs.manifestId,cutoff:now,trialId:this.protocol.id,contextHash:context.hash,featureHash,sourceClocks:{historyReceivedThrough:new Date(Math.max(...f.history.map(r=>knownAt(r.log)))).toISOString(),injurySnapshot:context.injurySnapshot?.at??null,ownAvailability:context.state.injury?.observedAt??null,teammates:context.state.teammates.map(t=>({playerId:t.playerId,status:t.status.value,observedAt:t.status.observedAt})),starter:null},limitations:['Starter and positive participation unknown','No fitted quantitative teammate absence response']};
            const minutesSD=Math.sqrt(m1.minutesPMF.reduce((sum,w,m)=>sum+w*(m-m1.minutesMean)**2,0));
            const forecast:ExperimentalForecast={id:hash([this.protocol.id,prediction.id,'production']),at:prediction.registeredAt,event:fixture.event,playerId:player.playerId,player:player.player,teamId:player.teamId,prop,policy:SUGGESTION_POLICY,model:'M1 partially pooled minutes x production (owner experimental trial)',modelVersion:this.model.algorithm,routingVersion:TRIAL_VERSION,artifactHash:hash(artifact),distribution:m1.pmf,baseline:simple.pmf,challenger:calibrateCDF(selected.pmf,a.calibration),stress:[Math.max(1,m1.minutesMean-minutesSD),Math.min(75,m1.minutesMean+minutesSD)].map(minuteCenter=>predictM1(f,this.model,{minuteCenter})!.pmf),n:f.history.length,currentSeasonGames:f.history.filter(r=>r.log.event.season===fixture.event.season).length,lastGameAt:f.history.at(-1)!.log.event.startsAt,expectedMinutes:m1.minutesMean,minutesSD,teamChanged:f.recentTeamChanged,participationProbability:null,conditionalOnParticipating:true,validated:false,inputs,inputHash:hash(inputs)};
            ready(this.journal,this.protocol,prediction,forecast);
          }catch(e){const reason=(e as Error).message;holds.push({eventId:fixture.event.id,playerId:player.playerId,prop,reason});this.journal.hold({eventId:fixture.event.id,playerId:player.playerId,prop},reason);}
        }
      }
      return{state:'COMPLETE',inserted,examined,holds,networkRequests:0};
    }finally{s.db.exec('ROLLBACK');}
  }
}
