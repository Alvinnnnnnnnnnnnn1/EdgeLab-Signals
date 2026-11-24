import{nextSlateResearch}from'../multi-bookmaker/slate';
import{fileURLToPath}from'node:url';
import {appendFileSync,mkdirSync,existsSync,statSync,renameSync} from 'node:fs';
import {Store} from '../core/store';
import type {Config} from '../core/config';
import {nowISO,ms} from '../core/domain';
import {spawn,type ChildProcess} from 'node:child_process';
import {recurringCycle,evaluationInputVersion} from './recurring';

function log(value:unknown){mkdirSync('.local/logs',{recursive:true,mode:0o700});const path='.local/logs/markets.jsonl';if(existsSync(path)&&statSync(path).size>1000000)renameSync(path,`${path}.1`);appendFileSync(path,JSON.stringify(value)+'\n',{mode:0o600});}
export async function recurringWorker(store:Store,readConfig:()=>Config,policyPath:string,signal:AbortSignal){
  const lease=store.acquire('recurring-market-worker',nowISO(),150);if(!lease)throw new Error('A recurring market worker already owns this database');
  let diagnostics:ChildProcess|null=null,lastDiagnosticAttempt=0,childKind:'research'|'analytics'|null=null;
  try{while(!signal.aborted){const at=nowISO(),config=readConfig(),previous=store.get<{at:string}>('recurring:worker');
    if(previous&&ms(at)-ms(previous.at)>180000)store.set('recurring:gap',{from:previous.at,to:at,reason:'Sleep, stopped process or outage; missed market deadlines expire'});
    if(!store.renew('recurring-market-worker',lease,at,150))throw new Error('Recurring worker lease expired');store.set('recurring:worker',{at,state:'running'});
    let researchRequired=false;
    try{const result=await recurringCycle(store,config,policyPath);researchRequired=result.state==='full_slate_research_required';log({at:nowISO(),state:result.state,networkRequests:result.networkRequests});}catch{log({at:nowISO(),state:'cycle_error'});}
    // CPU-heavy diagnostics run in a separate, bounded process after delivery.
    // They cannot occupy this scheduler's event loop or acquisition lease.
    const imminent=store.db.prepare("SELECT id FROM recurring_market_jobs WHERE state IN ('queued','deferred','observed') AND due_at<=? AND deadline>? LIMIT 1").get(new Date(ms(nowISO())+5*60000).toISOString(),nowISO());
    if(config.multiBookmaker.codeEnabled&&imminent&&diagnostics&&childKind==='analytics')diagnostics.kill('SIGTERM');
    const research:ReturnType<typeof nextSlateResearch>=config.multiBookmaker.codeEnabled&&config.operatingMode!=='disabled'&&(!imminent||researchRequired)&&!signal.aborted&&!diagnostics?nextSlateResearch(store,nowISO()):null;
    if(research){const slot=store.acquire('multi-slate-research',nowISO(),30);if(slot){const database=String(store.db.prepare('PRAGMA database_list').all().find(r=>r.name==='main')!.file),child:ChildProcess=spawn(process.execPath,['--env-file-if-exists=.env.local','--import','tsx',fileURLToPath(new URL('../multi-bookmaker/research-child.ts',import.meta.url)),database,research.date,lease,slot],{cwd:process.cwd(),env:process.env,stdio:'ignore'});diagnostics=child;childKind='research';const timer=setTimeout(()=>child.kill('SIGTERM'),10000),done=()=>{clearTimeout(timer);store.release('multi-slate-research',slot);if(diagnostics===child){diagnostics=null;childKind=null;}};child.once('error',done);child.once('exit',done);}}
    if(config.operatingMode!=='disabled'&&!imminent&&!signal.aborted&&!diagnostics&&Date.now()-lastDiagnosticAttempt>300000&&store.get('recurring:evaluation-version')!==evaluationInputVersion(store)){
      lastDiagnosticAttempt=Date.now();const child=spawn(process.execPath,['--env-file-if-exists=.env.local','--import','tsx','src/research/cli.ts','recurring-grade'],{cwd:process.cwd(),env:process.env,stdio:'ignore'});diagnostics=child;childKind='analytics';
      const timeout=setTimeout(()=>child.kill('SIGTERM'),120000);
      child.once('error',()=>{clearTimeout(timeout);diagnostics=null;childKind=null;log({at:nowISO(),state:'diagnostics_process_error'});});
      child.once('exit',code=>{clearTimeout(timeout);diagnostics=null;childKind=null;if(code!==0)log({at:nowISO(),state:'diagnostics_process_stopped'});});
    }
    store.set('recurring:worker',{at:nowISO(),state:'waiting'});
    await new Promise<void>(resolve=>{const timer=setTimeout(done,60000);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});
  }}finally{if(diagnostics){const child=diagnostics;await new Promise<void>(resolve=>{if(child.exitCode!==null){resolve();return;}const timer=setTimeout(resolve,3000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}store.set('recurring:worker',{at:nowISO(),state:'stopped'});store.release('recurring-market-worker',lease);}
}
