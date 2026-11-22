import{spawn,type ChildProcess}from'node:child_process';
import{fileURLToPath}from'node:url';
import{Store}from'../../core/store';import{ms,nowISO}from'../../core/domain';import{isBusy,type Fence,OwnershipLost}from'./store';

export const LEASE_SECONDS=150;
export interface TaskRequest {kind:'source'|'analytics';database:string;owners:Fence[];at:string;maxRequests:number;configFile?:string;}
export interface TaskHandle {process:ChildProcess;startedAt:string;job:{id:string;kind:string;deadline:string|null}|null;leases:Fence[];done:Promise<{ok:boolean;result:unknown;reason:string}>;cancel:(reason:string)=>void;}
/** The controller event loop never runs the child's CPU-bound code. Its
 * heartbeat can renew the unchanged 150-second ownership lease. */
export function startTask(request:TaskRequest,options:{script?:string;runtimeMs?:number;clock?:()=>string;onJob?:(job:TaskHandle['job'])=>void}={}):TaskHandle{
 const clock=options.clock??nowISO,env={...process.env};if(request.kind==='analytics')for(const key of ['ODDS_API_KEY','BALLDONTLIE_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','BLUEBUBBLES_PASSWORD'])delete env[key];
 // The kernel CPU limit also survives an unexpected controller crash. Shell
 // arguments are passed positionally; no paths or secrets become shell code.
 const child=spawn('/bin/sh',['-c','ulimit -t "$1" || exit 78; shift; exec "$@"','edgelab-research',request.kind==='analytics'?'180':'120',process.execPath,'--max-old-space-size=512','--import','tsx',options.script??fileURLToPath(new URL('./child.ts',import.meta.url))],{cwd:process.cwd(),env,stdio:['ignore','ignore','ignore','ipc']}),leases:Fence[]=[];let result:unknown=null,reason='CHILD_EXITED_WITHOUT_RESULT',settled=false,killTimer:ReturnType<typeof setTimeout>|undefined;
 const handle:TaskHandle={process:child,startedAt:clock(),job:null,leases,done:Promise.resolve({ok:false,result:null,reason}),cancel:r=>{reason=r;child.kill('SIGTERM');killTimer??=setTimeout(()=>child.kill('SIGKILL'),1000);}};
 const timeout=setTimeout(()=>handle.cancel('BOUNDED_RESEARCH_TASK_TIMEOUT'),options.runtimeMs??(request.kind==='analytics'?180000:120000));
 handle.done=new Promise(resolve=>{
  const finish=(ok:boolean)=>{if(settled)return;settled=true;clearTimeout(timeout);if(killTimer)clearTimeout(killTimer);resolve({ok,result,reason});};
  child.on('message',(message:unknown)=>{const m=message as{type:string;result?:unknown;reason?:string;lease?:Fence;job?:TaskHandle['job']};if(m.type==='lease'&&m.lease?.name==='live-cycle'&&typeof m.lease.token==='string')leases.push(m.lease);if(m.type==='job'&&m.job){handle.job=m.job;options.onJob?.(m.job);}if(m.type==='result'){result=m.result;reason='completed';}if(m.type==='error')reason=m.reason&&/^[A-Z_]+$/.test(m.reason)?m.reason:'CHILD_RESEARCH_FAILED';});
  child.once('error',()=>{reason='CHILD_PROCESS_ERROR';finish(false);});child.once('exit',(code,signal)=>{if(reason==='CHILD_EXITED_WITHOUT_RESULT'&&signal)reason=signal==='SIGABRT'?'CHILD_RESOURCE_OR_RUNTIME_ABORT':'CHILD_TERMINATED_WITHOUT_RESULT';if(code===78)reason='CHILD_CPU_LIMIT_SETUP_FAILED';finish(code===0&&result!==null&&reason==='completed');});
 });
 child.send(request,error=>{if(error)handle.cancel('CHILD_IPC_FAILED');});return handle;
}
export function renewOwnership(store:Store,owner:Fence,child:TaskHandle|null,at=nowISO()){
 if(!store.renew(owner.name,owner.token,at,LEASE_SECONDS))throw new OwnershipLost();
 if(child)for(const lease of [...child.leases]){
  const row=store.db.prepare('SELECT token,expires_at FROM leases WHERE name=?').get(lease.name)as{token:string;expires_at:string}|undefined;
  if(!row){child.leases.splice(child.leases.indexOf(lease),1);continue;}
  if(row.token!==lease.token||ms(row.expires_at)<=ms(at)||!store.renew(lease.name,lease.token,at,LEASE_SECONDS)){child.cancel('SOURCE_CYCLE_OWNERSHIP_LOST');throw new OwnershipLost();}
 }
}
export function nextUrgent(store:Store,at:string){return store.db.prepare("SELECT id,kind,next_at,deadline FROM research_jobs WHERE deadline>? AND next_at<=? AND state IN ('queued','deferred','running') ORDER BY deadline,CASE kind WHEN 'fixtures' THEN 0 WHEN 'roster' THEN 1 WHEN 'injuries' THEN 2 ELSE 3 END LIMIT 1").get(at,new Date(ms(at)+5*60000).toISOString())as{id:string;kind:string;next_at:string;deadline:string}|undefined;}
export function safeReason(e:unknown){return e instanceof OwnershipLost?'RESEARCH_OWNERSHIP_LOST':isBusy(e)?'SQLITE_BUSY_RETRY':e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'RESEARCH_OPERATION_FAILED';}
