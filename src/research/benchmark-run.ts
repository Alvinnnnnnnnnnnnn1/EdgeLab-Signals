import { mkdirSync,readFileSync,existsSync,openSync,writeSync,fsyncSync,closeSync,renameSync,appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { Store } from '../core/store';
import { hash,nowISO,props,type Prop,type League } from '../core/domain';
import { type Dataset } from './dataset';
import { runExperiment,PROTOCOL,type Experiment } from './experiment';
import { RESEARCH_VERSION } from './models';
import { type KnowledgeMode } from './features';

type Job={state:'pending'|'running'|'complete'|'blocked'|'failed';hash?:string;path?:string;elapsedSeconds?:number;error?:string};
export interface BenchmarkManifest {format:'benchmark-run/1.4';id:string;datasetId:string;modelVersion:string;protocol:string;mode:KnowledgeMode;targetSeasons:string[]|null;generatedAt:string;state:'running'|'partial'|'failed'|'complete';jobs:Record<string,Job>;ownerPid?:number;ownerHost?:string;}
export function atomicJSON(path:string,value:unknown,immutable=false){
  const text=JSON.stringify(value,null,2);
  if(immutable&&existsSync(path)){if(readFileSync(path,'utf8')!==text)throw new Error('Immutable report collision');return;}
  const tmp=`${path}.${randomUUID()}.tmp`,fd=openSync(tmp,'wx',0o600);
  try{writeSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(tmp,path);
}
export function benchmarkRun(store:Store,dataset:Dataset,options:{mode:KnowledgeMode;targetSeasons?:string[];prop?:Prop;resume?:boolean;directory?:string;clock?:()=>string;runner?:typeof runExperiment;progress?:(v:unknown)=>void}){
  const clock=options.clock??nowISO,identity={datasetId:dataset.id,modelVersion:RESEARCH_VERSION,protocol:PROTOCOL,mode:options.mode,targetSeasons:options.targetSeasons??null},id=hash(identity),directory=join(options.directory??'.local/benchmark-runs',id);
  mkdirSync(directory,{recursive:true,mode:0o700});const path=join(directory,'manifest.json');
  if(existsSync(path)&&!options.resume)throw new Error('Benchmark run exists; use --resume to verify and reuse completed props');
  if(existsSync(path)&&options.resume){
    const previous=JSON.parse(readFileSync(path,'utf8')) as BenchmarkManifest;
    if(previous.ownerHost===hash(hostname())&&previous.ownerPid&&previous.ownerPid!==process.pid){let dead=false;try{process.kill(previous.ownerPid,0);}catch(e){dead=!!e&&typeof e==='object'&&'code' in e&&e.code==='ESRCH';}
      if(dead){const old=store.db.prepare('SELECT token FROM leases WHERE name=?').get(`benchmark:${id}`) as {token:string}|undefined;if(old)store.release(`benchmark:${id}`,old.token);}
    }
  }
  const lease=store.acquire(`benchmark:${id}`,clock(),7200);if(!lease)throw new Error('This dataset/model benchmark is already running');
  let manifest:BenchmarkManifest;
  try{
    const keys=(['NBA','NBL'] as League[]).flatMap(league=>props.map(prop=>`${league}:${prop}`));
    manifest=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{format:'benchmark-run/1.4',id,...identity,generatedAt:clock(),state:'partial',jobs:Object.fromEntries(keys.map(k=>[k,{state:'pending'}]))};
    if(manifest.id!==id||hash({datasetId:manifest.datasetId,modelVersion:manifest.modelVersion,protocol:manifest.protocol,mode:manifest.mode,targetSeasons:manifest.targetSeasons})!==id)throw new Error('Benchmark manifest identity mismatch');
    for(const key of keys){
      const job=manifest.jobs[key],reportPath=join(directory,`${key.replace(':','-')}.json`);
      if(existsSync(reportPath)){
        const report=JSON.parse(readFileSync(reportPath,'utf8')) as Experiment;
        if(report.datasetId!==dataset.id||report.modelVersion!==RESEARCH_VERSION||report.generatedAt!==manifest.generatedAt||`${report.league}:${report.prop}`!==key||job.hash&&hash(report)!==job.hash)throw new Error('Completed report integrity mismatch');
        manifest.jobs[key]={...job,state:report.state==='evaluated'?'complete':'blocked',path:reportPath,hash:hash(report)};
      }else if(['complete','blocked'].includes(job.state))throw new Error('Completed benchmark checkpoint missing its immutable report');
    }
    manifest.state='running';manifest.ownerPid=process.pid;manifest.ownerHost=hash(hostname());atomicJSON(path,manifest);
    for(const key of keys){
      const [league,prop]=key.split(':') as [League,Prop],job=manifest.jobs[key];
      if(options.prop&&prop!==options.prop||['complete','blocked'].includes(job.state))continue;
      manifest.jobs[key]={state:'running'};atomicJSON(path,manifest);const start=performance.now();options.progress?.({phase:'benchmark_start',runId:id,league,prop});
      try{
        const report=(options.runner??runExperiment)(dataset,league,prop,manifest.generatedAt,options.mode,options.targetSeasons),reportPath=join(directory,`${league}-${prop}.json`);
        atomicJSON(reportPath,report,true);
        manifest.jobs[key]={state:report.state==='evaluated'?'complete':'blocked',hash:hash(report),path:reportPath,elapsedSeconds:(performance.now()-start)/1000};
      }catch(e){
        const error=e instanceof Error&&/^(Missing [a-z0-9:-]+ prediction on common row|Unsupported three-attempt tail|Incomplete (?:probability|attempt\/make) distribution)$/.test(e.message)?e.message:'Benchmark computation failed; private inputs retained, no promotion';
        manifest.jobs[key]={state:'failed',elapsedSeconds:(performance.now()-start)/1000,error};
      }
      appendFileSync(join(directory,'events.jsonl'),JSON.stringify({at:clock(),runId:id,league,prop,...manifest.jobs[key]})+'\n',{mode:0o600});atomicJSON(path,manifest);options.progress?.({phase:'benchmark_checkpoint',runId:id,league,prop,...manifest.jobs[key]});
    }
    const jobs=Object.values(manifest.jobs);manifest.state=jobs.some(j=>j.state==='failed')?'failed':jobs.every(j=>['complete','blocked'].includes(j.state))?'complete':'partial';atomicJSON(path,manifest);
    const reports=Object.values(manifest.jobs).filter(j=>j.path).map(j=>JSON.parse(readFileSync(j.path!,'utf8')) as Experiment);
    const reportsPath=manifest.state==='complete'?join(directory,'reports.json'):null;if(reportsPath)atomicJSON(reportsPath,reports,true);
    return{runId:id,state:manifest.state,manifestPath:path,path:reportsPath,reports:reports.map(r=>({league:r.league,prop:r.prop,state:r.state,selected:r.selected,promotion:r.promotion})),jobs:manifest.jobs};
  }finally{store.release(`benchmark:${id}`,lease);}
}
