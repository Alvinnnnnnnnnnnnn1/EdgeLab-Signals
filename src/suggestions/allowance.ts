import {readFileSync,statSync} from 'node:fs';
import {z} from 'zod';
import {hash,ms,type Event} from '../core/domain';
import type {Config} from '../core/config';
import {Store} from '../core/store';
import {JsonHTTP,type Fetcher} from '../providers/http';
import {sharedOddsGrantSchema} from '../research/odds-coverage';

export const suggestionsGrantSchema=sharedOddsGrantSchema.extend({scope:z.literal('one-nba-experimental-suggestions-cycle'),maxRequests:z.number().int().min(1).max(5),maxCredits:z.number().int().min(1).max(9),bdlEventId:z.string().regex(/^bdl:nba:game:[1-9]\d*$/)}).strict();
export type SuggestionsGrant=z.infer<typeof suggestionsGrantSchema>;
export function readSuggestionsGrant(path:string,at:string){
  if((statSync(path).mode&0o077)!==0)throw new Error('Owner-only finite allowance file required');const grant=suggestionsGrantSchema.parse(JSON.parse(readFileSync(path,'utf8')));
  if(ms(grant.approvedAt)>ms(at)||ms(grant.expiresAt)<=ms(at)||ms(grant.expiresAt)-ms(grant.approvedAt)>3600000||grant.month!==at.slice(0,7))throw new Error('Finite allowance is future, expired or wrong month');
  if(!process.env.ODDS_API_KEY||hash(process.env.ODDS_API_KEY)!==grant.apiKeyFingerprint)throw new Error('Allowance key binding changed');
  const old=JSON.parse(readFileSync(grant.oldConfigPath,'utf8'));if(hash(old)!==grant.oldConfigHash||old.monthlyOddsCeiling!==grant.oldMonthlyCeiling)throw new Error('SportsModel allocation configuration changed');
  const ledger=z.object({period:z.string(),reserved:z.number().int().nonnegative(),uncertain:z.boolean()}).parse(JSON.parse(readFileSync(grant.oldLedgerPath,'utf8')));
  if(ledger.period!==grant.month||ledger.uncertain||ms(at)-statSync(grant.oldLedgerPath).mtimeMs>86400000)throw new Error('SportsModel allocation evidence stale or uncertain; no paid acquisition');
  return grant;
}
export function suggestionsAcquisitionPlan(event:Event|null){return{state:'approval_required',event,maximumRequests:5,maximumCredits:9,durationMinutes:60,
  steps:[{kind:'account-quota',maximumCredits:0},{kind:'nba-event-discovery',maximumCredits:0},{kind:'sportsbet-event-markets',maximumCredits:1},{kind:'four-prop-prices',maximumCredits:4},{kind:'pre-issue-price-refresh',maximumCredits:4}],
  protectedAccountFloor:'100 reserve + entire SportsModel monthly ceiling (60 last inspected)',recurringPaidAcquisition:false,qualifiedAlerts:false,
  note:'One exact NBA fixture. Stops on missing identity/terms, absent markets, expiry, stale allocation evidence or exhausted grant. This protected finite allocation is not an account-wide coordinator.'};}
export function protectedSuggestionsHTTP(store:Store,config:Config,path:string,clock:()=>string,fetcher?:Fetcher){
  const original=readFileSync(path,'utf8'),grant=readSuggestionsGrant(path,clock());
  const monthUsed=store.db.prepare("SELECT count(*) AS requests,COALESCE(sum(credits),0) AS credits FROM quota WHERE provider='odds' AND at LIKE ?").get(`${grant.month}%`) as {requests:number;credits:number};
  const scoped:Config={...config,providers:{...config.providers,odds:{...config.providers.odds,enabled:true,dailyLimit:monthUsed.requests+grant.maxRequests,monthlyCredits:monthUsed.credits+grant.maxCredits+grant.reserve,reserve:grant.reserve}}};
  return{grant,http:new JsonHTTP(store,scoped,fetcher,clock,(provider,endpoint,credits,at)=>{
    if(provider!=='odds'||readFileSync(path,'utf8')!==original)throw new Error('Finite allowance changed');readSuggestionsGrant(path,at);
    const state=store.get<{oddsId?:string}>(`suggestions:acquisition:${grant.id}`);
    const allowed=endpoint==='/v4/sports'&&credits===0||endpoint==='/v4/sports/basketball_nba/events'&&credits===0||!!state?.oddsId&&endpoint===`/v4/sports/basketball_nba/events/${state.oddsId}/markets`&&credits===1||!!state?.oddsId&&endpoint===`/v4/sports/basketball_nba/events/${state.oddsId}/odds`&&credits===4;
    if(!allowed)throw new Error('Request outside exact finite NBA scope');
    if(credits){const header=store.get<{remaining:number;at:string}>('quota:odds');if(!header||ms(header.at)>ms(at)||ms(at)-ms(header.at)>300000||header.at.slice(0,7)!==grant.month||header.remaining-credits<grant.reserve+grant.oldMonthlyCeiling)throw new Error('Fresh account headroom cannot protect the full SportsModel allocation and reserve');}
    return{id:grant.id,binding:hash(grant),expiresAt:grant.expiresAt,maxRequests:grant.maxRequests,maxCredits:grant.maxCredits};
  })};
}
