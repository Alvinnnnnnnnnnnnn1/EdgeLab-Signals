import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';
export interface ReviewRequest{sourcePath:string;journalPath:string;protocolId:string;}
/** Diagnostic computation is a bounded read-only child. The legitimate parent
 * alone appends a verified result, keeping its lease/forecast loop awake. */
export function boundedTrialReview(request:ReviewRequest,runtimeMs=180000){
 const env:NodeJS.ProcessEnv={NODE_ENV:'production',...Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].flatMap(k=>process.env[k]?[[k,process.env[k]!]]:[]))},child=spawn(process.execPath,['--max-old-space-size=512','--import','tsx',fileURLToPath(new URL('./review-child.ts',import.meta.url))],{cwd:process.cwd(),env,stdio:['ignore','ignore','ignore','ipc']});let report:any=null,reason='REVIEW_CHILD_EXITED_WITHOUT_REPORT',kill:ReturnType<typeof setTimeout>|undefined;
 const cancel=(why:string)=>{reason=why;child.kill('SIGTERM');kill??=setTimeout(()=>child.kill('SIGKILL'),1000);},timer=setTimeout(()=>cancel('REVIEW_WALL_LIMIT'),runtimeMs),done=new Promise<{ok:boolean;reason:string;report:any}>(resolve=>{child.on('message',(m:any)=>{if(m.type==='report'){report=m.report;reason='COMPLETED_READ_ONLY_REVIEW';}else if(m.type==='error')reason=m.reason;});const finish=(code:number|null)=>{clearTimeout(timer);if(kill)clearTimeout(kill);resolve({ok:code===0&&!!report,reason,report});};child.once('exit',finish);child.once('error',()=>finish(null));});child.send(request,error=>{if(error)cancel('REVIEW_IPC_FAILED');});return{child,done,cancel};
}
