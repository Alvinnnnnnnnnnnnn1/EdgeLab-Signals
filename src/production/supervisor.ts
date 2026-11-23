import {spawn,type ChildProcess} from 'node:child_process';
import {readFileSync,existsSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash,ms,nowISO} from '../core/domain';
import {EfficientStore,installFence,type Fence} from '../research/reliability/store';
import {Store} from '../core/store';
import {productionDue} from '../research-advanced/prospective';
import {HybridJournal,type ComparisonPlan} from './journal';
import {productionManifest} from './manifest';
export const COMPARISON_LEASE_SECONDS=150;
export function verifiedPlan(path:string):ComparisonPlan{
 const plan=JSON.parse(readFileSync(path,'utf8')) as ComparisonPlan;
 const release=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
 if(plan.code.dirty||!/^[a-f0-9]{40}$/.test(plan.code.commit)||!Object.keys(plan.code.files).includes('src/production/journal.ts'))throw new Error('PINNED_COMPARISON_CODE_REQUIRED');
 if(hash(productionManifest(release))!==hash(plan.code.files))throw new Error('PINNED_COMPARISON_CODE_CHANGED');
 if(resolve(plan.sourcePath)===resolve(plan.journalPath)||!resolve(plan.sourcePath).startsWith(resolve('.local')+'/'))throw new Error('SEPARATE_PRIVATE_SOURCE_REQUIRED');
 return plan;
}
export function acquireJournal(j:HybridJournal,at:string){const db=j.journal.db,token=randomUUID();db.exec('BEGIN IMMEDIATE');try{const row=db.prepare("SELECT expires_at FROM leases WHERE name='comparison-worker'").get();if(row&&ms(String(row.expires_at))>ms(at)){db.exec('ROLLBACK');return null;}db.prepare("INSERT INTO leases VALUES ('comparison-worker',?,?) ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at").run(token,new Date(ms(at)+COMPARISON_LEASE_SECONDS*1000).toISOString());db.exec('COMMIT');return{name:'comparison-worker',token};}catch(e){db.exec('ROLLBACK');throw e;}}
export function renewJournal(j:HybridJournal,owner:Fence,at:string){return !!j.journal.db.prepare('UPDATE leases SET expires_at=? WHERE name=? AND token=? AND expires_at>?').run(new Date(ms(at)+COMPARISON_LEASE_SECONDS*1000).toISOString(),owner.name,owner.token,at).changes;}
export function boundedComparisonChild(planPath:string,owner:Fence,kind:'register'|'report',script=fileURLToPath(new URL('./worker-child.ts',import.meta.url)),runtimeMs=kind==='report'?90000:45000){
 // Whitelist: no provider, messaging or inherited Node injection credentials.
 const env:NodeJS.ProcessEnv={NODE_ENV:'production',...Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].flatMap(k=>process.env[k]?[[k,process.env[k]!]]:[]))};
 const child=spawn('/bin/sh',['-c','ulimit -t "$1" || exit 78; shift; exec "$@"','edgelab-comparison',kind==='report'?'75':'35',process.execPath,'--max-old-space-size=512','--import','tsx',script],{cwd:process.cwd(),env,stdio:['ignore','ignore','ignore','ipc']});let killTimer:ReturnType<typeof setTimeout>|undefined,result:unknown=null,reason='CHILD_EXITED_WITHOUT_RESULT';
 const cancel=(why:string)=>{reason=why;child.kill('SIGTERM');killTimer??=setTimeout(()=>child.kill('SIGKILL'),1000);};
 const timer=setTimeout(()=>cancel('COMPARISON_WALL_LIMIT'),runtimeMs);
 const done=new Promise<{ok:boolean;reason:string;result:unknown}>(resolve=>{child.on('message',(m:any)=>{if(m.type==='result'){result=m.result;reason='completed';}else if(m.type==='error')reason=/^[A-Z_]+$/.test(m.reason)?m.reason:'COMPARISON_CHILD_FAILED';});const finish=(ok:boolean)=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);resolve({ok,reason,result});};child.once('exit',code=>finish(code===0&&reason==='completed'));child.once('error',()=>finish(false));});
 child.send({planPath,owner,kind},error=>{if(error)cancel('COMPARISON_IPC_FAILED');});return{child,done,cancel};
}
export {comparisonHealth} from './health';

const readMeta=(j:HybridJournal,key:string)=>{const r=j.journal.db.prepare('SELECT value FROM comparison_meta WHERE key=?').get(key);return r?JSON.parse(String(r.value)):null;};
export async function runComparisonWorker(planPath:string){
 for(const key of ['ODDS_API_KEY','BALLDONTLIE_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','BLUEBUBBLES_PASSWORD'])if(process.env[key])throw new Error('COMPARISON_CREDENTIALS_FORBIDDEN');
 globalThis.fetch=async()=>{throw new Error('COMPARISON_NETWORK_FORBIDDEN');};
 const plan=verifiedPlan(planPath),j=new HybridJournal(plan),source=new EfficientStore(plan.sourcePath,true),owner=acquireJournal(j,nowISO());if(!owner){source.close();j.close();throw new Error('COMPARISON_OWNER_ALREADY_RUNNING');}
 let stopping=false,task:ReturnType<typeof boundedComparisonChild>|null=null,lastTick=Date.now(),nextRegister=0,nextReport=0;
 const stop=()=>{stopping=true;task?.cancel('COMPARISON_SHUTDOWN');};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{while(!stopping){
  const at=nowISO(),gap=Date.now()-lastTick;lastTick=Date.now();if(gap>30000)task?.cancel('COMPARISON_SLEEP_WAKE_GAP');
  if(!renewJournal(j,owner,at)){task?.cancel('COMPARISON_OWNERSHIP_LOST');throw new Error('COMPARISON_OWNERSHIP_LOST');}
  const due=productionDue(source,at);if(due)task?.cancel('YIELD_TO_PRODUCTION_DEADLINE');
  j.journal.db.prepare("INSERT INTO comparison_meta VALUES ('worker',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({at,pid:process.pid,version:'1.4.7',commit:plan.code.commit,state:task?'working':due?'yielded':'waiting',childPID:task?.child.pid??null,lastGapMs:gap,networkRequests:0,outboundMessages:0,sourceReadOnly:true,journalOnlyWrites:true}));
  if(!task&&!due){const kind=Date.now()>=nextReport?'report':Date.now()>=nextRegister?'register':null;if(kind){
   task=boundedComparisonChild(planPath,owner,kind);if(kind==='report')nextReport=Date.now()+300000;else nextRegister=Date.now()+15000;
   const current=task;void current.done.then(result=>{if(task!==current)return;try{if(renewJournal(j,owner,nowISO())){const body=JSON.stringify({at:nowISO(),kind,...result});j.journal.db.prepare("INSERT INTO comparison_meta VALUES ('task',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(body);j.journal.db.prepare('INSERT INTO comparison_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`task:${kind}`,body);}}catch{/* Ownership fails closed on the next heartbeat. */}task=null;});
  }}await new Promise(resolve=>setTimeout(resolve,5000));
 }}finally{stopping=true;task?.cancel('COMPARISON_SHUTDOWN');if(task)await task.done;j.journal.db.prepare('DELETE FROM leases WHERE name=? AND token=?').run(owner.name,owner.token);source.close();j.close();}
}
export async function comparisonChild(request:{planPath:string;owner:Fence;kind:'register'|'report'}){
 globalThis.fetch=async()=>{throw new Error('COMPARISON_NETWORK_FORBIDDEN');};
 const plan=verifiedPlan(request.planPath),j=new HybridJournal(plan,nowISO,false),source=new EfficientStore(plan.sourcePath,true),holder={db:j.journal.db} as Store,started=Date.now();
 const fence=installFence(holder,[request.owner],nowISO,()=>{if(Date.now()-started>(request.kind==='report'?85000:40000))throw new Error('COMPARISON_TASK_DEADLINE');if(productionDue(source,nowISO()))throw new Error('YIELD_TO_PRODUCTION_DEADLINE');});
 Object.defineProperty(j.journal,'db',{value:holder.db});
 try{fence.assert();if(request.kind==='register')return{registrations:j.registerBatch(source),market:j.captureMarkets(source),resources:{elapsedMs:Date.now()-started,maxRSSKiB:process.resourceUsage().maxRSS,cpu:process.cpuUsage()}};
  const report=j.report(source),directory=resolve(dirname(plan.journalPath),'reports');fence.assert();mkdirSync(directory,{recursive:true,mode:0o700});const output=resolve(directory,`comparison-${report.at.replace(/[:.]/g,'-')}.json`);writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});j.journal.db.prepare("INSERT INTO comparison_meta VALUES ('report',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({at:report.at,path:output,pending:report.comparison.pending}));return{path:output,pending:report.comparison.pending,resources:{elapsedMs:Date.now()-started,maxRSSKiB:process.resourceUsage().maxRSS,cpu:process.cpuUsage()}};
 }finally{Object.defineProperty(j.journal,'db',{value:fence.raw});source.close();j.close();}
}
