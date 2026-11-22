import { z } from 'zod';
import { assertReceipt,hash,ms,quoteFresh,quoteSchema,termsSchema,stamp,type Quote,type Receipt,type Terms } from '../core/domain';
import { normalizeOdds,marketKeys } from '../providers/odds';
import { exactEvent,type Registry } from '../providers/identity';
import { comparableSides } from './markets';
import { Store } from '../core/store';
import { loadEvidence } from '../providers/import';
import type { Config } from '../core/config';

export const researchBooks=['sportsbet','tab','ladbrokes_au'] as const;
export type ResearchBook=typeof researchBooks[number];
const bookSchema=z.enum(researchBooks);
const catalogueSchema=z.object({id:z.string(),sport_key:z.literal('basketball_nba'),commence_time:stamp,home_team:z.string(),away_team:z.string(),bookmakers:z.array(z.object({key:z.string(),markets:z.array(z.object({key:z.string(),last_update:stamp.optional()}))}))});

// Request specifications only: intentionally no HTTP transport or activation method.
export class MarketBenchmarkAdapter {
  readonly bookmaker:ResearchBook;
  constructor(bookmaker:ResearchBook){this.bookmaker=bookSchema.parse(bookmaker);}
  plan(oddsEventId:string){
    if(!oddsEventId||!/^[a-zA-Z0-9_-]+$/.test(oddsEventId))throw new Error('Exact provider event ID required');
    const root=`/v4/sports/basketball_nba/events/${oddsEventId}`;
    return {bookmaker:this.bookmaker,role:this.bookmaker==='sportsbet'?'primary':'optional_benchmark',state:'prepared_unverified',executable:false,
      discovery:{path:`${root}/markets`,query:{bookmakers:this.bookmaker,dateFormat:'iso'},maximumCredits:1},
      prices:{path:`${root}/odds`,query:{bookmakers:this.bookmaker,markets:Object.values(marketKeys).join(','),oddsFormat:'decimal',dateFormat:'iso'},maximumCredits:4},
      requires:['new owner-approved finite shared allowance','account-level quota coordination with SportsModel V6','event-specific market discovery','exact identities and independently verified bookmaker terms']};
  }
  discover(raw:unknown,receipt:Receipt,registry:Registry,allowClockBridge=false){
    const input=catalogueSchema.parse(raw),event=exactEvent(registry,input,allowClockBridge),books=input.bookmakers.filter(b=>b.key===this.bookmaker);
    if(books.length>1)throw new Error('Duplicate bookmaker catalogue');
    return {eventId:event.id,bookmaker:this.bookmaker,observedAt:receipt.retrievedAt,source:receipt,
      markets:Object.entries(marketKeys).map(([prop,key])=>{const found=books[0]?.markets.filter(m=>m.key===key)??[];
        return {prop,key,state:found.length===1?'recently_seen':found.length>1?'ambiguous':'not_observed',originalTimestamp:found.length===1?found[0].last_update??null:null};}),
      limitation:'Recently seen keys are event-specific evidence, not proof of executable prices or universal coverage.'};
  }
  normalize(raw:unknown,receipt:Receipt,registry:Registry,terms:Terms[]){return normalizeOdds(raw,receipt,registry,terms,this.bookmaker);}
}

function settlement(q:Quote,terms:Terms[],at:string){
  const found=terms.filter(t=>t.id===q.termsId&&t.bookmaker===q.bookmaker&&t.league===q.event.league&&t.prop===q.prop);
  if(found.length!==1)throw new Error('EXACT_SETTLEMENT_TERMS_MISSING');
  const t=termsSchema.parse(found[0]);assertReceipt(t.source,at);
  return hash([t.league,t.prop,t.includesOvertime,t.integerPush,t.dnpVoid]);
}
export function compareBookmakerMarkets(input:Quote[],terms:Terms[],at:string,maxAgeSeconds=180){
  const exclusions:{bookmaker:string;playerId:string;line:number;reason:string}[]=[],groups=new Map<string,Quote[]>();
  for(const raw of input){
    try{const q=quoteSchema.parse(raw);bookSchema.parse(q.bookmaker);if(q.event.league!=='NBA')throw new Error('NBA_ONLY');
      if(!quoteFresh(q,at,maxAgeSeconds,120))throw new Error('STALE_OR_POST_TIP_ODDS');assertReceipt(q.source,at);settlement(q,terms,at);
      const key=hash([q.event,q.playerId,q.teamId,q.prop,q.line]);groups.set(key,[...(groups.get(key)??[]),q]);
    }catch(e){exclusions.push({bookmaker:raw.bookmaker,playerId:raw.playerId,line:raw.line,reason:e instanceof Error?e.message:'INVALID_MARKET'});}
  }
  const comparisons=[];
  for(const quotes of groups.values()){
    const first=quotes[0],pairs=[];
    for(const book of researchBooks){
      const over=quotes.filter(q=>q.bookmaker===book&&q.side==='over'),under=quotes.filter(q=>q.bookmaker===book&&q.side==='under');
      if(over.length!==1||under.length!==1){if(over.length||under.length)exclusions.push({bookmaker:book,playerId:first.playerId,line:first.line,reason:'MISSING_OR_AMBIGUOUS_SIDE'});continue;}
      try{const devig=comparableSides(over[0],under[0]);pairs.push({bookmaker:book,over:over[0],under:under[0],devig,terms:settlement(over[0],terms,at)});}catch(e){exclusions.push({bookmaker:book,playerId:first.playerId,line:first.line,reason:e instanceof Error?e.message:'INVALID_PAIR'});}
    }
    const primary=pairs.find(p=>p.bookmaker==='sportsbet');
    if(!primary){for(const p of pairs)exclusions.push({bookmaker:p.bookmaker,playerId:first.playerId,line:first.line,reason:'NO_SPORTSBET_AT_EXACT_LINE'});continue;}
    const benchmarks=pairs.filter(p=>p.bookmaker!=='sportsbet').flatMap(p=>{
      if(p.terms!==primary.terms||Math.max(Math.abs(ms(p.over.quotedAt)-ms(primary.over.quotedAt)),Math.abs(ms(p.under.quotedAt)-ms(primary.under.quotedAt)),Math.abs(ms(p.over.retrievedAt)-ms(primary.over.retrievedAt)),Math.abs(ms(p.under.retrievedAt)-ms(primary.under.retrievedAt)))>30000){exclusions.push({bookmaker:p.bookmaker,playerId:first.playerId,line:first.line,reason:'SETTLEMENT_OR_TIMESTAMP_MISMATCH'});return[];}
      return[{bookmaker:p.bookmaker,over:p.devig.over,under:p.devig.under,overDisagreement:p.devig.over-primary.devig.over,underDisagreement:p.devig.under-primary.devig.under,overPrice:p.over.decimalOdds,underPrice:p.under.decimalOdds,quotedAt:p.over.quotedAt,retrievedAt:p.over.retrievedAt,termsId:p.over.termsId}];
    });
    comparisons.push({eventId:first.event.id,playerId:first.playerId,player:first.player,prop:first.prop,line:first.line,startsAt:first.event.startsAt,
      primary:{bookmaker:'sportsbet',over:primary.devig.over,under:primary.devig.under,quotedAt:primary.over.quotedAt,retrievedAt:primary.over.retrievedAt,termsId:primary.over.termsId},benchmarks,
      missingBooks:researchBooks.filter(b=>b!=='sportsbet'&&!benchmarks.some(p=>p.bookmaker===b)),method:'proportional-two-sided',conditionalOnNoPush:true,independentObservations:false,pooledProbability:null});
  }
  return {at,comparisons,exclusions,primary:'sportsbet',qualifiedEligible:false,limitation:'Bookmaker probabilities can be correlated; disagreements are descriptive and never pooled into independent evidence.'};
}

// Review already-retained source bytes only. This command cannot acquire data or spend credits.
export function reviewMarketReceipt(store:Store,config:Config,receiptId:string,at:string){
  const record=store.db.prepare('SELECT body FROM source_receipts WHERE id=?').get(receiptId) as {body:string}|undefined;
  if(!record)throw new Error('Exact retained source receipt ID required');
  const receipt=JSON.parse(record.body) as Receipt;assertReceipt(receipt,at);
  const url=new URL(receipt.endpoint);
  if(receipt.provider!=='odds'||url.origin!=='https://api.the-odds-api.com'||!/^\/v4\/sports\/basketball_nba\/events\/[^/]+\/(odds|markets)$/.test(url.pathname)||!store.hasReceipt(receipt))throw new Error('Retained genuine NBA event market receipt required');
  const raw=JSON.parse((store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(receipt.hash) as {body:string}).body);
  if(raw.id!==decodeURIComponent(url.pathname.split('/').at(-2)!))throw new Error('Exact endpoint/event ID mismatch');
  const evidence=loadEvidence(config.evidenceFile,store,at);
  for(const t of evidence.terms)if(!store.hasReceipt(t.source))throw new Error('Retained settlement evidence required');
  const coverage=researchBooks.map(book=>new MarketBenchmarkAdapter(book).discover(raw,receipt,evidence.registry));
  const normalized=url.pathname.endsWith('/odds')?researchBooks.map(book=>new MarketBenchmarkAdapter(book).normalize(raw,receipt,evidence.registry,evidence.terms)):[];
  const result={...compareBookmakerMarkets(normalized.flatMap(n=>n.quotes),evidence.terms,at,config.screen.maxQuoteAgeSeconds),coverage,normalizationExclusions:normalized.flatMap(n=>n.exclusions),receiptId,networkRequests:0};
  store.set('markets:last-review',result);return result;
}
