import{appendFileSync,mkdirSync,statSync,existsSync,renameSync}from'node:fs';
import{Store}from'../../core/store';import{type Config}from'../../core/config';import{ms,nowISO}from'../../core/domain';
import{installFence,isBusy,OwnershipLost,type Fence}from'./store';import{evaluationVersion,commitAnalytics,type AnalyticsResult}from'./analytics';
import{startTask,renewOwnership,nextUrgent,safeReason,LEASE_SECONDS,type TaskHandle,type TaskRequest}from'./supervisor';

function journal(value:unknown){mkdirSync('.local/logs',{recursive:true,mode:0o700});const p='.local/logs/reliability.jsonl';if(existsSync(p)&&statSync(p).size>1000000)renameSync(p,p+'.1');appendFileSync(p,JSON.stringify(value)+'\n',{mode:0o600});}
export async function reliableWorker(store:Store,readConfig:()=>Config,signal:AbortSignal,options:{clock?:()=>string;heartbeatMs?:number;tickMs?:number;spawn?:(r:TaskRequest)=>TaskHandle;configFile?:string}={}){
 const clock=options.clock??nowISO,start=clock(),token=store.acquire('live-worker',start,LEASE_SECONDS);if(!token)throw new Error('RESEARCH_WORKER_ALREADY_OWNED');
 const owner={name:'live-worker',token},fence=installFence(store,[owner],clock);let source:TaskHandle|null=null,analytics:TaskHandle|null=null,sourceSlot:Fence|null=null,analyticsSlot:Fence|null=null,lost=false,sourceSince=0,analysisRetry=0,lastGap=ms(start);
 const spawn=options.spawn??(request=>startTask(request,{clock}));
 const release=(lease:Fence)=>{try{fence.release(lease);}catch(e){if(!isBusy(e))throw e;journal({at:clock(),type:'busy',reason:'RELEASE_DEFERRED_TO_LEASE_EXPIRY'});}};
 const stop=()=>{source?.cancel('WORKER_STOPPED');analytics?.cancel('WORKER_STOPPED');};signal.addEventListener('abort',stop,{once:true});
 const beat=()=>{if(lost)return;try{
  const at=clock(),gap=ms(at)-lastGap;if(gap>LEASE_SECONDS*1000){journal({at,type:'gap',seconds:gap/1000});source?.cancel('SLEEP_OR_WAKE_OWNERSHIP_RECHECK');analytics?.cancel('SLEEP_OR_WAKE_OWNERSHIP_RECHECK');}
  renewOwnership(store,owner,source,at);for(const slot of [sourceSlot,analyticsSlot])if(slot&&!store.renew(slot.name,slot.token,at,LEASE_SECONDS))throw new OwnershipLost();
  store.set('live:worker',{at,state:source?'running':'waiting',implementation:'1.4.5',pid:process.pid});store.set('reliable:worker',{at,pid:process.pid,state:source?'running':'waiting',source:source?.job??null,sourceStartedAt:source?.startedAt??null,analyticsStartedAt:analytics?.startedAt??null});lastGap=ms(at);
  const urgent=nextUrgent(store,at);if(urgent&&analytics)analytics.cancel('YIELD_TO_IMMINENT_PREGAME');
  if(source?.job?.deadline&&ms(source.job.deadline)<=ms(at))source.cancel('PREGAME_TASK_DEADLINE_REACHED');
  if(urgent&&source?.job&&!source.job.deadline&&ms(at)-ms(source.startedAt)>1000)source.cancel('YIELD_TO_IMMINENT_PREGAME');
 }catch(e){if(isBusy(e)){journal({at:clock(),type:'busy',reason:'HEARTBEAT_RETRY'});return;}lost=true;source?.cancel('RESEARCH_OWNERSHIP_LOST');analytics?.cancel('RESEARCH_OWNERSHIP_LOST');journal({at:clock(),type:'lease_lost',reason:safeReason(e)});}};
 const timer=setInterval(beat,options.heartbeatMs??20000);
 try{
  store.set('reliable:active',{at:start,version:'1.4.5',pid:process.pid});beat();
  while(!signal.aborted&&!lost){
   try{
   const at=clock(),config=readConfig();if(config.operatingMode==='disabled')break;
   const before=Number((store.db.prepare("SELECT count(*) AS n FROM quota WHERE provider='balldontlie'").get()as{n:number}).n),tickStart=ms(at);let processed=0;
   while(!signal.aborted&&!lost&&processed<12&&ms(clock())-tickStart<45000){
    const slot=store.acquire('reliable-source-task',clock(),LEASE_SECONDS);if(!slot)break;sourceSlot={name:'reliable-source-task',token:slot};sourceSince=ms(clock());
    const used=Number((store.db.prepare("SELECT count(*) AS n FROM quota WHERE provider='balldontlie'").get()as{n:number}).n)-before;
    source=spawn({kind:'source',database:config.database,owners:[owner,sourceSlot],at:clock(),maxRequests:Math.max(0,config.research.maxRequestsPerCycle-used),configFile:options.configFile});beat();
    const done=await source.done;processed++;for(const lease of source.leases)release(lease);source=null;release(sourceSlot);sourceSlot=null;
    if(lost)break;fence.assert();
    store.set('reliable:last-source-task',{at:clock(),elapsedMs:ms(clock())-sourceSince,ok:done.ok,reason:done.reason});
    if(!done.ok){journal({at:clock(),type:'source_failed',reason:done.reason});break;}
    const result=done.result as{cycle?:{state:string;outcomes?:unknown[]}};if(result.cycle&&['completed','waiting'].includes(result.cycle.state))store.set('reliable:last-successful-cycle',{at:clock(),state:result.cycle.state});
    if(!result.cycle?.outcomes?.length||result.cycle.state==='disabled')break;
   }
   if(lost||signal.aborted)break;
   // Unchanged inputs reuse the persisted result; no historical scans occur.
   const cache=store.get<{version:string}>('reliable:analytics-cache'),version=evaluationVersion(store),pending=store.db.prepare("SELECT id FROM research_jobs WHERE error='ANALYTICS_DELEGATED' LIMIT 1").get();
   if(cache?.version===version&&pending)store.db.prepare("UPDATE research_jobs SET next_at=?,state='queued',error='ANALYTICS_UNCHANGED_REUSED' WHERE error='ANALYTICS_DELEGATED'").run(new Date(ms(clock())+6*3600000).toISOString());
   if(!analytics&&pending&&cache?.version!==version&&!nextUrgent(store,clock())&&ms(clock())>=analysisRetry){
    const slot=store.acquire('research-analytics',clock(),LEASE_SECONDS);if(slot){analyticsSlot={name:'research-analytics',token:slot};const task=spawn({kind:'analytics',database:config.database,owners:[owner,analyticsSlot],at:clock(),maxRequests:0});analytics=task;
     void task.done.then(done=>{try{if(lost||signal.aborted)return;const assertAnalytics=()=>{fence.assert();if(!analyticsSlot||!store.leaseValid(analyticsSlot.name,analyticsSlot.token,clock()))throw new OwnershipLost();};assertAnalytics();if(done.ok){const result=commitAnalytics(store,done.result as AnalyticsResult,clock(),assertAnalytics);store.set('reliable:last-analytics',{at:clock(),state:result.state,elapsedMs:ms(clock())-ms(task.startedAt)});}else{store.set('reliable:last-analytics',{at:clock(),state:'deferred',reason:done.reason});analysisRetry=ms(clock())+300000;}}catch(e){journal({at:clock(),type:'analytics_commit_failed',reason:safeReason(e)});analysisRetry=ms(clock())+60000;}finally{if(analyticsSlot)release(analyticsSlot);analyticsSlot=null;analytics=null;}});
    }
   }
   beat();await new Promise<void>(resolve=>{const t=setTimeout(done,options.tickMs??Math.max(1000,60000-(ms(clock())-tickStart)));function done(){clearTimeout(t);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});
   }catch(e){if(!isBusy(e))throw e;journal({at:clock(),type:'busy',reason:'CYCLE_RETRY'});await new Promise(r=>setTimeout(r,250));}
  }
 }catch(e){journal({at:clock(),type:'worker_failed',reason:safeReason(e)});throw e;}
 finally{
  clearInterval(timer);signal.removeEventListener('abort',stop);source?.cancel('WORKER_STOPPED');analytics?.cancel('WORKER_STOPPED');const tasks=[source?.done,analytics?.done].filter(Boolean);await Promise.allSettled(tasks);if(sourceSlot)release(sourceSlot);if(analyticsSlot)release(analyticsSlot);
  try{if(store.leaseValid(owner.name,owner.token,clock())){store.set('live:worker',{at:clock(),state:'stopped',implementation:'1.4.5'});store.set('reliable:worker',{at:clock(),state:'stopped'});}}finally{release(owner);fence.restore();}
 }
}
