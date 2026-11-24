import {Store} from '../core/store';
import {assertReceipt,eventSchema,hash,ms,props,type Event,type Receipt,type Prop} from '../core/domain';
import {bdlEvent} from '../providers/balldontlie';
import {researchModels} from '../research/shadow';
import {preparedFeatures} from '../research/features';
import {researchRows} from '../research/metadata';
import {predict,RESEARCH_VERSION} from '../research/models';
import {artifactSchema} from '../research/inference';
import {calibrateCDF} from '../research/calibration';

export const SUGGESTION_POLICY='nba-experimental/1.4.2';
export interface ExperimentalForecast {
  id:string;at:string;event:Event;playerId:string;player:string;teamId:string;prop:Prop;policy:string;model:string;artifactHash:string;modelVersion?:string;routingVersion?:string;
  distribution:number[];baseline:number[];challenger:number[];stress:number[][];n:number;currentSeasonGames:number;lastGameAt:string;expectedMinutes:number;minutesSD:number;teamChanged:boolean;
  participationProbability:null;conditionalOnParticipating:true;validated:false;
  inputs:{fixtureSource:Receipt;rosterSource:Receipt;artifact:unknown;featureNames:string[];features:number[];inputRefs:string[];cutoff:string};inputHash:string;
}
export function retained(store:Store,source:Receipt,at:string){assertReceipt(source,at);if(!store.hasReceipt(source))throw new Error('Exact original source receipt missing');}
export function fixtureProof(store:Store,raw:Event,source:Receipt,at:string){
  const event=eventSchema.parse(raw);retained(store,source,at);
  const u=new URL(source.endpoint),body=JSON.parse((store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(source.hash) as {body:string}).body);
  const game=body.data?.find((g:{id:number})=>`bdl:nba:game:${g.id}`===event.id);
  if(event.league!=='NBA'||ms(event.startsAt)<=ms(at)+120000||ms(at)-ms(source.retrievedAt)>6*3600000||source.provider!=='balldontlie'||u.origin!=='https://api.balldontlie.io'||u.pathname!=='/nba/v1/games'||!game||game.status_state!=='scheduled'||game.postponed===true||hash(bdlEvent(game))!==hash(event))throw new Error('Fresh exact scheduled NBA fixture required');
}
export function rosterProof(store:Store,p:{playerId:string;teamId:string;observedAt:string;source:Receipt},at:string){
  retained(store,p.source,at);const u=new URL(p.source.endpoint),body=JSON.parse((store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(p.source.hash) as {body:string}).body);
  const original=body.data?.find((r:{id:number})=>`bdl:nba:player:${r.id}`===p.playerId);
  if(ms(p.observedAt)>ms(at)||ms(at)-ms(p.observedAt)>24*3600000||p.source.provider!=='balldontlie'||u.origin!=='https://api.balldontlie.io'||u.pathname!=='/nba/v1/players/active'||!original||`bdl:nba:team:${original.team?.id??original.team_id}`!==p.teamId)throw new Error('Fresh exact active roster proof required');
}
export function upcomingFixtures(store:Store,at:string){return(store.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:fixture:%'").all() as {value:string}[]).map(r=>JSON.parse(r.value) as {event:Event;source:Receipt;status:string}).filter(f=>f.status==='scheduled'&&ms(f.event.startsAt)>ms(at)+120000&&ms(f.event.startsAt)<=ms(at)+48*3600000).sort((a,b)=>ms(a.event.startsAt)-ms(b.event.startsAt));}
export function generateExperimentalForecasts(store:Store,eventId:string,at:string,clock=()=>at,options:{persist?:boolean}={}){
  const fixture=upcomingFixtures(store,at).find(f=>f.event.id===eventId);if(!fixture)throw new Error('Upcoming exact fixture missing');fixtureProof(store,fixture.event,fixture.source,at);
  const models=researchModels(store);if(models.length!==props.length)throw new Error('Four frozen provisional models required');
  const players=(store.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%'").all() as {value:string}[]).map(r=>JSON.parse(r.value) as {playerId:string;player:string;teamId:string;observedAt:string;source:Receipt}).filter(p=>[fixture.event.homeId,fixture.event.awayId].includes(p.teamId));
  const get=preparedFeatures(researchRows(store),'as-of'),checked=new Set<string>(),exclusions:{playerId:string;prop?:Prop;reason:string}[]=[];let inserted=0,existing=0;const preview:ExperimentalForecast[]=[];
  for(const player of players){try{rosterProof(store,player,at);}catch(e){exclusions.push({playerId:player.playerId,reason:(e as Error).message});continue;}
    for(const m of models){try{
      const artifact=artifactSchema.parse(m.artifact),id=hash([SUGGESTION_POLICY,hash(fixture.event),player.playerId,m.prop,m.artifactHash]);
      const previous=store.db.prepare('SELECT body FROM experimental_forecasts WHERE event_id=? AND player_id=? AND prop=?').all(eventId,player.playerId,m.prop) as {body:string}[];
      const matched=previous.map(row=>JSON.parse(row.body)as ExperimentalForecast).find(f=>f.policy===SUGGESTION_POLICY&&f.artifactHash===m.artifactHash&&hash(f.event)===hash(fixture.event));if(matched){existing++;if(options.persist===false)preview.push(matched);continue;}
      if(artifact.modelVersion!==RESEARCH_VERSION||hash(artifact)!==m.artifactHash||ms(artifact.generatedAt)>ms(at))throw new Error('Frozen current model invalid');
      const f=get({event:fixture.event,...player},m.prop,at);if(!f)throw new Error('Fewer than ten complete earlier participating games');
      // Explicit experimental deployment policy, not model promotion: the simple
      // controls beat/did not lose convincingly to challengers in AST/3PM research.
      const useSimple=m.prop==='assists'||m.prop==='threes',spec=useSimple?artifact.bestSimple:artifact.selected;
      const calibration=useSimple?{method:'raw' as const}:artifact.calibration;
      const chosen=predict(f,spec),baseline=predict(f,artifact.bestSimple),challenger=predict(f,artifact.selected);if(!chosen||!baseline||!challenger)throw new Error('Current model unavailable');
      const stress=[chosen.scenarios.low,chosen.scenarios.high].map(minutes=>{const result=predict({...f,minutes},spec);if(!result)throw new Error('Minutes sensitivity unavailable');return calibrateCDF(result.pmf,calibration);});
      const rows=[...f.history,...f.leagueHistory,...f.opportunities];for(const row of rows)for(const source of [row.log.source,...(row.log.supportingSources??[])]){const key=hash(source);if(!checked.has(key)){retained(store,source,at);checked.add(key);}}
      const frozenAt=clock();if(ms(frozenAt)<ms(at)||ms(frozenAt)>=ms(fixture.event.startsAt)-120000)throw new Error('Forecast crossed actual pregame deadline');
      const inputs={fixtureSource:fixture.source,rosterSource:player.source,artifact,featureNames:f.names,features:f.values,inputRefs:[...new Set(rows.map(r=>hash([r.log.event.id,r.log.playerId,r.log.source.hash])))].sort(),cutoff:at};
      const record:ExperimentalForecast={id,at:frozenAt,event:fixture.event,playerId:player.playerId,player:player.player,teamId:player.teamId,prop:m.prop,policy:SUGGESTION_POLICY,model:spec.candidate,artifactHash:m.artifactHash,
        distribution:calibrateCDF(chosen.pmf,calibration),baseline:baseline.pmf,challenger:calibrateCDF(challenger.pmf,artifact.calibration),stress,n:f.history.length,currentSeasonGames:f.history.filter(r=>r.log.event.season===fixture.event.season).length,lastGameAt:f.history.at(-1)!.log.event.startsAt,expectedMinutes:f.minutes,minutesSD:f.minutesSD,teamChanged:f.recentTeamChanged,
        participationProbability:null,conditionalOnParticipating:true,validated:false,inputs,inputHash:hash(inputs)};
      if(options.persist===false)preview.push(record);else inserted+=Number(store.db.prepare('INSERT OR IGNORE INTO experimental_forecasts VALUES (?,?,?,?,?,?)').run(id,frozenAt,eventId,player.playerId,m.prop,JSON.stringify(record)).changes);
    }catch(e){exclusions.push({playerId:player.playerId,prop:m.prop,reason:(e as Error).message});}}
  }
  return{eventId,playersExamined:players.length,inserted,existing,exclusions,...(options.persist===false?{forecasts:preview}: {})};
}
export function experimentalForecasts(store:Store,eventIds?:string[]){
 if(eventIds&&!eventIds.length)return[];
 const sql=eventIds?`SELECT body FROM experimental_forecasts WHERE event_id IN (${eventIds.map(()=>'?').join(',')}) ORDER BY at,id`:'SELECT body FROM experimental_forecasts ORDER BY at,id';
 return(store.db.prepare(sql).all(...(eventIds??[])) as {body:string}[]).map(r=>JSON.parse(r.body) as ExperimentalForecast);
}
