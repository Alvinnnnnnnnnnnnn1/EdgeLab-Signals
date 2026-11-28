import {Store} from '../core/store';
import {z} from 'zod';
import type {Config} from '../core/config';
import {hash,ms,nowISO,type Receipt,type Terms} from '../core/domain';
import {JsonHTTP,type Fetcher} from '../providers/http';
import {OddsProvider,normalizeOdds,marketKeys} from '../providers/odds';
import {verifyRegistry,type Registry} from '../providers/identity';
import {Telegram} from '../core/telegram';
import {notificationWindow,researchSchedule} from '../research/schedule';
import {MarketBenchmarkAdapter} from '../research/market-benchmarks';
import {generateExperimentalForecasts,upcomingFixtures,rosterProof,fixtureProof,retained,SUGGESTION_POLICY} from './forecasts';
import {protectedSuggestionsHTTP,readSuggestionsGrant} from './allowance';
import {rankAndIssue,dispatchSuggestions,settleSuggestions,scoreExperimentalForecasts} from './engine';

interface AcquisitionState {phase:'quota'|'events'|'catalogue'|'prices'|'refresh'|'complete'|'blocked';oddsId?:string;discovery?:Receipt;catalogue?:Receipt;initialPrices?:Receipt;lastPrices?:Receipt;nextAt:string;coverage?:unknown;error?:string;}
export const conservativePlayerName=(name:string)=>name.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[’‘`]/g,"'").replace(/[.'-]/g,'').replace(/\s+/g,' ').trim();
export function buildSportsbetRegistry(store:Store,raw:{id:string;sport_key:string;commence_time:string;home_team:string;away_team:string;bookmakers:{key:string;markets:{outcomes:{description?:string}[]}[]}[]},eventId:string,discovery:Receipt,at:string,bookmakers:readonly string[]=['sportsbet']):Registry{
  const fixture=upcomingFixtures(store,at).find(f=>f.event.id===eventId);if(!fixture)throw new Error('Exact current NBA fixture missing');fixtureProof(store,fixture.event,fixture.source,at);retained(store,discovery,at);
  const origin=new URL(discovery.endpoint),observed=JSON.parse((store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(discovery.hash) as {body:string}).body);
  if(discovery.provider!=='odds'||origin.origin!=='https://api.the-odds-api.com'||origin.pathname!=='/v4/sports/basketball_nba/events'||!Array.isArray(observed)||observed.filter(e=>e.id===raw.id&&e.sport_key===raw.sport_key&&ms(e.commence_time)===ms(raw.commence_time)&&e.home_team===raw.home_team&&e.away_team===raw.away_team).length!==1)throw new Error('Exact original bookmaker discovery evidence missing');
  const delta=ms(raw.commence_time)-ms(fixture.event.startsAt),samePair=(e:{home_team:string;away_team:string;commence_time:string})=>e.home_team===fixture.event.home&&e.away_team===fixture.event.away&&e.commence_time.slice(0,10)===fixture.event.startsAt.slice(0,10);
  if(raw.sport_key!=='basketball_nba'||delta<0||delta>15*60000||!samePair(raw)||observed.filter(samePair).length!==1||upcomingFixtures(store,at).filter(f=>f.event.homeId===fixture.event.homeId&&f.event.awayId===fixture.event.awayId&&f.event.startsAt.slice(0,10)===fixture.event.startsAt.slice(0,10)).length!==1)throw new Error('Exact bookmaker fixture metadata changed or ambiguous');
  const players=(store.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%'").all() as {value:string}[]).map(r=>JSON.parse(r.value) as {playerId:string;player:string;teamId:string;source:Receipt;observedAt:string}).filter(p=>[fixture.event.homeId,fixture.event.awayId].includes(p.teamId));
  const descriptions=new Set(raw.bookmakers.filter(b=>bookmakers.includes(b.key)).flatMap(b=>b.markets.flatMap(m=>m.outcomes.map(o=>o.description).filter((s):s is string=>!!s))));
  const registry:Registry={events:[{oddsId:raw.id,event:fixture.event,verifiedAt:at,source:discovery,...(delta?{sourceStartsAt:raw.commence_time,clockBridgePolicy:'unique-team-pair-earliest-clock/1' as const,canonicalFixtureSource:fixture.source}:{})}],players:[]};
  for(const description of descriptions){const exact=players.filter(p=>p.player===description),matches=exact.length?exact:players.filter(p=>conservativePlayerName(p.player)===conservativePlayerName(description));if(matches.length!==1)continue;const p=matches[0];try{rosterProof(store,p,at);registry.players.push({eventId,description,playerId:p.playerId,player:p.player,teamId:p.teamId,verifiedAt:at,source:p.source});}catch{/* Exact mapping is unavailable, never guessed. */}}
  return verifyRegistry(registry,store,at);
}
export async function suggestionsCycle(store:Store,config:Config,options:{manual?:boolean;clock?:()=>string;fetcher?:Fetcher;http?:JsonHTTP;transport?:Telegram}={}){
  const clock=options.clock??nowISO,at=clock();if(!config.liveSuggestionsEnabled||config.operatingMode==='disabled')return{state:'disabled',networkRequests:0};
  const lease=store.acquire('experimental-cycle',at,150);if(!lease)return{state:'busy',networkRequests:0};const total=()=>Number((store.db.prepare('SELECT count(*) AS n FROM quota').get() as {n:number}).n),before=total();
  let result:Record<string,unknown>={at,state:'waiting',networkRequests:0};
  try{
    const fixtures=upcomingFixtures(store,at),routine=!!researchSchedule(at).activeWindow;
    const next=fixtures.find(f=>ms(f.event.startsAt)-ms(at)<=24*3600000&&!store.get(`suggestions:forecast-complete:${SUGGESTION_POLICY}:${hash(f.event)}`));
    if(next&&(routine||options.manual||ms(next.event.startsAt)-ms(at)<=90*60000)){
      const forecasts=generateExperimentalForecasts(store,next.event.id,at,clock);store.set(`suggestions:forecast-complete:${SUGGESTION_POLICY}:${hash(next.event)}`,{at:clock(),...forecasts});result={...result,forecasts};
    }
    const dataVersion=store.db.prepare('SELECT max(rowid) AS id FROM logs').get(),forecastVersion=store.db.prepare('SELECT count(*) AS n FROM experimental_forecasts').get(),candidateVersion=store.db.prepare('SELECT count(*) AS n FROM experimental_candidates').get(),version=hash([dataVersion,forecastVersion,candidateVersion]);
    if(store.get('suggestions:scored-version')!==version){result.grading=settleSuggestions(store,clock());scoreExperimentalForecasts(store,clock());store.set('suggestions:scored-version',version);}
    if(!config.suggestionsGrantFile){result.state='market_authorisation_required';return result;}
    const grant=readSuggestionsGrant(config.suggestionsGrantFile,clock()),key=`suggestions:acquisition:${grant.id}`,state=store.get<AcquisitionState>(key)??{phase:'quota' as const,nextAt:at};
    if(state.phase==='complete'||state.phase==='blocked'){result.state=state.phase;result.acquisition=state;return result;}
    if(ms(state.nextAt)>ms(clock())){result.state='cooldown';return result;}
    if(notificationWindow(clock()).quiet){result.state='quiet_hours_prices_deferred';return result;}
    const fixture=fixtures.find(f=>f.event.id===grant.bdlEventId);if(!fixture)throw new Error('Exact finite-grant fixture unavailable');fixtureProof(store,fixture.event,fixture.source,clock());
    const terms=store.get<{terms:Terms[]}>('suggestions:terms')?.terms;if(!terms?.length)throw new Error('Verified Sportsbet settlement terms required before acquisition');for(const t of terms){retained(store,t.source,clock());if(ms(clock())-ms(t.source.retrievedAt)>30*86400000)throw new Error('Sportsbet settlement evidence stale');}
    if(!routine&&!options.manual&&ms(fixture.event.startsAt)-ms(clock())>90*60000){result.state='outside_research_window';return result;}
    const recent=store.db.prepare("SELECT max(at) AS at FROM quota WHERE provider='odds'").get() as {at:string|null};if(recent.at&&ms(clock())-ms(recent.at)<config.providers.odds.minIntervalSeconds*1000){result.state='cooldown';return result;}
    const http=options.http??protectedSuggestionsHTTP(store,config,config.suggestionsGrantFile,clock,options.fetcher).http,provider=new OddsProvider(http);
    if(state.phase==='quota'){await http.get('odds','/v4/sports',{},0,0,true);const headers=store.get<{at:string}>('quota:odds');if(!headers||ms(headers.at)<ms(at))throw new Error('Fresh account quota headers unavailable');state.phase=state.oddsId&&state.discovery?'prices':'events';}
    else if(state.phase==='events'){
      const page=await provider.events('NBA');if(!Array.isArray(page.body))throw new Error('NBA event schema invalid');const matches=page.body.filter(e=>e.sport_key==='basketball_nba'&&ms(e.commence_time)>=ms(fixture.event.startsAt)&&ms(e.commence_time)-ms(fixture.event.startsAt)<=15*60000&&e.commence_time.slice(0,10)===fixture.event.startsAt.slice(0,10)&&e.home_team===fixture.event.home&&e.away_team===fixture.event.away);
      if(matches.length!==1||!/^[a-zA-Z0-9_-]+$/.test(matches[0].id))throw new Error('Exact NBA event bridge missing or ambiguous');state.oddsId=matches[0].id;state.discovery=page.receipt;state.phase='catalogue';
    }else if(state.phase==='catalogue'){
      const page=await provider.markets('NBA',state.oddsId!),metadata=z.object({id:z.string(),sport_key:z.string(),commence_time:z.iso.datetime({offset:true}),home_team:z.string(),away_team:z.string()}).parse(page.body);const registry=buildSportsbetRegistry(store,{...metadata,bookmakers:[]},grant.bdlEventId,state.discovery!,clock());
      const coverage=new MarketBenchmarkAdapter('sportsbet').discover(page.body,page.receipt,registry,true);state.coverage=coverage;state.catalogue=page.receipt;
      if(!coverage.markets.some(m=>m.state==='recently_seen'))throw new Error('No requested Sportsbet player-prop markets observed');state.phase='prices';
    }else if(state.phase==='prices'){
      const page=await provider.event('NBA',state.oddsId!,true);const registry=buildSportsbetRegistry(store,page.body as Parameters<typeof buildSportsbetRegistry>[1],grant.bdlEventId,state.discovery!,clock()),normalized=normalizeOdds(page.body,page.receipt,registry,terms,'sportsbet',true);
      // The price response itself is also genuine event-specific market discovery;
      // this supports a resumed cycle without spending another catalogue request.
      state.coverage=new MarketBenchmarkAdapter('sportsbet').discover(page.body,page.receipt,registry,true);
      if(!normalized.quotes.length)throw new Error('No genuine exact Sportsbet player-prop prices');state.initialPrices=page.receipt;state.phase='refresh';store.set('suggestions:initial-coverage',{at:clock(),quotes:normalized.quotes.length,exclusions:normalized.exclusions,source:page.receipt});
    }else if(state.phase==='refresh'){
      const page=await provider.event('NBA',state.oddsId!,true),registry=buildSportsbetRegistry(store,page.body as Parameters<typeof buildSportsbetRegistry>[1],grant.bdlEventId,state.discovery!,clock()),normalized=normalizeOdds(page.body,page.receipt,registry,terms,'sportsbet',true);
      store.set('suggestions:last-market',{at:clock(),source:page.receipt,quotes:normalized.quotes.length,exclusions:normalized.exclusions,bookmaker:'sportsbet'});state.lastPrices=page.receipt;
      result.selection=rankAndIssue(store,config,normalized.quotes,terms,clock(),clock);state.phase='complete';
    }
    state.nextAt=new Date(ms(clock())+config.providers.odds.minIntervalSeconds*1000).toISOString();store.set(key,state);result.state=state.phase;result.acquisition=state;
  }catch(e){const text=e instanceof Error?e.message:'Experimental cycle failed',safe=/^(Exact |Fresh |Finite |Allowance |SportsModel |Verified |Sportsbet |NBA |No |Four |Fewer |Forecast |Player |Current |History |Request |Shared )/.test(text)?text:'SOURCE_SCHEMA_OR_TRANSPORT_ERROR';result.state='blocked';result.error=safe;
    if(config.suggestionsGrantFile){try{const g=readSuggestionsGrant(config.suggestionsGrantFile,clock()),key=`suggestions:acquisition:${g.id}`,state=store.get<AcquisitionState>(key);if(state&&total()>before)store.set(key,{...state,phase:'blocked',error:safe});}catch{/* Expired/invalid grants cannot acquire. */}}
  }finally{
    result.networkRequests=total()-before;result.at=clock();
    try{result.delivery=await dispatchSuggestions(store,config,options.transport??new Telegram(config,store,options.fetcher,clock),clock);}catch{result.delivery={state:'dispatch_failed',accepted:0};}finally{store.set('suggestions:last-run',result);store.release('experimental-cycle',lease);}
  }
  return result;
}
