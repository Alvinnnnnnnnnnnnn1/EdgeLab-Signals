import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {hash,ms,type Prop} from '../core/domain';
import {Store} from '../core/store';
import {experimentalForecasts,fixtureProof,rosterProof,type ExperimentalForecast} from '../suggestions/forecasts';
import {summary} from '../research/distributions';
import {gunzipSync} from 'node:zlib';
export const ROUTING_VERSION='hybrid-production/1.4.7';
export interface RoutingPlan {version:typeof ROUTING_VERSION;enabled:boolean;journalPath:string;artifactId:string;routeId:string;artifacts:Record<Prop,string>;}
export const routingDecisions:Record<Prop,string>={points:'Original selected ensemble / original calibration',rebounds:'Original selected ensemble / raw calibration',assists:'Experimental 25% repaired quantile minutes/NB + 75% EWA / raw, otherwise original EWA',threes:'Original season-shrunk / raw calibration'};
export function privateJournalPath(path:string){return resolve(path).startsWith(resolve('.local')+'/')&&path.endsWith('/challenger.sqlite');}
export interface RouteDecision {eventId:string;playerId:string;prop:Prop;forecastId:string;route:'advanced-assists'|'original-precomputed'|'original-fallback';reason:string;}
/** No training, feature construction, network request or journal write here. */
export function productionRouting(store:Store,at:string,eventIds:string[]){
 const original=experimentalForecasts(store,eventIds),plan=store.get<RoutingPlan>('production:router'),decisions:RouteDecision[]=[],checkedManifests=new Set<string>();
 const decision=(f:ExperimentalForecast,route:RouteDecision['route'],reason:string)=>{decisions.push({eventId:f.event.id,playerId:f.playerId,prop:f.prop,forecastId:f.id,route,reason});return f;};
 const fallback=(reason:string)=>original.map(f=>decision(f,'original-fallback',reason));let journal:DatabaseSync|undefined;
 let forecasts:ExperimentalForecast[];
 try{
  if(!plan?.enabled){forecasts=fallback('ROUTER_NOT_ACTIVATED');}
  else if(plan.version!==ROUTING_VERSION||!privateJournalPath(plan.journalPath)){forecasts=fallback('ROUTING_VERSION_OR_PATH_MISMATCH');}
  else{
   journal=new DatabaseSync(plan.journalPath,{readOnly:true});journal.exec('PRAGMA busy_timeout=50');
   const row=journal.prepare('SELECT body FROM challenger_artifacts WHERE id=?').get(plan.artifactId),artifact=row?JSON.parse(String(row.body)):null;
   if(!artifact||artifact.id!==plan.artifactId||artifact.parameters.algorithm!=='hybrid-quantile-ewa'||artifact.parameters.blendWeight!==.25||artifact.parameters.calibration.method!=='raw'||ms(artifact.at)>ms(at)){forecasts=fallback('ADVANCED_ARTIFACT_UNAVAILABLE_OR_MISMATCH');}
   else forecasts=original.map(old=>{
    try{
     const selectedId=plan.artifacts?.[old.prop];if(!selectedId)throw new Error('MARKET_ARTIFACT_UNAVAILABLE');
     const row=journal!.prepare('SELECT body FROM production_ready WHERE route_id=? AND event_id=? AND player_id=? AND prop=?').get(plan.routeId,old.event.id,old.playerId,old.prop);
     if(!row)throw new Error('NO_REGISTERED_PREGAME_RECORD');const record=JSON.parse(String(row.body)),f=record.forecast as ExperimentalForecast;
     const inputs=f.inputs as ExperimentalForecast['inputs']&{manifestId?:string;routingVersion?:string};
     if(record.artifactId!==selectedId||record.originalArtifactHash!==old.artifactHash||record.routeId!==plan.routeId||record.bodyHash!==hash(f)||hash(f.event)!==hash(old.event)||f.teamId!==old.teamId||f.playerId!==old.playerId||f.prop!==old.prop||f.policy!==old.policy||f.inputHash!==hash(f.inputs)||f.artifactHash!==hash(f.inputs.artifact)||inputs.routingVersion!==ROUTING_VERSION)throw new Error('FORECAST_ARTIFACT_OR_IDENTITY_MISMATCH');
     if(ms(f.at)>ms(at)||ms(f.inputs.cutoff)>ms(f.at)||ms(f.at)>=ms(f.event.startsAt)-120000||ms(at)>=ms(f.event.startsAt)-120000)throw new Error('PREGAME_CLOCK_INVALID');
     if(!checkedManifests.has(inputs.manifestId??'')){const manifest=journal!.prepare('SELECT body FROM input_manifests WHERE id=?').get(inputs.manifestId??'');if(!manifest||hash(gunzipSync(manifest.body as Uint8Array).toString())!==inputs.manifestId)throw new Error('INPUT_MANIFEST_MISSING_OR_CORRUPT');checkedManifests.add(inputs.manifestId!);}
     const prediction=journal!.prepare('SELECT body FROM challenger_predictions WHERE id=?').get(record.predictionId);if(!prediction)throw new Error('MATCHED_CONTROL_MISSING');
     const p=JSON.parse(String(prediction.body)),{id,inputHash,...body}=p;
     if(hash(body)!==inputHash||p.artifact.id!==selectedId||hash(p.distribution)!==hash(f.distribution)||p.baselines.production.at!==f.at||p.baselines.production.sameInputHash!==f.inputHash)throw new Error('MATCHED_PREDICTION_HASH_MISMATCH');
     const current=store.get<any>(`live:fixture:${f.event.id.split(':').at(-1)}`),roster=store.get<any>(`live:roster:${f.playerId.split(':').at(-1)}`);
     if(!current||current.status!=='scheduled'||hash(current.event)!==hash(f.event)||!roster||roster.playerId!==f.playerId||roster.teamId!==f.teamId)throw new Error('CURRENT_SOURCE_IDENTITY_CHANGED');
     try{fixtureProof(store,current.event,current.source,at);rosterProof(store,roster,at);}catch{throw new Error('CURRENT_SOURCE_MISSING_OR_STALE');}
     summary(f.distribution);summary(f.baseline);summary(f.challenger);f.stress.forEach(summary);
     return decision(f,f.prop==='assists'?'advanced-assists':'original-precomputed','VALID_MATCHED_PREGAME_RECORD');
    }catch(e){return decision(old,'original-fallback',(e as Error).message);}
   });
  }
 }catch{decisions.length=0;forecasts=fallback('JOURNAL_UNAVAILABLE_OR_BUSY');}finally{journal?.close();}
 return{at,version:ROUTING_VERSION,forecasts,decisions,counts:{advancedAssists:decisions.filter(d=>d.route==='advanced-assists').length,originalPrecomputed:decisions.filter(d=>d.route==='original-precomputed').length,originalFallbacks:decisions.filter(d=>d.route==='original-fallback').length,sourceBlocked:decisions.filter(d=>/SOURCE/.test(d.reason)).length,artifactMismatch:decisions.filter(d=>/ARTIFACT|HASH|VERSION/.test(d.reason)).length}};
}
export function productionForecasts(store:Store,at:string,eventIds:string[]){return productionRouting(store,at,eventIds).forecasts;}
/** Called only by the market writer; counts describe the latest actual lookup,
 * not unique issues or invented successful advanced activations. */
export function marketForecasts(store:Store,at:string,eventIds:string[]){const r=productionRouting(store,at,eventIds);if(store.get<RoutingPlan>('production:router')?.enabled)store.set('production:routing-latest',{at:r.at,version:r.version,counts:r.counts,decisions:r.decisions});return r.forecasts;}
