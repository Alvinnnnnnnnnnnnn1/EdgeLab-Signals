import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {hash,ms,type Prop} from '../core/domain';
import {Store} from '../core/store';
import {experimentalForecasts,type ExperimentalForecast} from '../suggestions/forecasts';

export const ROUTING_VERSION='hybrid-production/1.4.7';
export interface RoutingPlan {version:typeof ROUTING_VERSION;enabled:boolean;journalPath:string;artifactId:string;routeId:string;artifacts:Record<Prop,string>;}
export const routingDecisions:Record<Prop,string>={points:'Original selected ensemble / original calibration',rebounds:'Original selected ensemble / raw calibration',assists:'Experimental 25% repaired quantile minutes/NB + 75% EWA / raw, otherwise original EWA',threes:'Original season-shrunk / raw calibration'};
export function privateJournalPath(path:string){return resolve(path).startsWith(resolve('.local')+'/')&&path.endsWith('/challenger.sqlite');}

/** Only precomputed, immutable records can replace an original forecast. No
 * feature construction, model fitting, network request or journal write here. */
export function productionForecasts(store:Store,at:string,eventIds:string[]):ExperimentalForecast[]{
 const original=experimentalForecasts(store,eventIds),plan=store.get<RoutingPlan>('production:router');
 if(!plan?.enabled||plan.version!==ROUTING_VERSION||!privateJournalPath(plan.journalPath))return original;
 let journal:DatabaseSync|undefined;
 try{
  journal=new DatabaseSync(plan.journalPath,{readOnly:true});journal.exec('PRAGMA busy_timeout=50');
  const artifactRow=journal.prepare('SELECT body FROM challenger_artifacts WHERE id=?').get(plan.artifactId);
  if(!artifactRow)return original;const artifact=JSON.parse(String(artifactRow.body));
  if(artifact.id!==plan.artifactId||artifact.parameters.algorithm!=='hybrid-quantile-ewa'||artifact.parameters.blendWeight!==.25||artifact.parameters.calibration.method!=='raw'||ms(artifact.at)>ms(at))return original;
  return original.map(old=>{
   const selectedId=plan.artifacts?.[old.prop];if(!selectedId)return old;
   const row=journal!.prepare('SELECT body FROM production_ready WHERE route_id=? AND event_id=? AND player_id=? AND prop=?').get(plan.routeId,old.event.id,old.playerId,old.prop);
   if(!row)return old;const record=JSON.parse(String(row.body)),f=record.forecast as ExperimentalForecast;
   const manifest=f.inputs as ExperimentalForecast['inputs']&{manifestId?:string;routingVersion?:string};
   if(record.artifactId!==selectedId||record.originalArtifactHash!==old.artifactHash||record.routeId!==plan.routeId||record.bodyHash!==hash(f)||hash(f.event)!==hash(old.event)||f.teamId!==old.teamId||f.playerId!==old.playerId||f.prop!==old.prop||f.policy!==old.policy||f.inputHash!==hash(f.inputs)||f.artifactHash!==hash(f.inputs.artifact)||manifest.routingVersion!==ROUTING_VERSION||ms(f.at)>ms(at)||ms(f.inputs.cutoff)>ms(f.at)||ms(f.at)>=ms(f.event.startsAt)-120000||!journal!.prepare('SELECT id FROM input_manifests WHERE id=?').get(manifest.manifestId??''))return old;
   const prediction=journal!.prepare('SELECT body FROM challenger_predictions WHERE id=?').get(record.predictionId);
   if(!prediction)return old;const p=JSON.parse(String(prediction.body)),{id,inputHash,...body}=p;
   if(hash(body)!==inputHash||p.artifact.id!==selectedId||hash(p.distribution)!==hash(f.distribution))return old;
   return f;
  });
 }catch{return original;}finally{journal?.close();}
}
