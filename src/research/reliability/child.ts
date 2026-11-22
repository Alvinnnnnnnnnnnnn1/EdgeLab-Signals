import{setPriority}from'node:os';
import{loadConfig}from'../../core/config';import{ms,nowISO}from'../../core/domain';
import{liveOnce}from'../live';import{JsonHTTP}from'../../providers/http';
import{settleSuggestions}from'../../suggestions/engine';
import{FencedStore}from'./store';import{computeAnalytics}from'./analytics';
import{ensureFinalJob,finalSchedule,finalStep,gradingVersion}from'./finals';
import{safeReason,type TaskRequest}from'./supervisor';

export function reconcileGrades(store:FencedStore,at:string){const version=gradingVersion(store),previous=store.get<{version:string}>('reliable:grading');if(previous?.version===version)return{state:'unchanged',settled:0};const result=settleSuggestions(store,at);store.fence.assert();store.set('reliable:grading-attempt',{at,version,...result});if(!result.held.length)store.set('reliable:grading',{at,version,...result});return result;}
async function execute(request:TaskRequest){
 if(request.kind==='analytics'){setPriority(19);globalThis.fetch=async()=>{throw new Error('ANALYTICS_NETWORK_DISABLED');};return computeAnalytics(request.database,request.at);}
 const config=loadConfig(request.configFile);if(config.database!==request.database)throw new Error('RESEARCH_DATABASE_BINDING_CHANGED');
 const store=new FencedStore(request.database,request.owners,nowISO,f=>process.send?.({type:'lease',lease:f}));
 try{
  const before=reconcileGrades(store,nowISO());ensureFinalJob(store,nowISO());
  const result=await liveOnce(store,config,{reliability:{maxJobs:1,maxRequests:request.maxRequests,assertOwner:store.fence.assert,onJob:job=>{store.setTaskDeadline(job.deadline);store.set('reliable:current-job',{...job,at:nowISO(),pid:process.pid});process.send?.({type:'job',job});},finalRelevant:at=>finalSchedule(store,at).some(j=>ms(j.nextAt)<=ms(at)),finalStep:(http:JsonHTTP,at:string)=>finalStep(store,http,at)}});
  const after=reconcileGrades(store,nowISO());store.fence.assert();return{cycle:result,grading:{before,after}};
 }finally{store.close();}
}
if(process.send){process.once('disconnect',()=>process.exit(process.exitCode===1?1:0));process.once('message',(request:TaskRequest)=>{execute(request).then(result=>{process.send?.({type:'result',result},()=>process.disconnect?.());}).catch(e=>{process.exitCode=1;process.send?.({type:'error',reason:safeReason(e)},()=>process.disconnect?.());});});}
