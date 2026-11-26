import{randomUUID}from'node:crypto';
import type{Store}from'../../core/store';
import{ms}from'../../core/domain';
/** Uses the source controller's existing admission mutex. Acquisition never
 * replaces an unexpired cycle, and all existing work finishes before it can
 * succeed. Parent heartbeat/ownership are independent and keep renewing. */
export function beginSourceMaintenance(s:Store,at:string,expectedPID:number,reference:string){
 if(!Number.isInteger(expectedPID)||expectedPID<=0||!reference.trim())throw Error('MAINTENANCE_OWNER_REFERENCE_REQUIRED');
 const worker=s.get<{pid:number;at:string;source:unknown}>('reliable:worker');
 if(worker?.pid!==expectedPID||ms(at)-ms(worker.at)>45000)throw Error('SOURCE_OWNER_UNVERIFIED');
 const previous=s.get<{token:string;state:string}>('maintenance:source');
 const lease=s.db.prepare("SELECT token,expires_at FROM leases WHERE name='live-cycle'").get()as{token:string;expires_at:string}|undefined;
 if(previous?.state==='paused'&&lease?.token===previous.token&&ms(lease.expires_at)>ms(at))throw Error('MAINTENANCE_ALREADY_OWNED');
 const token=s.acquire('live-cycle',at,150);if(!token)return null;
 const record={id:randomUUID(),token,expectedPID,reference,at,state:'paused' as const,mechanism:'EXISTING_LIVE_CYCLE_MUTEX',resume:'Release only this token; expiry permits normal recovery without removing any work'};
 s.set('maintenance:source',record);return record;
}
export function sourceDrained(s:Store,token:string,at:string){
 if(!s.leaseValid('live-cycle',token,at))throw Error('MAINTENANCE_OWNERSHIP_LOST');
 const since=new Date(ms(at)-150000).toISOString();
 // BDL has a bounded HTTP timeout and a150second source ownership lease.
 // Old zero-cost failed reservations remain counted in quota/evidence; they
 // cannot represent an in-flight request after that ownership has expired.
 const worker=s.get<{source:unknown}>('reliable:worker'),running=s.db.prepare("SELECT id FROM research_jobs WHERE state='running' LIMIT 1").get(),request=s.db.prepare("SELECT id FROM quota WHERE provider='balldontlie' AND outcome='reserved' AND at>=? LIMIT 1").get(since);
 const historical=s.db.prepare("SELECT count(*) AS n FROM quota WHERE provider='balldontlie' AND outcome='reserved' AND at<?").get(since)!.n;
 return{at,drained:!worker?.source&&!running&&!request,admissionBlocked:true,activeJob:worker?.source??running??null,pendingRequest:request??null,historicalReservationsPreserved:historical};
}
export function renewSourceMaintenance(s:Store,token:string,at:string){if(!s.renew('live-cycle',token,at,150))throw Error('MAINTENANCE_OWNERSHIP_LOST');return sourceDrained(s,token,at);}
export function resumeSource(s:Store,token:string,at:string){
 const previous=s.get<{token:string}>('maintenance:source');if(previous?.token!==token)throw Error('MAINTENANCE_OWNER_MISMATCH');
 // Token-conditional release cannot invalidate a later legitimate source owner.
 s.release('live-cycle',token);s.set('maintenance:source',{...previous,state:'resumed',resumedAt:at});
}
