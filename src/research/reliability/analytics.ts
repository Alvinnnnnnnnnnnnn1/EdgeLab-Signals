import {Store} from '../../core/store';
import {hash} from '../../core/domain';
import {EfficientStore} from './store';
import {scoreProspectiveFast} from './scoring';
import {scoreExperimentalForecasts} from '../../suggestions/engine';
import type {ExperimentalForecast} from '../../suggestions/forecasts';

export const RELIABILITY_VERSION='research-worker/1.4.5';
const inputs=['logs','prospective_forecasts','shadow_forecasts','experimental_forecasts','experimental_candidates','research_models','source_receipts','receipts']as const;
export function evaluationVersion(store:Store){return hash([RELIABILITY_VERSION,...inputs.map(t=>store.db.prepare(`SELECT count(*) AS n,coalesce(max(rowid),0) AS last FROM ${t}`).get())]);}
export interface AnalyticsResult {version:string;at:string;verified:ReturnType<typeof scoreProspectiveFast>;shadow:ReturnType<typeof scoreProspectiveFast>;experimental:ReturnType<typeof scoreExperimentalForecasts>;mutations:{kind:'meta';key:string;value:unknown}[];grades:{id:string;at:string;classification:string;body:string}[];metrics:EfficientStore['metrics'];}
/** Sort small identities, then parse one immutable forecast at a time. Sorting
 * or materialising all original JSON bodies exceeds the bounded child's heap. */
export function* streamedForecasts(store:Store):Generator<ExperimentalForecast>{for(const row of store.db.prepare('SELECT id FROM experimental_forecasts ORDER BY at,id').iterate()){const value=store.db.prepare('SELECT body FROM experimental_forecasts WHERE id=?').get(row.id!)as{body:string};yield JSON.parse(value.body)as ExperimentalForecast;}}
export function computeAnalytics(path:string,at:string):AnalyticsResult{
 const store=new EfficientStore(path,true);try{
  store.db.exec('BEGIN');const version=evaluationVersion(store),mutations:AnalyticsResult['mutations']=[],grades:AnalyticsResult['grades']=[];const prepare=store.db.prepare.bind(store.db);
  store.set=(key,value)=>{mutations.push({kind:'meta',key,value});};
  // Capture the existing experimental scorer's append operations in memory;
  // this process has a physically read-only live connection.
  store.db.prepare=(sql:string)=>{if(sql==='INSERT OR IGNORE INTO research_grades VALUES (?,?,?,?)')return{run:(id:string,at:string,classification:string,body:string)=>{grades.push({id,at,classification,body});return{changes:1};}}as ReturnType<Store['db']['prepare']>;return prepare(sql);};
  const experimental=scoreExperimentalForecasts(store,at,streamedForecasts(store)),verified=scoreProspectiveFast(store,at),shadow=scoreProspectiveFast(store,at,'conditional-shadow');
  const result={version,at,verified,shadow,experimental,mutations,grades,metrics:store.metrics};store.db.exec('COMMIT');return result;
 }finally{store.close();}
}
export function commitAnalytics(store:Store,result:AnalyticsResult,at:string,assertOwner:()=>void){return store.transaction(()=>{
 assertOwner();if(evaluationVersion(store)!==result.version)return{state:'superseded',reason:'ANALYTICS_INPUTS_CHANGED'};
 for(const mutation of result.mutations){if(!mutation.key.startsWith('experimental:model-health:'))throw new Error('UNEXPECTED_ANALYTICS_MUTATION');store.set(mutation.key,mutation.value);}
 for(const grade of result.grades)store.db.prepare('INSERT OR IGNORE INTO research_grades VALUES (?,?,?,?)').run(grade.id,grade.at,grade.classification,grade.body);
 for(const report of [result.verified,result.shadow]){const{at:ignored,...content}=report;void ignored;store.db.prepare('INSERT OR IGNORE INTO research_grades VALUES (?,?,?,?)').run(hash(content),report.at,report.classification,JSON.stringify(report));}
 const value={at:result.at,verifiedAvailability:result.verified,conditionalShadow:result.shadow,qualifiedEligible:false};store.set('live:scoring',value);store.set('live:monitoring',value);store.set('live:experimental-scoring',{at:result.at,forecasts:result.experimental});
 const ids=[...result.verified.gradedIds,...result.shadow.gradedIds],old=store.get<string[]>('live:graded-ids')??[];store.set('live:graded-ids',[...new Set([...old,...ids])]);
 for(const g of [...result.verified.groups,...result.shadow.groups])store.set(`model-health:${g.id}`,{at:result.at,state:g.metrics&&g.baseline&&g.metrics.playerGames>=200&&g.metrics.crps>g.baseline.crps*1.05?'degraded':'provisional_unpromoted',qualifiedEligible:false});
 store.set('reliable:analytics-cache',{version:result.version,computedAt:result.at,committedAt:at,metrics:result.metrics});store.db.prepare("UPDATE research_jobs SET state='queued',next_at=?,error=NULL WHERE kind IN ('score','monitor') AND error='ANALYTICS_DELEGATED'").run(new Date(Date.parse(at)+6*3600000).toISOString());assertOwner();return{state:'committed'};
 });}
