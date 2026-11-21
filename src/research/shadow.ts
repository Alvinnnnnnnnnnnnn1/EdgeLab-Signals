import { Store } from '../core/store';
import { hash,ms,assertReceipt,eventSchema,type Event,type Receipt,type Prop } from '../core/domain';
import { artifactSchema,type ResearchArtifact } from './inference';
import { RESEARCH_VERSION,predict } from './models';
import { preparedFeatures } from './features';
import { researchRows } from './metadata';
import { calibrateCDF } from './calibration';
import { loadDataset } from './dataset';
import { type Experiment } from './experiment';
import { summary } from './distributions';
import { bdlEvent } from '../providers/balldontlie';

export interface ShadowModel {prop:Prop;artifact:ResearchArtifact;artifactHash:string;reportHash:string;qualifiedEligible:false;}
export interface RosterCandidate {playerId:string;player:string;teamId:string;source:Receipt;observedAt:string;injuryStatus:string|null;}
export function registerResearchModels(store:Store,reports:Experiment[],at:string){
  const verified=new Set<string>();let inserted=0;
  for(const r of reports){if(r.league!=='NBA'||r.state!=='evaluated')continue;const artifact=artifactSchema.parse(r.artifact);
    if(r.genuine!==true||artifact.modelVersion!==RESEARCH_VERSION||hash(artifact)!==r.artifactHash||r.datasetId!==artifact.datasetId||ms(artifact.generatedAt)>ms(at))throw new Error('Current genuine model artifact required');
    if(!verified.has(r.datasetId)){const d=loadDataset(`.local/datasets/${r.datasetId}.json`);if(ms(d.createdAt)>ms(artifact.generatedAt))throw new Error('Model predates its dataset');verified.add(d.id);}
    const record={prop:r.prop,artifact,artifactHash:r.artifactHash,reportHash:hash(r),datasetId:r.datasetId,mode:r.mode,qualifiedEligible:false,classification:'provisional-research',reasons:r.promotion.reasons,registeredAt:at};
    inserted+=Number(store.db.prepare('INSERT OR IGNORE INTO research_models VALUES (?,?,?,?)').run(hash([r.prop,r.artifactHash]),at,r.prop,JSON.stringify(record)).changes);
  }
  return{inserted,qualifiedEligible:false};
}
export function researchModels(store:Store):ShadowModel[]{const latest=new Map<Prop,ShadowModel>();for(const r of store.db.prepare('SELECT body FROM research_models ORDER BY at,id').all() as {body:string}[]){const m=JSON.parse(r.body) as ShadowModel;if(m.artifact.modelVersion===RESEARCH_VERSION)latest.set(m.prop,m);}return[...latest.values()];}

export function freezeConditionalShadow(store:Store,eventInput:Event,fixtureSource:Receipt,players:RosterCandidate[],models:ShadowModel[],at:string,maxCandidates=30,persist=true,clock=()=>at){
  const event=eventSchema.parse(eventInput),exclusions:{playerId:string;reason:string}[]=[],disagreement:{playerId:string;prop:Prop;selectedMean:number;baselineMean:number}[]=[];let inserted=0,existing=0,examined=0,generated=0;
  if(event.league!=='NBA'||ms(event.startsAt)<=ms(at)+120000)throw new Error('Exact future NBA fixture required');
  assertReceipt(fixtureSource,at);if(!store.hasReceipt(fixtureSource)||ms(at)-ms(fixtureSource.retrievedAt)>6*3600000)throw new Error('Fresh original fixture receipt required');
  const fixtureURL=new URL(fixtureSource.endpoint),original=JSON.parse((store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(fixtureSource.hash) as {body:string}).body) as {data?:{id:number;status_state?:string}[]};
  const fixture=original.data?.find(g=>g.id===Number(event.id.split(':').at(-1)));
  if(fixtureSource.provider!=='balldontlie'||fixtureURL.origin!=='https://api.balldontlie.io'||fixtureURL.pathname!=='/nba/v1/games'||!fixture||fixture.status_state!=='scheduled'||hash(bdlEvent(fixture))!==hash(event))throw new Error('Exact scheduled fixture identity missing from original provider bytes');
  const get=preparedFeatures(researchRows(store),'as-of'),checked=new Set<string>();
  for(const p of players.slice().sort((a,b)=>a.playerId.localeCompare(b.playerId)).slice(0,maxCandidates)){
    examined++;
    try{
      if(![event.homeId,event.awayId].includes(p.teamId)||!/^bdl:nba:player:[1-9]\d*$/.test(p.playerId))throw new Error('Exact roster/player/team identity required');
      assertReceipt(p.source,at);if(ms(p.observedAt)>ms(at)||ms(at)-ms(p.observedAt)>24*3600000||!store.hasReceipt(p.source))throw new Error('Roster membership is stale or unretained');
      const raw=JSON.parse((store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(p.source.hash) as {body:string}).body) as {data?:{id:number;team?:{id:number};team_id?:number}[]};
      const native=Number(p.playerId.split(':').at(-1)),team=Number(p.teamId.split(':').at(-1)),proof=raw.data?.find(r=>r.id===native);
      const rosterURL=new URL(p.source.endpoint);if(!proof||(proof.team?.id??proof.team_id)!==team||p.source.provider!=='balldontlie'||rosterURL.origin!=='https://api.balldontlie.io'||rosterURL.pathname!=='/nba/v1/players/active')throw new Error('Roster identity not established by the original active-player response');
      if(p.injuryStatus?.toLowerCase()==='out')throw new Error('Source reports player out');
      for(const model of models){
        try{
        const artifact=artifactSchema.parse(model.artifact);if(hash(artifact)!==model.artifactHash||artifact.modelVersion!==RESEARCH_VERSION||ms(artifact.generatedAt)>ms(at))throw new Error('Frozen current research artifact invalid');
        const id=hash([event.id,p.playerId,model.prop,model.artifactHash]);if(store.db.prepare('SELECT id FROM shadow_forecasts WHERE id=?').get(id)){existing++;continue;}
        const f=get({event,playerId:p.playerId,teamId:p.teamId},model.prop,at);if(!f)throw new Error('Insufficient genuine earlier participating history');
        const selected=predict(f,artifact.selected),baseline=predict(f,artifact.bestSimple);if(!selected||!baseline)throw new Error('Candidate unavailable on this genuine history');generated++;
        disagreement.push({playerId:p.playerId,prop:model.prop,selectedMean:summary(selected.pmf).mean,baselineMean:summary(baseline.pmf).mean});
        const rows=[...f.history,...f.leagueHistory,...f.opportunities];
        for(const r of rows)for(const source of [r.log.source,...(r.log.supportingSources??[])]){assertReceipt(source,at);const key=hash(source);if(!checked.has(key)){if(!store.hasReceipt(source))throw new Error('Historical source missing');checked.add(key);}}
        const context={eventId:event.id,playerId:p.playerId,teamId:p.teamId,status:'unknown',rosterVerified:false,expectedMinutes:f.minutes,minutesSD:f.minutesSD,minutesEvidence:'model-estimated',observedAt:p.observedAt,source:p.source};
        const frozenAt=clock();if(ms(frozenAt)<ms(at)||ms(frozenAt)>=ms(event.startsAt)-120000)throw new Error('Forecast calculation crossed its pregame deadline');
        const inputs={event,fixtureSource,context,identitySource:p.source,artifact,artifactHash:model.artifactHash,inputRefs:[...new Set(rows.map(r=>hash([r.log.event.id,r.log.playerId,r.log.source.hash])))].sort(),featureNames:f.names,features:f.values,featureCutoff:at};
        const record={kind:'pregame-conditional-count/1',classification:'conditional-shadow-unverified-availability',id,at:frozenAt,event,playerId:p.playerId,teamId:p.teamId,prop:model.prop,artifactHash:model.artifactHash,inputs,inputHash:hash(inputs),distribution:calibrateCDF(selected.pmf,artifact.calibration),baselineDistribution:baseline.pmf,
          conditionalOnParticipating:true,participationProbability:null,availabilityVerified:false,rosterMembershipVerified:true,gameRosterOpportunityVerified:false,injuryStatus:p.injuryStatus,researchOnly:true,promotionEligible:false,limitations:[...selected.limitations,'Active team membership does not prove game availability. Minutes are model-estimated. No market evidence.']};
        if(persist)inserted+=Number(store.db.prepare('INSERT OR IGNORE INTO shadow_forecasts VALUES (?,?,?,?,?,?,?)').run(id,frozenAt,event.id,p.playerId,model.prop,model.artifactHash,JSON.stringify(record)).changes);
        }catch(e){exclusions.push({playerId:p.playerId,reason:`${model.prop}: ${e instanceof Error?e.message:'Candidate blocked'}`});}
      }
    }catch(e){exclusions.push({playerId:p.playerId,reason:e instanceof Error?e.message:'Candidate blocked'});}
  }
  return{examined,generated,inserted,existing,exclusions,disagreement,availabilityVerified:false,qualifiedEligible:false,rosterCandidates:players.length,candidateCap:maxCandidates};
}
