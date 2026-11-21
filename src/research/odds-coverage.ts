import { readFileSync,statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { type Config } from '../core/config';
import { Store } from '../core/store';
import { hash,ms,nowISO } from '../core/domain';
import { JsonHTTP,type Fetcher } from '../providers/http';
import { OddsProvider,marketKeys } from '../providers/odds';

export const sharedOddsGrantSchema=z.object({
  id:z.string().uuid(),ownerApproved:z.literal(true),approvedAt:z.iso.datetime({offset:true}),expiresAt:z.iso.datetime({offset:true}),
  month:z.string().regex(/^\d{4}-\d{2}$/),apiKeyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  maxRequests:z.number().int().min(1).max(4),maxCredits:z.number().int().min(1).max(5),reserve:z.number().int().min(100),
  oldLedgerPath:z.string().min(1),oldConfigPath:z.string().min(1),oldConfigHash:z.string().regex(/^[a-f0-9]{64}$/),oldMonthlyCeiling:z.number().int().nonnegative(),
  scope:z.literal('one-nba-sportsbet-coverage-test'),
}).strict();
export function oddsCoveragePlan(){return{mode:'plan_no_network',league:'NBA',bookmaker:'sportsbet',maximumRequests:4,maximumCredits:5,
  steps:[{endpoint:'/v4/sports',credits:0,purpose:'Fresh authenticated account quota headers'}, {endpoint:'/v4/sports/basketball_nba/events',credits:0,purpose:'Exact upcoming NBA event discovery'},
    {endpoint:'/v4/sports/basketball_nba/events/EXACT_ID/markets',credits:1,purpose:'Sportsbet event market catalogue'}, {endpoint:'/v4/sports/basketball_nba/events/EXACT_ID/odds',credits:4,purpose:'Four supported player-prop families, one bookmaker'}],
  requires:['Owner-approved finite shared grant, bound to the key and existing worker configuration','Read-only old shared ledger with no uncertainty; preserve its unused monthly allocation','Fresh provider remaining-credit headers before paid calls; retain at least 100 account credits plus the old worker unused allowance'],
  activatesWorker:false,enablesPersistentOddsCollection:false,sendsMessages:false};}

export async function testOddsCoverage(store:Store,config:Config,grantPath:string,options:{fetcher?:Fetcher;clock?:()=>string;wait?:(delay:number)=>Promise<unknown>;progress?:(value:unknown)=>void}={}){
  if(config.deliveryEnabled)throw new Error('Controlled odds coverage requires delivery disabled');
  if((statSync(grantPath).mode&0o077)!==0)throw new Error('Shared allowance file must be owner-only');
  const original=readFileSync(grantPath,'utf8'),grant=sharedOddsGrantSchema.parse(JSON.parse(original));
  const clock=options.clock??nowISO,wait=options.wait??sleep,at=clock();
  if(ms(grant.approvedAt)>ms(at)||ms(grant.expiresAt)-ms(grant.approvedAt)>3600000||ms(grant.expiresAt)<=ms(at)||grant.month!==at.slice(0,7))throw new Error('Shared allowance is future, expired, wrong month or exceeds one hour');
  if(!process.env.ODDS_API_KEY||hash(process.env.ODDS_API_KEY)!==grant.apiKeyFingerprint)throw new Error('Shared allowance credential binding mismatch');
  if(grant.maxRequests!==4||grant.maxCredits!==5)throw new Error('Coverage requires the reviewed four-request, five-credit maximum');
  const reviewed:Config={...config,networkEnabled:true,deliveryEnabled:false,leagues:['NBA'],providers:{...config.providers,odds:{...config.providers.odds,enabled:true,dailyLimit:grant.maxRequests,monthlyCredits:grant.maxCredits+grant.reserve,reserve:grant.reserve}}};
  const http=new JsonHTTP(store,reviewed,options.fetcher,clock,(provider,path,credits,now)=>{
    if(provider!=='odds'||!/^\/v4\/sports(?:\/basketball_nba\/events(?:\/[a-zA-Z0-9_-]+\/(?:markets|odds))?)?$/.test(path))throw new Error('Request outside shared allowance scope');
    if(readFileSync(grantPath,'utf8')!==original||grant.month!==now.slice(0,7))throw new Error('Shared allowance changed or month ended');
    const oldConfig=JSON.parse(readFileSync(grant.oldConfigPath,'utf8'));
    if(hash(oldConfig)!==grant.oldConfigHash||oldConfig.monthlyOddsCeiling!==grant.oldMonthlyCeiling)throw new Error('Old worker configuration changed; review shared allocation');
    const ledger=z.object({period:z.string(),reserved:z.number().int().nonnegative(),remaining:z.number().int().nonnegative(),uncertain:z.boolean()}).parse(JSON.parse(readFileSync(grant.oldLedgerPath,'utf8')));
    if(ledger.period!==grant.month||ledger.uncertain||ms(now)-statSync(grant.oldLedgerPath).mtimeMs>86400000)throw new Error('Old shared ledger is stale, uncertain or in another period');
    const outstanding=Math.max(0,grant.oldMonthlyCeiling-ledger.reserved);
    if(credits){
      const header=store.get<{remaining:number;at:string}>('quota:odds');
      if(!header||header.at.slice(0,7)!==grant.month||ms(now)<ms(header.at)||ms(now)-ms(header.at)>300000)throw new Error('Fresh provider quota headers required before paid request');
      if(header.remaining-credits<grant.reserve+outstanding)throw new Error('Shared provider headroom would consume the old worker allocation or reserve');
    }
    return{id:grant.id,binding:hash(grant),expiresAt:grant.expiresAt,maxRequests:grant.maxRequests,maxCredits:grant.maxCredits};
  });
  const receipts:unknown[]=[];
  async function step<T extends {receipt:unknown}>(call:()=>Promise<T>){
    const recent=store.db.prepare("SELECT max(at) AS at FROM quota WHERE provider='odds'").get() as {at:string|null};
    const delay=recent.at?Math.max(0,ms(recent.at)+reviewed.providers.odds.minIntervalSeconds*1000+100-ms(clock())):0;
    if(delay)await wait(delay);
    const result=await call();receipts.push(result.receipt);options.progress?.({at:clock(),completedSteps:receipts.length});return result;
  }
  await step(()=>http.get('odds','/v4/sports',{},0,0,true));
  const header=store.get<{remaining:number;at:string}>('quota:odds');if(!header||header.at!==clock()){
    // Real clocks advance between instructions; require a newly observed header.
    if(!header||ms(header.at)<ms(at))throw new Error('Authenticated quota check returned no fresh remaining-credit headers');
  }
  const provider=new OddsProvider(http),catalogue=await step(()=>provider.events('NBA'));
  const events=z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),sport_key:z.literal('basketball_nba'),commence_time:z.iso.datetime({offset:true}),home_team:z.string(),away_team:z.string()})).parse(catalogue.body);
  const event=events.filter(e=>ms(e.commence_time)>ms(clock())+300000&&ms(e.commence_time)<ms(clock())+48*3600000).sort((a,b)=>ms(a.commence_time)-ms(b.commence_time))[0];
  if(!event)return{state:'no_upcoming_nba_event',at:clock(),receipts,spentMaximumCredits:0,coverage:[]};
  const markets=await step(()=>provider.markets('NBA',event.id));
  const page=await step(()=>provider.event('NBA',event.id,true));
  const response=z.object({id:z.string(),sport_key:z.literal('basketball_nba'),commence_time:z.iso.datetime({offset:true}),home_team:z.string(),away_team:z.string(),bookmakers:z.array(z.object({key:z.string(),markets:z.array(z.object({key:z.string(),last_update:z.iso.datetime({offset:true}).optional(),outcomes:z.array(z.object({name:z.string(),description:z.string().optional(),point:z.number().optional(),price:z.number()}))}))}))}).parse(page.body);
  if(response.id!==event.id||response.commence_time!==event.commence_time||response.home_team!==event.home_team||response.away_team!==event.away_team)throw new Error('Coverage event identity changed between calls');
  const books=response.bookmakers.filter(b=>b.key==='sportsbet');if(books.length>1)throw new Error('Duplicate Sportsbet bookmaker');
  const coverage=Object.entries(marketKeys).map(([prop,key])=>{const offered=books.flatMap(b=>b.markets.filter(m=>m.key===key));const outcomes=offered.flatMap(m=>m.outcomes);return{prop,market:key,markets:offered.length,outcomes:outcomes.length,exactPlayerDescriptions:new Set(outcomes.map(o=>o.description).filter(Boolean)).size,originalMarketTimestamps:offered.map(m=>m.last_update??null),missingExactFields:offered.reduce((n,m)=>n+m.outcomes.filter(o=>!o.description||o.point===undefined||!m.last_update||!['Over','Under'].includes(o.name)).length,0)};});
  return{state:books.length?'sportsbet_observed':'sportsbet_absent',at:clock(),event,coverage,receipts,catalogueReceipt:markets.receipt,
    quota:store.get('quota:odds'),allowance:store.get(`request-allowance:odds:${grant.id}`),identityMappingsVerified:false,settlementTermsVerified:false,normalizedLiveQuotes:0,
    note:'Coverage evidence only; exact provider-player/fixture bridges, fresh availability and settlement terms are still required. No worker or outbound delivery enabled.'};
}
