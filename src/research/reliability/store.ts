import {DatabaseSync} from 'node:sqlite';
import {Store} from '../../core/store';
import {hash,ms,nowISO,gameLogSchema,assertReceipt,type Receipt,type GameLog} from '../../core/domain';

export interface Fence {name:string;token:string;}
export class OwnershipLost extends Error {constructor(){super('RESEARCH_OWNERSHIP_LOST');}}
export const isBusy=(e:unknown)=>e instanceof Error&&/locked|busy|SQLITE_BUSY/i.test(e.message);
/** Check and mutation share the same SQLite writer transaction. Checking a
 * token before an unguarded write would leave a takeover race. */
export function installFence(store:Store,fences:Fence[],clock=nowISO,assertTask=()=>{}){
 const raw=store.db;
 const assert=()=>{assertTask();const now=clock();for(const f of fences){const row=raw.prepare('SELECT token,expires_at FROM leases WHERE name=?').get(f.name)as{token:string;expires_at:string}|undefined;if(!row||row.token!==f.token||ms(row.expires_at)<=ms(now))throw new OwnershipLost();}};
 const atomic=<T>(fn:()=>T):T=>{const outer=raw.isTransaction;if(!outer)raw.exec('BEGIN IMMEDIATE');try{assert();const value=fn();assert();if(!outer)raw.exec('COMMIT');return value;}catch(e){if(!outer&&raw.isTransaction)raw.exec('ROLLBACK');throw e;}};
 store.db=new Proxy(raw,{get(target,key){
  if(key==='prepare')return(sql:string)=>{const statement=target.prepare(sql),readOnly=/^\s*(SELECT|EXPLAIN)\b/i.test(sql);return new Proxy(statement,{get(s,k){const value=Reflect.get(s,k,s);if(typeof value!=='function')return value;if(k==='run'||!readOnly&&['get','all','iterate'].includes(String(k)))return(...args:unknown[])=>atomic(()=>value.apply(s,args));return value.bind(s);}});};
  if(key==='exec')return(sql:string)=>{if(/^\s*(BEGIN|SAVEPOINT)\b/i.test(sql)){assert();return target.exec(sql);}if(/^\s*(COMMIT|END|RELEASE)\b/i.test(sql)){try{assert();return target.exec(sql);}catch(e){if(target.isTransaction)target.exec('ROLLBACK');throw e;}}if(/^\s*ROLLBACK\b/i.test(sql))return target.isTransaction?target.exec(sql):undefined;return atomic(()=>target.exec(sql));};
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 return{raw,assert,atomic,restore:()=>{store.db=raw;},release:(f:Fence)=>{raw.prepare('DELETE FROM leases WHERE name=? AND token=?').run(f.name,f.token);}};
}
/** Scope caches to one task/read snapshot. Positive immutable receipt proofs
 * are reused; missing receipts are never negatively cached. */
export class EfficientStore extends Store {
 private bodies=new Map<string,boolean>();private receipts=new Set<string>();
 metrics={receiptCalls:0,bodyHashes:0,bodyBytes:0};
 constructor(path:string,readOnly=false,private clock=nowISO){super(':memory:');super.close();this.db=new DatabaseSync(path,{readOnly});this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=150');}
 override hasReceipt(source:Receipt){
  this.metrics.receiptCalls++;const id=hash(source);if(this.receipts.has(id))return true;
  if(!this.bodies.has(source.hash)){const row=this.db.prepare('SELECT body FROM receipts WHERE hash=?').get(source.hash)as{body:string}|undefined;if(!row)return false;this.metrics.bodyHashes++;this.metrics.bodyBytes+=Buffer.byteLength(row.body);if(hash(row.body)!==source.hash)return false;this.bodies.set(source.hash,true);}
  if(!this.db.prepare('SELECT id FROM source_receipts WHERE id=?').get(id))return false;this.receipts.add(id);return true;
 }
 override ingest(logs:GameLog[],at:string,simulated=false){
  // Expensive schema/hash validation happens before acquiring a writer lock.
  const checked=logs.map(raw=>{const r=gameLogSchema.parse(raw);for(const s of [r.source,...(r.supportingSources??[])]){assertReceipt(s,at,simulated);if(!this.hasReceipt(s))throw new Error('Retained source body missing');}if(ms(r.observedAt)>ms(at))throw new Error('Future observation');return r;});let inserted=0;
  for(let i=0;i<checked.length;i+=100)this.transaction(()=>{const statement=this.db.prepare('INSERT OR IGNORE INTO logs VALUES (?,?,?,?,?)');for(const r of checked.slice(i,i+100))inserted+=Number(statement.run(hash([r.event.id,r.playerId,r.source.hash]),r.event.id,r.playerId,r.observedAt,JSON.stringify(r)).changes);});return inserted;
 }
 override reserve(...args:Parameters<Store['reserve']>){if(args[0]!=='balldontlie'||args[2]!==0)throw new Error('RESEARCH_CHILD_CANNOT_ACQUIRE_PAID_MARKETS');return super.reserve(...args);}
}

export class FencedStore extends EfficientStore {
 readonly fence:ReturnType<typeof installFence>;
 private deadline:string|null=null;
 constructor(path:string,owners:Fence[],clock=nowISO,private onLease?:(f:Fence)=>void){super(path,false,clock);this.fence=installFence(this,owners,clock,()=>{if(this.deadline&&ms(clock())>=ms(this.deadline))throw new Error('PREGAME_TASK_DEADLINE_REACHED');});this.owners=owners;}
 setTaskDeadline(value:string|null){this.deadline=value;}
 private owners:Fence[];
 override acquire(name:string,at:string,ttl:number){const token=super.acquire(name,at,ttl);if(token){const f={name,token};this.owners.push(f);this.onLease?.(f);}return token;}
 override release(name:string,token:string){this.fence.release({name,token});const i=this.owners.findIndex(f=>f.name===name&&f.token===token);if(i>=0)this.owners.splice(i,1);}
}
