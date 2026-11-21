import { Store } from '../core/store';
import { hash,ms,props,assertReceipt,contextSchema,eventSchema,type Context,type Event,type Receipt } from '../core/domain';
import { artifactSchema,type ResearchArtifact } from './inference';
import { features } from './features';
import { predict,RESEARCH_VERSION } from './models';
import { calibrateCDF } from './calibration';
import { unknownMetadata,validateRows } from './dataset';
import { thresholds } from './experiment';
import { scoreRows,pairedDifference,type ScoredPrediction } from './scoring';
import { z } from 'zod';
import { researchRows } from './metadata';

export interface ProspectiveEvent {event:Event;source:Receipt;}
/** Freeze conditional count forecasts independently of prices, issuance and
 * promotion. These records cannot substitute for the Sportsbet monitoring gate. */
export function recordProspective(store:Store,artifacts:{prop:typeof props[number];artifact:ResearchArtifact;artifactHash:string}[],events:ProspectiveEvent[],contexts:Context[],at:string,clock=()=>at){
  const rows=validateRows(researchRows(store),at).filter(r=>r.log.event.league==='NBA'&&['regular','playoffs'].includes(r.metadata.phase));
  let inserted=0,existing=0;const exclusions:{eventId:string|null;playerId:string|null;reason:string}[]=[];
  if(!events.length)exclusions.push({eventId:null,playerId:null,reason:'No exact source-backed upcoming NBA fixture'});
  if(!contexts.length)exclusions.push({eventId:null,playerId:null,reason:'No genuine positive availability/verified roster evidence'});
  const verified=new Set<string>();
  function retained(source:Receipt){assertReceipt(source,at);const key=hash(source);if(!verified.has(key)){if(!store.hasReceipt(source))throw new Error('Exact source receipt missing');verified.add(key);}}
  for(const model of artifacts){
    const artifact=artifactSchema.parse(model.artifact);
    if(hash(artifact)!==model.artifactHash||ms(artifact.generatedAt)>ms(at)||artifact.modelVersion!==RESEARCH_VERSION)throw new Error('Prospective artifact hash/creation clock/version invalid');
    for(const input of events){
      const event=eventSchema.parse(input.event);if(event.league!=='NBA'||ms(event.startsAt)<=ms(at)+120000)continue;
      for(const raw of contexts.filter(c=>c.eventId===event.id)){
        try{
          const context=contextSchema.parse(raw);
          if(context.status!=='available'||!context.rosterVerified||context.expectedMinutes===null||context.expectedMinutes<=0||context.minutesSD===null)throw new Error('Positive availability, roster and minutes evidence required');
          if(![event.homeId,event.awayId].includes(context.teamId)||!/^bdl:nba:player:[1-9]\d*$/.test(context.playerId))throw new Error('Exact NBA player/team identity required');
          if(ms(context.observedAt)>ms(at)||ms(at)-ms(context.observedAt)>1800000||ms(context.source.retrievedAt)>ms(context.observedAt))throw new Error('Availability evidence is future or stale');
          retained(input.source);retained(context.source);
          const f=features(rows,{event,playerId:context.playerId,teamId:context.teamId},model.prop,'as-of',at);
          if(!f||f.history.length<10)throw new Error('Insufficient genuine pregame player history');
          if(hash(f.names)!==hash(artifact.featureNames))throw new Error('Frozen feature contract changed');
          const featureLogs=[...f.history,...f.leagueHistory,...f.opportunities];
          for(const r of featureLogs)for(const source of [r.log.source,...(r.log.supportingSources??[])])retained(source);
          const selected=predict(f,artifact.selected),baseline=predict(f,artifact.bestSimple);
          if(!selected||!baseline)throw new Error('Frozen model unavailable for these inputs');
          const inputRefs=[...new Set(featureLogs.map(r=>hash([r.log.event.id,r.log.playerId,r.log.source.hash])))].sort();
          const inputs={event,fixtureSource:input.source,context,artifact,artifactHash:model.artifactHash,inputRefs,featureNames:f.names,features:f.values};
          const frozenAt=clock();if(ms(frozenAt)<ms(at)||ms(frozenAt)>=ms(event.startsAt)-120000)throw new Error('Forecast calculation crossed its pregame deadline');
          const record={kind:'pregame-conditional-count/1',at:frozenAt,event,playerId:context.playerId,teamId:context.teamId,prop:model.prop,artifactHash:model.artifactHash,
            inputs,inputHash:hash(inputs),distribution:calibrateCDF(selected.pmf,artifact.calibration),baselineDistribution:baseline.pmf,
            participationProbability:f.participation,conditionalOnParticipating:true,researchOnly:true,promotionEligible:false,originalSourceClocksPreserved:true};
          const id=hash([event.id,context.playerId,model.prop,model.artifactHash]);
          const result=store.db.prepare('INSERT OR IGNORE INTO prospective_forecasts VALUES (?,?,?,?,?,?,?)').run(id,frozenAt,event.id,context.playerId,model.prop,model.artifactHash,JSON.stringify({...record,id}));
          if(result.changes)inserted++;else existing++;
        }catch(e){exclusions.push({eventId:event.id,playerId:raw.playerId,reason:e instanceof Error?e.message:'Invalid prospective input'});}
      }
    }
  }
  return{at,state:inserted||existing?'recorded':'blocked',inserted,existing,exclusions,networkRequests:0,outboundMessages:0};
}

export function scoreProspective(store:Store,at:string,classification:'verified-availability'|'conditional-shadow'='verified-availability'){
  const records=store.db.prepare(classification==='conditional-shadow'?'SELECT body FROM shadow_forecasts ORDER BY at,id':'SELECT body FROM prospective_forecasts ORDER BY at,id').all() as {body:string}[];
  const logs=store.logs(),indexed=new Map(logs.map(log=>[hash([log.event.id,log.playerId,log.source.hash]),log]));
  const groups=new Map<string,{prop:typeof props[number];selected:ScoredPrediction[];baseline:ScoredPrediction[]}>();
  const exclusions:{id:string;reason:string}[]=[];
  const pmf=z.array(z.number().min(0).max(1)).min(2).refine(v=>Math.abs(v.reduce((n,p)=>n+p,0)-1)<1e-8);
  for(const row of records){
    const r=JSON.parse(row.body);
    try{
      if(r.kind!=='pregame-conditional-count/1'||r.researchOnly!==true||r.promotionEligible!==false||hash(r.inputs)!==r.inputHash||ms(r.at)>ms(at)||ms(r.at)>=ms(r.event.startsAt)-120000)throw new Error('Invalid frozen pregame record');
      const prop=z.enum(['points','rebounds','assists','threes']).parse(r.prop),event=eventSchema.parse(r.event),artifact=artifactSchema.parse(r.inputs.artifact);
      if(event.league!=='NBA'||hash(artifact)!==r.artifactHash||ms(artifact.generatedAt)>ms(r.at))throw new Error('Frozen artifact identity or clock invalid');
      for(const source of [r.inputs.fixtureSource,r.inputs.context.source]){assertReceipt(source,r.at);if(!store.hasReceipt(source))throw new Error('Frozen source missing');}
      for(const id of r.inputs.inputRefs){
        const input=indexed.get(id);if(!input||ms(input.observedAt)>ms(r.at)||input.event.startsAt.slice(0,10)>=r.at.slice(0,10))throw new Error('Frozen input missing or unavailable before forecast');
        for(const source of [input.source,...(input.supportingSources??[])]){assertReceipt(source,r.at);if(!store.hasReceipt(source))throw new Error('Frozen history receipt missing');}
      }
      const final=logs.filter(l=>!l.source.simulated&&l.final&&l.event.id===event.id&&l.playerId===r.playerId&&l.teamId===r.teamId&&hash(l.event)===hash(event)&&ms(l.observedAt)<=ms(at)&&ms(l.observedAt)>ms(event.startsAt)).sort((a,b)=>ms(b.observedAt)-ms(a.observedAt))[0];
      if(!final||final.participated!==true||final.stats[prop]===null){exclusions.push({id:r.id,reason:'No genuine observed participating final with this stat; unresolved DNP stays excluded'});continue;}
      for(const source of [final.source,...(final.supportingSources??[])]){assertReceipt(source,at);if(!store.hasReceipt(source))throw new Error('Final source missing');}
      const common={id:r.id,date:new Date(ms(event.startsAt)).toISOString().slice(0,10),fixture:event.id,season:event.season,player:r.playerId,team:r.teamId,lowMinute:r.inputs.features[4]<15,y:final.stats[prop]};
      const key=`${r.artifactHash}:${prop}`,group=groups.get(key)??{prop,selected:[],baseline:[]};
      group.selected.push({...common,pmf:pmf.parse(r.distribution)});group.baseline.push({...common,pmf:pmf.parse(r.baselineDistribution)});groups.set(key,group);
    }catch(e){exclusions.push({id:r.id,reason:e instanceof Error?e.message:'Invalid frozen record'});}
  }
  return{at,classification,frozenRecords:records.length,gradedIds:[...groups.values()].flatMap(g=>g.selected.map(r=>r.id)),unresolved:records.length-[...groups.values()].reduce((n,g)=>n+g.selected.length,0),groups:[...groups].map(([id,g])=>({id,prop:g.prop,metrics:scoreRows(g.selected,thresholds.NBA[g.prop]),baseline:scoreRows(g.baseline,thresholds.NBA[g.prop]),paired:pairedDifference(g.selected,g.baseline,thresholds.NBA[g.prop])})),exclusions,
    scope:'Conditional count accuracy only; these records cannot replace quote/terms/participation monitoring or promote a live alert.',promotionEligible:false};
}
