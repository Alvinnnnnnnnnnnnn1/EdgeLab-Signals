import {Store} from '../core/store';
import {loadConfig} from '../core/config';
import {comparisonHealth} from './health';
import {type RoutingPlan} from './router';
export function modelOperationStatus(){
 const store=new Store(process.env.EDGELAB_DB??loadConfig().database,true);try{
  const plan=store.get<RoutingPlan>('production:router'),comparison=store.get<{path:string}>('production:comparison-plan');let worker:ReturnType<typeof comparisonHealth>|{state:string};try{worker=comparison?comparisonHealth(comparison.path):{state:'not-installed'};}catch{worker={state:'unavailable'};}
  return{routing:plan?.enabled?'Experimental routing enabled; use counts below to confirm selection':'Original production routing',worker,routingLatest:store.get<{at:string;counts:{advancedAssists:number;originalFallbacks:number;sourceBlocked:number;artifactMismatch:number}}>('production:routing-latest')};
 }finally{store.close();}
}
