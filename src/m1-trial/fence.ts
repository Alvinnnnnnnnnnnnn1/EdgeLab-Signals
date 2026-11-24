import { ms } from '../core/domain';
import type { EngineeringJournal } from '../model-engineering/journal';
/** Every journal mutation shares a writer lock with its owner-token proof. An
 * expired or replaced worker cannot publish after a newer owner takes over. */
export function fenceTrialJournal(j:EngineeringJournal,token:string,clock=()=>new Date().toISOString()){
  const raw=j.db;
  const assert=()=>{const r=raw.prepare("SELECT value FROM engineering_runtime WHERE key='trial-owner'").get(),owner=r?JSON.parse(String(r.value)):null;if(!owner||owner.token!==token||ms(owner.expiresAt)<=ms(clock()))throw Error('TRIAL_JOURNAL_OWNERSHIP_LOST');};
  const atomic=<T>(fn:()=>T)=>{const outer=raw.isTransaction;if(!outer)raw.exec('BEGIN IMMEDIATE');try{assert();const value=fn();assert();if(!outer)raw.exec('COMMIT');return value;}catch(e){if(!outer&&raw.isTransaction)raw.exec('ROLLBACK');throw e;}};
  j.db=new Proxy(raw,{get(target,key){
    if(key==='prepare')return(sql:string)=>{const statement=target.prepare(sql),read=/^\s*(SELECT|EXPLAIN)\b/i.test(sql);return new Proxy(statement,{get(s,k){const value=Reflect.get(s,k,s);if(typeof value!=='function')return value;if(k==='run'||!read&&['get','all','iterate'].includes(String(k)))return(...args:unknown[])=>atomic(()=>value.apply(s,args));return value.bind(s);}});};
    if(key==='exec')return(sql:string)=>{if(/^\s*BEGIN\b/i.test(sql)){target.exec(sql);try{assert();}catch(e){target.exec('ROLLBACK');throw e;}return;}if(/^\s*(COMMIT|END)\b/i.test(sql)){try{assert();target.exec(sql);}catch(e){if(target.isTransaction)target.exec('ROLLBACK');throw e;}return;}if(/^\s*ROLLBACK\b/i.test(sql))return target.isTransaction?target.exec(sql):undefined;return atomic(()=>target.exec(sql));};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});return{raw,assert,restore:()=>{j.db=raw;}};
}
