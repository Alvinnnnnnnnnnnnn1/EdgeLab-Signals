import {readFileSync,statSync} from 'node:fs';
import {z} from 'zod';
import {hash,ms,type Receipt} from '../core/domain';
import {Store,type RequestAllowance} from '../core/store';
import type {Config} from '../core/config';
import {JsonHTTP,type Fetcher} from '../providers/http';

export const recurringPolicySchema=z.object({
  version:z.literal('sportsbet-recurring/1.4.3'),id:z.string().uuid(),ownerApproved:z.literal(true),approvedAt:z.iso.datetime({offset:true}),expiresAt:z.iso.datetime({offset:true}),
  approvalReference:z.string().min(8),apiKeyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),planCredits:z.number().int().min(164),signalsMonthlyCredits:z.number().int().positive(),
  v6Credits:z.literal(60),reserve:z.literal(100),dailyRequests:z.number().int().min(4).max(100),monthlyRequests:z.number().int().min(20).max(3000),
  accountMaxAgeSeconds:z.number().int().min(30).max(300),oldConfigPath:z.string(),oldConfigHash:z.string().regex(/^[a-f0-9]{64}$/),oldLedgerPath:z.string(),
  renewal:z.literal('calendar-month-with-fresh-evidence'),bookmaker:z.literal('sportsbet'),league:z.literal('NBA'),
}).strict().refine(p=>p.signalsMonthlyCredits===p.planCredits-p.v6Credits-p.reserve,'The full protected allocations must remain outside the Signals envelope');
export type RecurringPolicy=z.infer<typeof recurringPolicySchema>;
export const nextMonth=(at:string)=>new Date(Date.UTC(Number(at.slice(0,4)),Number(at.slice(5,7)),1)).toISOString();
export function readRecurringPolicy(path:string,at:string){
  if((statSync(path).mode&0o077)!==0)throw new Error('RECURRING_POLICY_NOT_PRIVATE');const p=recurringPolicySchema.parse(JSON.parse(readFileSync(path,'utf8')));
  if(ms(p.approvedAt)>ms(at)||ms(p.expiresAt)<=ms(at)||ms(p.expiresAt)-ms(p.approvedAt)>90*86400000)throw new Error('RECURRING_POLICY_EXPIRED_OR_INVALID');
  if(!process.env.ODDS_API_KEY||hash(process.env.ODDS_API_KEY)!==p.apiKeyFingerprint)throw new Error('RECURRING_CREDENTIAL_BINDING_CHANGED');
  const old=JSON.parse(readFileSync(p.oldConfigPath,'utf8'));if(hash(old)!==p.oldConfigHash||old.monthlyOddsCeiling!==p.v6Credits)throw new Error('V6_ALLOCATION_CHANGED');
  return p;
}
export function externalAllocation(p:RecurringPolicy,at:string){
  const ledger=z.object({period:z.string().regex(/^\d{4}-\d{2}$/),reserved:z.number().int().min(0).max(60),uncertain:z.boolean()}).parse(JSON.parse(readFileSync(p.oldLedgerPath,'utf8')));
  if(ledger.uncertain)throw new Error('V6_ALLOCATION_UNCERTAIN');
  // An idle ledger need not change its mtime. Fresh provider headers must
  // reconcile exactly to the current period's consumer reservations instead.
  return{reserved:ledger.period===at.slice(0,7)?ledger.reserved:0,period:ledger.period,fullProtectedCredits:p.v6Credits};
}
type Observation={policyId:string;month:string;reserved:number;charged:number;used:number;remaining:number;at:string;endpoint:string;receiptHash:string|null;status:number};
export function accounting(store:Store,at:string,ignoreQuotaId?:string){
  const rows=store.db.prepare("SELECT q.id,q.at,q.credits,q.outcome,o.body FROM quota q LEFT JOIN odds_account_observations o ON o.quota_id=q.id WHERE q.provider='odds' AND q.at LIKE ?").all(`${at.slice(0,7)}%`) as {id:string;at:string;credits:number;outcome:string;body:string|null}[];
  let charged=0,offset=0;const unknown:string[]=[];
  for(const r of rows){if(r.id===ignoreQuotaId)continue;const o=r.body?JSON.parse(r.body) as Observation:null;if(o){charged+=o.charged;offset+=r.credits-o.charged;}else if(r.outcome==='success')charged+=r.credits;else if(r.credits>0)unknown.push(r.id);}
  return{charged,offset,unknown,rows};
}
export function reviewedAccount(store:Store,p:RecurringPolicy,at:string){
  const header=store.get<{remaining:number;used:string|number;at:string}>('quota:odds'),own=accounting(store,at),external=externalAllocation(p,at);
  if(store.get('recurring:uncertain-debit')||own.unknown.length)throw new Error('UNCERTAIN_ACCOUNT_DEBIT');
  if(!header||header.at.slice(0,7)!==at.slice(0,7)||ms(header.at)>ms(at)||ms(at)-ms(header.at)>p.accountMaxAgeSeconds*1000)throw new Error('ACCOUNT_EVIDENCE_STALE');
  const used=Number(header.used);if(!Number.isInteger(used)||used<0||!Number.isInteger(header.remaining)||used+header.remaining!==p.planCredits)throw new Error('ACCOUNT_PLAN_OR_HEADERS_CHANGED');
  if(used!==own.charged+external.reserved)throw new Error('UNATTRIBUTED_SHARED_ACCOUNT_USAGE');
  return{...own,used,remaining:header.remaining,externalReserved:external.reserved,protectedCredits:p.v6Credits+p.reserve,
    spendable:Math.max(0,Math.min(header.remaining-p.v6Credits-p.reserve,p.signalsMonthlyCredits-own.charged))};
}
export function recurringBudget(store:Store,p:RecurringPolicy,at:string){
  const account=reviewedAccount(store,p,at),day=at.slice(0,10),key=`recurring:day:${p.id}:${day}`;
  let window=store.get<{baseCredits:number;baseRequests:number;credits:number;requests:number;month:string}>(key);
  if(!window){const totals=store.db.prepare("SELECT count(*) AS n,coalesce(sum(credits),0) AS credits FROM quota WHERE provider='odds' AND at LIKE ?").get(`${day}%`) as {n:number;credits:number};
    const days=Math.ceil((ms(nextMonth(at))-ms(`${day}T00:00:00Z`))/86400000);
    window={baseCredits:totals.credits,baseRequests:totals.n,credits:Math.ceil(account.spendable/days),requests:p.dailyRequests,month:at.slice(0,7)};store.set(key,window);
  }
  const today=account.rows.filter(r=>r.at.startsWith(day)),raw=today.reduce((n,r)=>n+r.credits,0),offset=today.reduce((n,r)=>{const o=r.body?JSON.parse(r.body) as Observation:null;return n+(o?r.credits-o.charged:0);},0);
  const newSpend=Math.max(0,raw-window.baseCredits-offset),remaining=Math.max(0,Math.min(window.credits-newSpend,account.spendable));
  return{utcDay:day,utcMonth:at.slice(0,7),accountRemaining:account.remaining,protectedCredits:account.protectedCredits,monthlySignalsCeiling:p.signalsMonthlyCredits,monthlySignalsCharged:account.charged,spendable:account.spendable,
    dailyAllocated:window.credits,dailySpent:newSpend,dailyRemaining:remaining,fullMarketSnapshotsRemaining:Math.floor(remaining/4),
    dailyCreditLimit:window.baseCredits+window.credits+offset,dailyRequestLimit:window.baseRequests+window.requests,offset:account.offset};
}
export function recurringPlan(store:Store,p:RecurringPolicy,at:string){const b=recurringBudget(store,p,at),days=Math.ceil((ms(nextMonth(at))-ms(`${at.slice(0,10)}T00:00:00Z`))/86400000);return{at,authorised:p.ownerApproved,renewal:p.renewal,expiresAt:p.expiresAt,...b,remainingDays:days,
  maximumFullMarketSnapshotsThisPeriod:Math.floor(b.spendable/4),approximateFullMarketSnapshotsPerDay:b.spendable/4/days,
  primary:'T-20 for breadth',secondary:'T-90 when primary coverage has budget',discovery:'Cached zero-credit NBA events; actual price responses discover offered markets',recommendationLimit:null};}

export function recurringHTTP(store:Store,config:Config,policyPath:string,clock:()=>string,options:{fetcher?:Fetcher;oddsId?:string}={}){
  const p=readRecurringPolicy(policyPath,clock()),original=readFileSync(policyPath,'utf8');let captured:{used:number;remaining:number;charged:number;status:number}|null=null;
  const fetcher:Fetcher=async(input,init)=>{const res=await(options.fetcher??fetch)(input,init),used=Number(res.headers.get('x-requests-used')),remaining=Number(res.headers.get('x-requests-remaining')),charged=Number(res.headers.get('x-requests-last'));
    captured=res.headers.has('x-requests-used')&&res.headers.has('x-requests-remaining')&&res.headers.has('x-requests-last')&&[used,remaining,charged].every(n=>Number.isInteger(n)&&n>=0)?{used,remaining,charged,status:res.status}:null;return res;};
  async function get(path:string,query:Record<string,string>,ttl:number,credits:number,fresh=false){
    captured=null;const at=clock(),before=Number((store.db.prepare("SELECT coalesce(max(rowid),0) AS n FROM quota WHERE provider='odds'").get() as {n:number}).n);
    let budget:ReturnType<typeof recurringBudget>|null=null;
    if(credits)budget=recurringBudget(store,p,at);
    const today=Number((store.db.prepare("SELECT count(*) AS n FROM quota WHERE provider='odds' AND at LIKE ?").get(`${at.slice(0,10)}%`) as {n:number}).n);
    const dayWindow=store.get<{baseRequests:number;requests:number}>(`recurring:requests:${p.id}:${at.slice(0,10)}`)??{baseRequests:today,requests:p.dailyRequests};store.set(`recurring:requests:${p.id}:${at.slice(0,10)}`,dayWindow);
    const offset=accounting(store,at).offset,scoped:Config={...config,providers:{...config.providers,odds:{...config.providers.odds,enabled:true,reserve:credits?p.reserve+p.v6Credits:0,monthlyCredits:p.planCredits+offset,dailyLimit:Math.min(dayWindow.baseRequests+dayWindow.requests,budget?.dailyRequestLimit??Infinity)}}};
    const http=new JsonHTTP(store,scoped,fetcher,clock,(provider,endpoint,cost,now):RequestAllowance=>{
      const current=readRecurringPolicy(policyPath,now);if(readFileSync(policyPath,'utf8')!==original||provider!=='odds')throw new Error('RECURRING_POLICY_CHANGED');externalAllocation(current,now);
      const allowed=endpoint==='/v4/sports'&&cost===0||endpoint==='/v4/sports/basketball_nba/events'&&cost===0||!!options.oddsId&&endpoint===`/v4/sports/basketball_nba/events/${options.oddsId}/odds`&&cost===4&&query.bookmakers==='sportsbet'&&query.markets==='player_points,player_rebounds,player_assists,player_threes';
      if(!allowed)throw new Error('RECURRING_REQUEST_OUTSIDE_SCOPE');
      if(cost){const active=store.get<{id:string;binding:string}>('recurring:active-policy');if(!active||active.id!==p.id||active.binding!==hash(p))throw new Error('RECURRING_POLICY_NOT_ACTIVATED');const b=recurringBudget(store,p,now);if(b.dailyRemaining<cost)throw new Error('DAILY_CREDIT_BUDGET_EXHAUSTED');if(b.spendable<cost)throw new Error('PROTECTED_ACCOUNT_BUDGET_EXHAUSTED');if(ms(nextMonth(now))-ms(now)<120000)throw new Error('ACCOUNT_RESET_TRANSITION');}
      const ownOffset=accounting(store,now).rows.reduce((n,r)=>{const o=r.body?JSON.parse(r.body) as Observation:null;return n+(o?.policyId===p.id?r.credits-o.charged:0);},0);
      return{id:`recurring:${p.id}:${now.slice(0,7)}`,binding:hash(p),expiresAt:ms(p.expiresAt)<ms(nextMonth(now))?p.expiresAt:nextMonth(now),maxRequests:p.monthlyRequests,maxCredits:p.signalsMonthlyCredits+ownOffset,...(cost?{dailyCreditLimit:recurringBudget(store,p,now).dailyCreditLimit}:{})};
    });
    let result:{body:unknown;receipt:Receipt;cached:boolean}|undefined,error:unknown;
    try{result=await http.get('odds',path,query,ttl,credits,fresh);}catch(e){error=e;}
    if(result?.cached)return result;
    const rows=store.db.prepare("SELECT id,at,credits,outcome FROM quota WHERE provider='odds' AND rowid>? ORDER BY rowid").all(before) as {id:string;at:string;credits:number;outcome:string}[];
    if(rows.length){const q=rows[0],headers=captured as {used:number;remaining:number;charged:number;status:number}|null;
      if(rows.length!==1||!headers||headers.charged>credits||headers.used+headers.remaining!==p.planCredits||q.at.slice(0,7)!==clock().slice(0,7)){
        if(credits||headers&&headers.charged>credits)store.set('recurring:uncertain-debit',{at:clock(),quotaId:q.id,maximumCredits:credits,reason:'Response accounting missing, concurrent or in reset transition'});
        throw new Error('ACCOUNT_RESPONSE_EVIDENCE_UNCERTAIN');
      }
      const observation:Observation={policyId:p.id,month:q.at.slice(0,7),reserved:credits,charged:headers.charged,used:headers.used,remaining:headers.remaining,at:clock(),endpoint:path,receiptHash:result?.receipt.hash??null,status:headers.status};
      store.db.prepare('INSERT OR IGNORE INTO odds_account_observations VALUES (?,?,?,?)').run(hash([q.id,observation]),q.id,observation.at,JSON.stringify(observation));
      reviewedAccount(store,p,clock());
    }
    if(error)throw error;if(!result)throw new Error('ACCOUNT_REQUEST_FAILED');return result;
  }
  return{policy:p,get};
}
