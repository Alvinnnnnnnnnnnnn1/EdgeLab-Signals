import {Store} from '../core/store';
import {hash,ms,quoteSchema,quoteFresh,termsSchema,props,type Quote,type Terms,type Prop} from '../core/domain';
import {normalizeOdds} from '../providers/odds';
import {buildSportsbetRegistry} from '../suggestions/cycle';
import {retained,type ExperimentalForecast} from '../suggestions/forecasts';
import {assessBookmakerOffer,currentPlayerEvidence} from '../suggestions/engine';
import {comparableSides} from '../research/markets';
import {BOOKMAKERS,bookSchema,VERSION,type Bookmaker,type Availability} from './contracts';
import type {Registry} from '../providers/identity';
export interface Offer {quote:Quote;opposite:Quote;forecastId:string;artifactHash:string;modelVersion:string;win:number;push:number;loss:number;breakEven:number;estimatedEV:number;fair:number;assessment:ReturnType<typeof assessBookmakerOffer>;}
export interface Exclusion {bookmaker:string;prop?:Prop;playerId?:string;line?:number;side?:string;state:Availability;reason:string;}
export interface MarketDecision {id:string;at:string;version:typeof VERSION;state:'VERIFIED_OFFERS'|'NO_VERIFIED_OFFER';offers:Offer[];selected:Offer[];alternatives:Record<string,Offer[]>;exclusions:Exclusion[];availability:{bookmaker:Bookmaker;prop:Prop;state:Availability;verifiedQuoteSides:number;enabled:boolean}[];forecastRefs:{id:string;artifactHash:string;modelVersion:string;inputHash:string}[];independentBookmakers:false;}
const reason=(e:unknown)=>e instanceof Error?e.message:'SOURCE_ERROR';
const state=(r:string):Availability=>/stale|clock|timestamp|post.tip|deadline/i.test(r)?'STALE':/identity|mapping|ambiguous|roster|player|fixture/i.test(r)?'IDENTITY_AMBIGUOUS':/source|receipt|retained|endpoint|provider/i.test(r)?'SOURCE_ERROR':'MARKET_MISMATCH';
const key=(q:Quote)=>hash([q.event,q.playerId,q.teamId,q.prop,q.line,q.side]);
const freshness=(o:Offer)=>Math.min(ms(o.quote.quotedAt),ms(o.opposite.quotedAt));
function normalizeBook(raw:any,receipt:Quote['source'],registry:Registry,terms:Terms[],bookmaker:Bookmaker){
 const books=raw.bookmakers.filter((b:any)=>b.key===bookmaker),quotes:Quote[]=[],exclusions:{bookmaker:string;identity:string;reason:string;prop?:Prop}[]=[];
 if(books.length>1)return{quotes,exclusions:props.map(prop=>({bookmaker,prop,identity:String(raw.id),reason:'AMBIGUOUS_BOOKMAKER_IDENTITY'}))};
 if(!books.length)return{quotes,exclusions};const book=books[0];
 if(!Array.isArray(book.markets))return{quotes,exclusions:props.map(prop=>({bookmaker,prop,identity:String(raw.id),reason:'MALFORMED_SOURCE_MARKETS'}))};
 for(const market of book.markets){const prop=props.find(p=>({points:'player_points',rebounds:'player_rebounds',assists:'player_assists',threes:'player_threes'}[p])===market?.key);if(!prop)continue;
  try{const result=normalizeOdds({...raw,bookmakers:[{...book,markets:[market]}]},receipt,registry,terms,bookmaker,true);quotes.push(...result.quotes);exclusions.push(...result.exclusions.map(e=>({...e,bookmaker,prop})));}
  catch{exclusions.push({bookmaker,prop,identity:String(raw.id),reason:'MALFORMED_SOURCE_MARKET'});}
 }return{quotes,exclusions};
}
export function compareOffers(store:Store,quotes:Quote[],terms:Terms[],forecasts:ExperimentalForecast[],at:string,enabled:Record<Bookmaker,Prop[]>=Object.fromEntries(BOOKMAKERS.map(b=>[b,props])) as Record<Bookmaker,Prop[]>,normalizationExclusions:{bookmaker:string;identity:string;reason:string;prop?:Prop}[]=[],comparisonEnabled=true):MarketDecision{
 const parseable=quotes.flatMap(q=>{const p=quoteSchema.safeParse(q);return p.success?[p.data]:[];});
 const exclusions:Exclusion[]=[],valid:Quote[]=[],verified=new Set<string>(),cache=new Map<string,Set<string>>();
 const retain=(s:Quote['source'])=>{const id=hash(s);if(!verified.has(id)){retained(store,s,at);verified.add(id);}};
 for(const raw of quotes){try{
  const q=quoteSchema.parse(raw);bookSchema.parse(q.bookmaker);if(q.event.league!=='NBA')throw Error('NBA_MARKET_REQUIRED');if(!quoteFresh(q,at,180,120))throw Error('STALE_OR_POST_TIP_QUOTE');
  for(const s of[q.source,q.mappingProof.event.source,q.mappingProof.player.source])retain(s);
  const u=new URL(q.source.endpoint);if(q.source.provider!=='odds'||u.origin!=='https://api.the-odds-api.com'||u.pathname!==`/v4/sports/basketball_nba/events/${q.mappingProof.event.oddsId}/odds`)throw Error('EXACT_SOURCE_ENDPOINT_REQUIRED');
  if(ms(q.mappingProof.event.verifiedAt)>ms(at)||ms(q.mappingProof.player.verifiedAt)>ms(at))throw Error('FUTURE_IDENTITY_PROOF');
  const matchingTerms=terms.filter(t=>t.id===q.termsId&&t.bookmaker===q.bookmaker&&t.prop===q.prop&&t.league==='NBA');if(matchingTerms.length!==1)throw Error('EXACT_SETTLEMENT_TERMS_MISSING');termsSchema.parse(matchingTerms[0]);retain(matchingTerms[0].source);if(ms(at)-ms(matchingTerms[0].source.retrievedAt)>30*86400000)throw Error('SETTLEMENT_SOURCE_STALE');
  const names=store.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%'").all().map(r=>JSON.parse(String(r.value))).filter(p=>[q.event.homeId,q.event.awayId].includes(p.teamId)&&p.player===q.mappingProof.player.description);if(names.length!==1||names[0].playerId!==q.playerId||names[0].teamId!==q.teamId)throw Error('AUTHORITATIVE_PLAYER_IDENTITY_AMBIGUOUS');
  const bodyKey=hash([q.source,q.mappingProof.event,q.bookmaker,terms]);if(!cache.has(bodyKey)){const body=JSON.parse(String(store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(q.source.hash)!.body)),players=[...new Map(parseable.filter(p=>BOOKMAKERS.includes(p.bookmaker as Bookmaker)&&hash(p.source)===hash(q.source)&&hash(p.mappingProof.event)===hash(q.mappingProof.event)).map(p=>[hash(p.mappingProof.player),p.mappingProof.player])).values()],registry:Registry={events:[q.mappingProof.event],players},actual=normalizeBook(body,q.source,registry,terms,q.bookmaker as Bookmaker);cache.set(bodyKey,new Set(actual.quotes.map(hash)));}
  if(!cache.get(bodyKey)!.has(hash(q)))throw Error('QUOTE_NOT_IN_EXACT_RETAINED_SOURCE');valid.push(q);
 }catch(e){const r=reason(e);exclusions.push({bookmaker:raw.bookmaker,prop:raw.prop,playerId:raw.playerId,line:raw.line,side:raw.side,state:state(r),reason:r});}}
 const offers:Offer[]=[],verifiedSides=new Map<string,number>();
 for(const q of valid){try{
  const opposite=valid.filter(p=>hash(p.event)===hash(q.event)&&p.playerId===q.playerId&&p.teamId===q.teamId&&p.prop===q.prop&&p.line===q.line&&p.bookmaker===q.bookmaker&&p.termsId===q.termsId&&p.side!==q.side),same=valid.filter(p=>p.bookmaker===q.bookmaker&&key(p)===key(q));if(opposite.length!==1||same.length!==1)throw Error('MISSING_OR_AMBIGUOUS_MARKET_SIDE');const pair=opposite[0];if(Math.abs(ms(q.retrievedAt)-ms(pair.retrievedAt))>30000)throw Error('PAIR_RETRIEVAL_TIMESTAMP_MISMATCH');
  const fair=q.side==='over'?comparableSides(q,pair).over:comparableSides(pair,q).under;verifiedSides.set(`${q.bookmaker}:${q.prop}`,(verifiedSides.get(`${q.bookmaker}:${q.prop}`)??0)+1);
  if(!comparisonEnabled)continue;
  if(!enabled[q.bookmaker as Bookmaker].includes(q.prop))throw Error('BOOKMAKER_MARKET_DISABLED');
  const matches=forecasts.filter(f=>hash(f.event)===hash(q.event)&&f.playerId===q.playerId&&f.prop===q.prop&&f.teamId===q.teamId);if(matches.length!==1)throw Error('EXACT_FROZEN_FORECAST_MISSING_OR_AMBIGUOUS');const f=matches[0],t=terms.find(t=>t.id===q.termsId)!;currentPlayerEvidence(store,f,at);const assessment=assessBookmakerOffer(q,pair,f,t,at);
  offers.push({quote:q,opposite:pair,forecastId:f.id,artifactHash:f.artifactHash,modelVersion:f.modelVersion??(f.inputs.artifact as any)?.modelVersion??'unknown',win:assessment.win,push:assessment.push,loss:Math.max(0,1-assessment.win-assessment.push),breakEven:1/q.decimalOdds,estimatedEV:assessment.estimatedEV,fair,assessment});
 }catch(e){const r=reason(e);exclusions.push({bookmaker:q.bookmaker,prop:q.prop,playerId:q.playerId,line:q.line,side:q.side,state:state(r),reason:r});}}
 const groups=new Map<string,Offer[]>();for(const o of offers){const k=key(o.quote);groups.set(k,[...(groups.get(k)??[]),o]);}const selected:Offer[]=[],alternatives:Record<string,Offer[]>={};
 for(const rows of groups.values()){
  const anchor=rows.slice().sort((a,b)=>freshness(b)-freshness(a)||ms(b.quote.retrievedAt)-ms(a.quote.retrievedAt)||a.quote.bookmaker.localeCompare(b.quote.bookmaker))[0];
  const coherent=rows.filter(o=>{if(Math.abs(ms(o.quote.quotedAt)-ms(anchor.quote.quotedAt))>30000||Math.abs(ms(o.opposite.quotedAt)-ms(anchor.opposite.quotedAt))>30000||Math.abs(ms(o.quote.retrievedAt)-ms(anchor.quote.retrievedAt))>30000||Math.abs(ms(o.opposite.retrievedAt)-ms(anchor.opposite.retrievedAt))>30000){exclusions.push({bookmaker:o.quote.bookmaker,prop:o.quote.prop,playerId:o.quote.playerId,line:o.quote.line,side:o.quote.side,state:'STALE',reason:'CROSS_BOOK_SNAPSHOT_EXCEEDS_30_SECONDS'});return false;}return true;});
  coherent.sort((a,b)=>b.quote.decimalOdds-a.quote.decimalOdds||freshness(b)-freshness(a)||ms(b.quote.retrievedAt)-ms(a.quote.retrievedAt)||a.quote.bookmaker.localeCompare(b.quote.bookmaker)||hash(a.quote).localeCompare(hash(b.quote)));selected.push(coherent[0]);alternatives[hash(coherent[0].quote)]=coherent.slice(1);
 }
 selected.sort((a,b)=>b.assessment.score-a.assessment.score||hash(a.quote).localeCompare(hash(b.quote)));
 for(const e of normalizationExclusions)if(e.prop)exclusions.push({bookmaker:e.bookmaker,prop:e.prop,state:state(e.reason),reason:e.reason});
 const availability=BOOKMAKERS.flatMap(bookmaker=>props.map(prop=>{const n=verifiedSides.get(`${bookmaker}:${prop}`)??0,issues=exclusions.filter(e=>e.bookmaker===bookmaker&&e.prop===prop);return{bookmaker,prop,state:n?'AVAILABLE_VERIFIED' as const:issues[0]?.state??'NOT_OBSERVED' as const,verifiedQuoteSides:n,enabled:enabled[bookmaker].includes(prop)};}));
 const body={at,version:VERSION as typeof VERSION,state:selected.length?'VERIFIED_OFFERS' as const:'NO_VERIFIED_OFFER' as const,offers,selected,alternatives,exclusions,availability,forecastRefs:forecasts.map(f=>({id:f.id,artifactHash:f.artifactHash,modelVersion:f.modelVersion??(f.inputs.artifact as any)?.modelVersion??'unknown',inputHash:f.inputHash})),independentBookmakers:false as const};return{...body,id:hash(body)};
}
export function normalizeFourBooks(store:Store,raw:unknown,receipt:Quote['source'],eventId:string,discovery:Quote['source'],terms:Terms[],at:string){
 const body=raw as Parameters<typeof buildSportsbetRegistry>[1];if(!body||!Array.isArray(body.bookmakers)||body.bookmakers.some(b=>!BOOKMAKERS.includes(b.key as Bookmaker)))throw Error('UNEXPECTED_OR_MALFORMED_BOOKMAKER_RESPONSE');
 const descriptions={...body,bookmakers:body.bookmakers.map(b=>({...b,markets:Array.isArray(b.markets)?b.markets.map(m=>({...m,outcomes:Array.isArray(m?.outcomes)?m.outcomes.filter(o=>o&&typeof o.description==='string'):[]})):[]}))};
 const registry=buildSportsbetRegistry(store,descriptions,eventId,discovery,at,BOOKMAKERS),normalized=BOOKMAKERS.map(bookmaker=>normalizeBook(body,receipt,registry,terms,bookmaker));return{registry,quotes:normalized.flatMap(r=>r.quotes),exclusions:normalized.flatMap(r=>r.exclusions)};
}
