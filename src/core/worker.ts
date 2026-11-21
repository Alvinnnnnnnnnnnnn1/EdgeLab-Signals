import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { Config } from './config';
import { hash, ms, nowISO, type Decision, type League, type Quote, exactKey } from './domain';
import { Store, type Signal } from './store';
import { JsonHTTP, ProviderError } from '../providers/http';
import { OddsProvider, normalizeOdds } from '../providers/odds';
import { BDLProvider } from '../providers/balldontlie';
import { loadEvidence, loadRegistry, loadValidations, type Evidence, completeness } from '../providers/import';
import { screen } from './screen';
import { settle } from './settlement';
import { BlueBubbles, dispatch, relayBinding } from './messaging';
import type { Registry } from '../providers/identity';
import type { LiveValidation } from '../providers/import';
export function scanWindow(startsAt:string,now:string,windows:number[],bufferSeconds=120):number|null {
  const until=(ms(startsAt)-ms(now))/60000;
  if(until<=bufferSeconds/60)return null;
  return [...windows].sort((a,b)=>a-b).find(w=>until<=w)??null;
}
export function nextScan(registry:Registry,store:Store,config:Config,now:string):string|null {
  const times:number[]=[];
  for(const entry of registry.events){
    if(ms(entry.event.startsAt)<=ms(now)+config.scan.minBeforeStartSeconds*1000)continue;
    const checkpoint=store.get<{window:number;at:string;changeHash:string}>(`scan:${entry.oddsId}`);
    const due=scanWindow(entry.event.startsAt,now,config.scan.windowsMinutes,config.scan.minBeforeStartSeconds);
    if(due!==null&&(!checkpoint||checkpoint.window>due))times.push(ms(now));
    for(const w of config.scan.windowsMinutes)if(!checkpoint||w<checkpoint.window){const t=ms(entry.event.startsAt)-w*60000;if(t>ms(now))times.push(t);}
  }
  return times.length?new Date(Math.min(...times)).toISOString():null;
}
function safeError(e:unknown){return e instanceof ProviderError?e.message:e instanceof Error&&/cooldown|quota|allowance|Free excludes/.test(e.message)?e.message:'Cycle failed; inspect provider state and private input schemas';}
export function getResearchState(config:Config,store:Store,at:string) {
  const evidence=loadEvidence(config.evidenceFile,store,at);
  const registry=loadRegistry(config.mappingFile,store,at)??evidence.registry;
  const validations=loadValidations(config.validationFile,store,at);
  // Verify retained source bodies for every training record before research.
  for(const row of store.logs())if(![row.source,...(row.supportingSources??[])].every(s=>store.hasReceipt(s)))throw new Error('Training input source integrity missing');
  return{evidence,registry,validations};
}
function decide(q:Quote,evidence:Evidence,validations:LiveValidation[],store:Store,config:Config,at:string) {
  const contexts=evidence.contexts.filter(c=>c.eventId===q.event.id&&c.playerId===q.playerId).sort((a,b)=>ms(b.observedAt)-ms(a.observedAt));
  const injury=store.get<{at:string;players:string[]}>('injuries:latest');
  if(contexts[0]&&injury?.players.includes(q.playerId)&&ms(injury.at)>=ms(contexts[0].observedAt))contexts[0]={...contexts[0],status:'unknown'};
  const terms=evidence.terms.filter(t=>t.id===q.termsId);
  const models=validations.filter(v=>v.league===q.event.league&&v.prop===q.prop).sort((a,b)=>ms(b.generatedAt)-ms(a.generatedAt));
  return screen(q,store.logs(),contexts[0]??null,terms.length===1?terms[0]:null,models[0]??null,config,at);
}
const catalogue=z.array(z.object({id:z.string(),sport_key:z.string(),home_team:z.string(),away_team:z.string(),commence_time:z.string()}));
export async function scanOnce(config:Config,store:Store,clock=nowISO,http=new JsonHTTP(store,config)) {
  const start=clock(),lease=store.acquire('research',start,180);if(!lease)return{state:'busy',issued:0};
  let issued=0,screened=0,sourceCalls=0;let successfulAt:string|null=null;const exclusions:{identity:string;reason:string}[]=[];
  const prior=store.get<{at:string}>('worker:heartbeat');
  if(prior&&ms(start)-ms(prior.at)>180000)store.set('worker:gap',{from:prior.at,to:start,seconds:(ms(start)-ms(prior.at))/1000,reason:'No heartbeat: sleep, stopped process, or host outage; continuous operation unverified'});
  store.set('worker:heartbeat',{at:start,state:'running'});
  try{
    let {evidence,registry,validations}=getResearchState(config,store,start);
    const odds=new OddsProvider(http),bdl=new BDLProvider(http,store,config);
    if(config.networkEnabled&&config.providers.odds.enabled){
      // Discovery is cached and documented zero-credit; unknown identities remain excluded.
      for(const league of config.leagues){
        try{
          const page=await odds.events(league);sourceCalls+=Number(!page.cached);
          const events=catalogue.parse(page.body);
          store.set(`catalogue:${league}`,{at:page.receipt.retrievedAt,events,unmapped:events.filter(e=>!registry.events.some(r=>r.oddsId===e.id)).length});
        }catch(e){exclusions.push({identity:league,reason:safeError(e)});}
      }
    }
    if(config.networkEnabled&&config.providers.balldontlie.enabled&&config.providers.balldontlie.tier!=='free'){
      const nativePlayers=[...new Set(registry.players.map(p=>p.playerId.match(/^bdl:nba:player:(\d+)$/)?.[1]).filter((v):v is string=>!!v))];
      if(nativePlayers.length){
        const end=start.slice(0,10),begin=new Date(ms(start)-3*86400000).toISOString().slice(0,10);
        try{await bdl.stats(nativePlayers,begin,end,start);}catch(e){exclusions.push({identity:'NBA stats',reason:safeError(e)});}
        try{
          const injuries=await bdl.injuries(nativePlayers);
          const data=z.object({data:z.array(z.object({player:z.object({id:z.number()}),status:z.string()}))}).parse(injuries.body);
          // Latest authoritative injury observation can veto an older available claim; absence never confirms availability.
          store.set('injuries:latest',{at:injuries.receipt.retrievedAt,players:data.data.map(r=>`bdl:nba:player:${r.player.id}`)});
          const affected=new Set(data.data.map(r=>`bdl:nba:player:${r.player.id}`));
          evidence={...evidence,contexts:evidence.contexts.map(c=>affected.has(c.playerId)&&ms(injuries.receipt.retrievedAt)>=ms(c.observedAt)?{...c,status:'unknown',source:injuries.receipt,observedAt:injuries.receipt.retrievedAt}:c)};
        }catch(e){exclusions.push({identity:'NBA injuries',reason:safeError(e)});}
      }
    }
    const changeHash=hash({contexts:evidence.contexts.map(c=>[c.eventId,c.playerId,c.status,c.source.hash]),registry,terms:evidence.terms,validations});
    for(const entry of registry.events.sort((a,b)=>ms(a.event.startsAt)-ms(b.event.startsAt))){
      const at=clock();if(!store.leaseValid('research',lease,at))throw new Error('Research lease expired');
      if(!config.leagues.includes(entry.event.league))continue;
      const window=scanWindow(entry.event.startsAt,at,config.scan.windowsMinutes,config.scan.minBeforeStartSeconds);
      if(window===null)continue;
      const previous=store.get<{window:number;at:string;changeHash:string}>(`scan:${entry.oddsId}`);
      const changed=previous&&previous.changeHash!==changeHash;
      if(previous&&previous.window<=window&&!changed)continue;
      if(changed&&ms(at)-ms(previous.at)<15*60000)continue;
      try{
        const page=await odds.event(entry.event.league,entry.oddsId);sourceCalls+=Number(!page.cached);
        const normalized=normalizeOdds(page.body,page.receipt,registry,evidence.terms,config.bookmaker);successfulAt=page.receipt.retrievedAt;
        exclusions.push(...normalized.exclusions);
        const decisions=normalized.quotes.map(q=>decide(q,evidence,validations,store,config,clock())).sort((a,b)=>(b.forecast?.robustEV??-99)-(a.forecast?.robustEV??-99));
        for(const d of decisions){
          if(screened>=config.scan.maxQuotesPerCycle)break;screened++;store.recordScreened(d,clock());
          if(!d.qualified){exclusions.push({identity:exactKey(d.quote).slice(0,16),reason:d.reasons.join('; ')});continue;}
          const commit=clock();
          if(!store.leaseValid('research',lease,commit))throw new Error('Research lease expired');
          const finalDecision=decide(d.quote,evidence,validations,store,config,commit);
          if(finalDecision.qualified&&store.issue(finalDecision,commit))issued++;
        }
        store.set(`scan:${entry.oddsId}`,{window,at:clock(),changeHash,marketHash:normalized.marketHash});
      }catch(e){exclusions.push({identity:entry.oddsId,reason:safeError(e)});}
    }
    const grading=settle(store,store.logs(),clock());
    const finished=clock();
    if(successfulAt)store.set('worker:lastSuccess',successfulAt);
    store.set('worker:lastScan',{at:finished,startedAt:start,issued,screened,sourceCalls,exclusions:exclusions.slice(0,300),grading});
    store.set('worker:nextScan',nextScan(registry,store,config,finished));
    store.set('worker:heartbeat',{at:finished,state:config.networkEnabled?'waiting':'network_disabled'});
    if(config.deliveryEnabled){
      const relay=new BlueBubbles(config,store,fetch,clock);
      if(relay.ready(clock()))await dispatch(store,relay,config,async(s:Signal)=>{
        const current=getResearchState(config,store,clock()),q=s.decision.quote;
        const entry=current.registry.events.find(e=>e.event.id===q.event.id);
        if(!entry)return{decision:null,checkedAt:clock()};
        const page=await odds.event(q.event.league,entry.oddsId,true);
        const normalized=normalizeOdds(page.body,page.receipt,current.registry,current.evidence.terms,config.bookmaker);
        const match=normalized.quotes.find(x=>exactKey(x)===exactKey(q));
        return{decision:match?decide(match,current.evidence,current.validations,store,config,clock()):null,checkedAt:clock()};
      },clock);
      else store.set('relay:health',{at:clock(),state:'disabled_or_destination_unverified'});
    }
    return{state:config.networkEnabled?'completed':'network_disabled',issued,screened,sourceCalls,exclusions,grading};
  }catch(e){store.set('worker:heartbeat',{at:clock(),state:'error',reason:safeError(e)});throw e;}
  finally{store.release('research',lease);}
}
export async function runWorker(config:Config,store:Store,signal:AbortSignal) {
  while(!signal.aborted){
    try{await scanOnce(config,store);}catch{store.set('worker:error',{at:nowISO(),reason:'Cycle failed; no synthetic fallback'});}
    await new Promise<void>(resolve=>{const timer=setTimeout(done,60000);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});});
  }
  store.set('worker:heartbeat',{at:nowISO(),state:'stopped'});
}
export function systemStatus(config:Config,store:Store,at:string) {
  const heartbeat=store.get<{at:string;state:string}>('worker:heartbeat');
  const verification=store.get<{binding:string;at:string}>('relay:verification');
  const recipientVerified=!!verification&&verification.binding===relayBinding(config)&&ms(verification.at)<=ms(at)&&ms(at)-ms(verification.at)<30*86400000;
  return{at,networkEnabled:config.networkEnabled,deliveryEnabled:config.deliveryEnabled,
    worker:heartbeat?{...heartbeat,stale:ms(at)-ms(heartbeat.at)>180000}:{state:'not_started',stale:true},
    lastScan:store.get('worker:lastScan'),lastSuccessfulScan:store.get('worker:lastSuccess'),nextScan:store.get('worker:nextScan'),gap:store.get('worker:gap'),
    providers:{balldontlie:{enabled:config.providers.balldontlie.enabled,tier:config.providers.balldontlie.tier,dailyLimit:config.providers.balldontlie.dailyLimit,health:store.get('provider:balldontlie')},odds:{enabled:config.providers.odds.enabled,monthlyCredits:config.providers.odds.monthlyCredits,reserve:config.providers.odds.reserve,dailyLimit:config.providers.odds.dailyLimit,health:store.get('provider:odds'),quota:store.get('quota:odds')}},
    usage:store.usage(),completeness:completeness(store.logs()),relay:{enabled:config.deliveryEnabled,verified:recipientVerified,credentialConfigured:!!process.env.BLUEBUBBLES_PASSWORD,health:store.get('relay:health')},
    constraints:['Host sleep stops local research and the macOS relay.','NBA/NBL current availability and permitted source access are mandatory.','The dashboard cannot run, activate, or send from the worker.']};
}
