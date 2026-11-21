import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { type Config } from '../core/config';
import { Store } from '../core/store';
import { nowISO, ms, hash } from '../core/domain';
import { JsonHTTP } from '../providers/http';
import { BDLProvider } from '../providers/balldontlie';

export interface CollectionWindow { season:number; from:string; to:string; }
export const windowKey=(w:CollectionWindow)=>`ingest:league:${w.season}:${w.from}:${w.to}`;
export function pendingCollectionWindows(store:Store,windows:CollectionWindow[],at=nowISO()){
  const complete=(store.db.prepare("SELECT key,value FROM meta WHERE key LIKE 'ingest:league:%' OR key LIKE 'ingest:maintenance:%'").all() as {key:string;value:string}[]).flatMap(row=>{
    const match=row.key.match(/:(\d{4}):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/),c=JSON.parse(row.value) as {complete?:boolean;excluded?:number};
    return match&&c.complete===true&&!(c.excluded??0)&&match[3]<at.slice(0,10)?[{season:Number(match[1]),from:match[2],to:match[3]}]:[];
  });
  const shift=(day:string,n:number)=>new Date(Date.parse(`${day}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
  return windows.flatMap(window=>{let remaining=[window];for(const covered of complete){if(covered.season!==window.season)continue;remaining=remaining.flatMap(r=>covered.to<r.from||covered.from>r.to?[r]:[...(covered.from>r.from?[{...r,to:shift(covered.from,-1)}]:[]),...(covered.to<r.to?[{...r,from:shift(covered.to,1)}]:[])]);}return remaining;});
}
export function monthWindows(season:number,end:string):CollectionWindow[]{
  z.number().int().min(1946).max(2100).parse(season);z.iso.date().parse(end);
  const windows:CollectionWindow[]=[];
  for(let m=9;m<18;m++){
    const from=new Date(Date.UTC(season,m,1)).toISOString().slice(0,10);
    if(from>end)break;
    const to=[new Date(Date.UTC(season,m+1,0)).toISOString().slice(0,10),end].sort()[0];
    windows.push({season,from,to});
  }
  return windows;
}
export function bdlQuota(store:Store,config:Config,at:string){
  const day=at.slice(0,10),row=store.db.prepare("SELECT count(*) AS n,max(at) AS last FROM quota WHERE provider='balldontlie' AND substr(at,1,10)=?").get(day) as {n:number;last:string|null};
  return{utcDay:day,dailyLimit:config.providers.balldontlie.dailyLimit,used:Number(row.n),remaining:Math.max(0,config.providers.balldontlie.dailyLimit-Number(row.n)),lastRequestAt:row.last,minIntervalSeconds:config.providers.balldontlie.minIntervalSeconds};
}
export function collectionPlan(store:Store,config:Config,at=nowISO()){
  const closedDate=new Date(ms(at)-86400000).toISOString().slice(0,10);
  const periods=[{season:2024,end:'2025-06-30',estimatedFixtures:[1230,1342]}, {season:2025,end:'2026-06-30',estimatedFixtures:[1230,1342]}, {season:2026,end:closedDate,estimatedFixtures:[150,350]}];
  const seasons=periods.map(p=>{
    const windows=monthWindows(p.season,p.end).map(w=>({...w,checkpoint:store.get<{complete:boolean;pages?:number;rows?:number;excluded?:number}>(windowKey(w))}));
    // Bounds are planning assumptions, not measured API cardinalities. Include
    // per-window rounding and potentially empty terminal cursor pages.
    const requests=p.estimatedFixtures.map((games,i)=>Math.ceil(games/100)+Math.ceil(games*(i===0?24:36)/100)+(i===0?0:4*windows.length));
    return{season:p.season,label:`${p.season}–${String(p.season+1).slice(-2)}`,windows,estimatedFixtures:p.estimatedFixtures,estimatedRequests:requests};
  });
  return{at,quota:bdlQuota(store,config,at),seasons,pendingWindows:pendingCollectionWindows(store,seasons.flatMap(s=>s.windows),at),estimatedTotalRequests:[0,1].map(i=>seasons.reduce((n,s)=>n+s.estimatedRequests[i],0)),
    assumptions:['24–36 returned player rows per fixture; DNP/zero-minute rows can increase this.', 'Completed seasons: 1,230 regular games through a planning upper bound of 1,342 including postseason/play-in/cup; actual coverage must be discovered.', 'Current-season 150–350 fixtures is an unverified planning range for this dated plan.', 'Upper range includes monthly page rounding and empty tail-page overhead; cached/shared fixture coverage can reduce requests.'],
    proposedLimits:{dailyLimit:100,maximumRequestsPerBatch:25,minIntervalSeconds:config.providers.balldontlie.minIntervalSeconds,automaticServices:false},
    capChanged:false,notes:['No request or private configuration change is made by planning.', 'The owner must explicitly review an increase from the existing daily cap before it is changed.']};
}

/** A foreground, finite batch. No retries, daily reset bypass or delivery. */
export async function collectBatch(store:Store,config:Config,windows:CollectionWindow[],maxRequests:number,options:{clock?:()=>string;wait?:(ms:number)=>Promise<unknown>;http?:JsonHTTP;checkConfig?:()=>Config;progress?:(v:unknown)=>void}={}){
  z.number().int().min(1).max(25).parse(maxRequests);
  if(!windows.length||windows.length>30)throw new Error('Provide 1–30 bounded collection windows');
  for(const w of windows){z.iso.date().parse(w.from);z.iso.date().parse(w.to);if((Date.parse(w.to)-Date.parse(w.from))/86400000<0||(Date.parse(w.to)-Date.parse(w.from))/86400000>=31)throw new Error('Each window must be 1–31 days');}
  if(config.deliveryEnabled||config.providers.odds.enabled)throw new Error('Historical collection requires delivery and odds disabled');
  const clock=options.clock??nowISO,wait=options.wait??sleep,at=clock(),quota=bdlQuota(store,config,at);
  if(windows.every(w=>w.to<at.slice(0,10)&&store.get<{complete:boolean}>(windowKey(w))?.complete===true))return{requestsUsed:0,maximumRequests:maxRequests,results:[],complete:true};
  if(maxRequests>quota.remaining)throw new Error(`Requested batch exceeds remaining BDL daily allowance (${quota.remaining}); configuration unchanged`);
  const lease=store.acquire('research',at,maxRequests*(config.providers.balldontlie.minIntervalSeconds+20)+120);
  if(!lease)throw new Error('Another research operation owns the lease');
  const total=()=>Number((store.db.prepare("SELECT count(*) AS n FROM quota WHERE provider='balldontlie'").get() as {n:number}).n);
  const baseline=total(),results:unknown[]=[];
  const provider=new BDLProvider(options.http??new JsonHTTP(store,config),store,config);
  try{
    outer:for(const w of windows){
      // A step may consume zero requests due to permanent fixture/checkpoint reuse.
      for(let steps=0;steps<maxRequests+100;steps++){
        if(total()-baseline>=maxRequests)break outer;
        if(options.checkConfig&&hash(options.checkConfig())!==hash(config))throw new Error('Configuration changed during collection');
        if(!store.leaseValid('research',lease,clock()))throw new Error('Collection lease expired');
        const recent=store.db.prepare("SELECT max(at) AS at FROM quota WHERE provider='balldontlie'").get() as {at:string|null};
        const delay=recent.at?Math.max(0,ms(recent.at)+config.providers.balldontlie.minIntervalSeconds*1000+100-ms(clock())):0;
        if(delay)await wait(delay);
        // Recheck after waiting: approval/configuration can change meanwhile.
        if(options.checkConfig&&hash(options.checkConfig())!==hash(config))throw new Error('Configuration changed during collection');
        if(!store.leaseValid('research',lease,clock()))throw new Error('Collection lease expired');
        const result=await provider.leagueStats(w.season,w.from,w.to,clock());
        const progress={window:w,...result,requestsUsed:total()-baseline};results.push(progress);options.progress?.(progress);
        if(result.exclusions.length)throw new Error('Source exclusions retained in quarantine; inspect before continuing');
        if(result.complete)break;
      }
    }
    return{requestsUsed:total()-baseline,maximumRequests:maxRequests,results,complete:windows.every(w=>store.get<{complete:boolean}>(windowKey(w))?.complete===true)};
  }finally{store.release('research',lease);}
}
