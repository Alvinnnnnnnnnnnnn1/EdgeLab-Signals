import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash,ms } from '../core/domain';
import { EfficientStore } from '../research/reliability/store';
import { EngineeringJournal } from '../model-engineering/journal';
import { assertArtifact,type M1Artifact } from '../model-engineering/m1';
import { assertProtocol,type TrialProtocol } from './contracts';
import { statisticalHash,trialCodeHash,trialRoot,assertFrozenConfiguration } from './code';
import { TrialForecaster,trialWorkReady } from './cycle';
import { installTrial } from './journal';
import { appendTrialReview } from './review';
import { supplementalProtection } from '../production/supersession';
import { fenceTrialJournal } from './fence';

export interface TrialServicePlan{protocol:TrialProtocol;modelPath:string;hybridPath:string;sourcePath:string;journalPath:string;protectionPath:string;protectionHash:string;operationalRepair?:{release:string;codeHash:string};}
/** Drain cached backlog in bounded bursts; give source/acquisition owners a
 * quiet retry interval and return to the normal idle cadence when caught up. */
export function trialCycleDelay(result:any){return result?.state==='YIELDED_TO_SOURCE_OR_MARKETS'?5000:result?.state==='YIELDED'&&result.examined>0?1000:15000;}
/** Contention is a wait, never a reason to overwrite another owner's lease. */
export async function awaitTrialOwner(owner:()=>void,stopped:()=>boolean,wait=()=>new Promise<void>(r=>setTimeout(r,5000))){
 while(!stopped()){try{owner();return true;}catch(e){if((e as Error).message!=='M1_TRIAL_ALREADY_OWNED')throw e;await wait();}}
 return false;
}
export async function trialService(plan:TrialServicePlan,once=false){
  // Cached-only process. No provider transport or credential loader is imported.
  globalThis.fetch=async()=>{throw Error('M1_CACHED_WORKER_NETWORK_FORBIDDEN');};
  const p=plan.protocol;assertProtocol(p);const repair=plan.operationalRepair;
  if(repair){if(resolve(repair.release)!==trialRoot||repair.codeHash!==trialCodeHash()||p.codeHash!==trialCodeHash(p.release))throw Error('PINNED_OPERATIONAL_REPAIR_REQUIRED');}
  else if(p.codeHash!==trialCodeHash()||resolve(p.release)!==trialRoot)throw Error('PINNED_TRIAL_SOURCE_REQUIRED');
  const model=JSON.parse(readFileSync(plan.modelPath,'utf8')) as M1Artifact;assertArtifact(model);
  if(model.id!==p.modelId||model.sourceHash!==p.statisticalSourceHash||statisticalHash()!==model.sourceHash)throw Error('FROZEN_M1_ARTIFACT_REQUIRED');
  const hybrid=JSON.parse(readFileSync(plan.hybridPath,'utf8'));if(hash(hybrid)!==p.hybridArtifactHash||hybrid.id!==p.hybridArtifactId||hybrid.parameters.algorithm!=='hybrid-quantile-ewa'||hybrid.parameters.blendWeight!==.25)throw Error('FROZEN_ORIGINAL_ASSISTS_REQUIRED');
  assertFrozenConfiguration(p);const source=new EfficientStore(plan.sourcePath,true);const protection=JSON.parse(readFileSync(plan.protectionPath,'utf8'));if(!supplementalProtection(source,protection,plan.protectionHash,new Date().toISOString()).safe){source.close();throw Error('TRIAL_PROTECTION_REQUIRED');}
  const j=new EngineeringJournal(plan.journalPath,true),token=randomUUID(),raw=j.db;
  let stopped=false;const stop=()=>{stopped=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const set=(key:string,value:unknown)=>raw.prepare('INSERT INTO engineering_runtime VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
  const owner=()=>{const at=new Date().toISOString();raw.exec('BEGIN IMMEDIATE');try{const r=raw.prepare("SELECT value FROM engineering_runtime WHERE key='trial-owner'").get(),old=r?JSON.parse(String(r.value)):null;if(old&&old.token!==token&&ms(old.expiresAt)>ms(at))throw Error('M1_TRIAL_ALREADY_OWNED');set('trial-owner',{token,pid:process.pid,at,expiresAt:new Date(ms(at)+90000).toISOString()});raw.exec('COMMIT');}catch(e){if(raw.isTransaction)raw.exec('ROLLBACK');throw e;}};
  const forecaster=new TrialForecaster(p,model,hybrid,j);let lastReview='';
  try{if(!await awaitTrialOwner(owner,()=>stopped))return;fenceTrialJournal(j,token);installTrial(j,p);j.publish(model);do{owner();const at=new Date().toISOString();let result:unknown;try{assertFrozenConfiguration(p);result=forecaster.cycle(source,2000,8);if(trialWorkReady(source,new Date().toISOString()))j.grade(source,50);}catch(e){result={state:'HELD',reason:(e as Error).message};}const reviewClock=new Date().toISOString(),reviewSlot=reviewClock.slice(0,13),marker=source.get<any>('production:m1-trial');if(marker?.enabled&&marker.protocol.id===p.id&&reviewSlot!==lastReview&&trialWorkReady(source,reviewClock)){try{appendTrialReview(source,j,marker,reviewClock);lastReview=reviewSlot;}catch(e){set('trial-review-hold',{at:reviewClock,reason:(e as Error).message});}}owner();const heartbeat={at:new Date().toISOString(),startedAt:at,pid:process.pid,token,protocolId:p.id,modelId:model.id,codeHash:trialCodeHash(),protocolCodeHash:p.codeHash,state:'running',result,networkRequests:0,messages:0};set('trial-heartbeat',heartbeat);console.log(JSON.stringify(heartbeat));if(once)break;await new Promise<void>(r=>{const wake=()=>{clearTimeout(timer);process.off('SIGTERM',wake);r();};const timer=setTimeout(wake,trialCycleDelay(result));process.once('SIGTERM',wake);});}while(!stopped);
  }finally{const row=j.db.prepare("SELECT value FROM engineering_runtime WHERE key='trial-owner'").get();if(row&&JSON.parse(String(row.value)).token===token){set('trial-owner',{token,pid:process.pid,at:new Date().toISOString(),expiresAt:new Date().toISOString(),state:'stopped'});set('trial-heartbeat',{at:new Date().toISOString(),pid:process.pid,protocolId:p.id,state:'stopped'});}source.close();j.close();process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const plan=JSON.parse(readFileSync(process.argv[2],'utf8'));await trialService(plan,process.argv.includes('--once'));}
