// Isolated stress helper. No providers, credentials, or production database.
import{performance}from'node:perf_hooks';
process.once('message',(r:{kind:string;maxRequests:number})=>{
 process.send?.({type:'job',job:{id:'TEST-ONLY-cpu',kind:'monitor',deadline:null}});
 const end=performance.now()+r.maxRequests;let iterations=0;
 while(performance.now()<end){Math.sqrt(++iterations);}
 process.send?.({type:'result',result:{iterations}},()=>process.disconnect?.());
});
