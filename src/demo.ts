import { mkdirSync, writeFileSync } from 'node:fs';
import { hash, type Receipt, type GameLog, type Event, type Context, type Terms, type Quote, type League, type Prop, nowISO, ms } from './core/domain';
import { configSchema, type Config } from './core/config';
import { Store } from './core/store';
import { MODEL_VERSION } from './core/models';
import { evaluate, type Validation } from './core/evaluation';
import { normalizeOdds, marketKeys } from './providers/odds';
import type { Registry } from './providers/identity';
import { importBundle } from './providers/import';
import { screen } from './core/screen';
import { dispatch, message, type NotificationTransport } from './core/messaging';
import { settle, performance } from './core/settlement';
export const DEMO_AT='2026-11-21T06:00:00.000Z';
export function syntheticReceipt(body:string,at=DEMO_AT,provider='synthetic'):Receipt{return{provider,endpoint:'fixture://labelled-synthetic',retrievedAt:at,publishedAt:null,hash:hash(body),simulated:true};}
export function syntheticData(store:Store,at=DEMO_AT,league:League='NBA',prop:Prop='points') {
  const sources:{receipt:Receipt;body:string}[]=[];
  function retain(value:unknown,at:string){const body=JSON.stringify(value),receipt=syntheticReceipt(body,at);sources.push({receipt,body});return receipt;}
  const prefix=`synthetic:${league.toLowerCase()}`,playerId=`${prefix}:player:1`,teamId=`${prefix}:team:home`;
  const line={points:20.5,rebounds:4.5,assists:3.5,threes:1.5}[prop];
  const logs:GameLog[]=[];
  for(let i=0;i<90;i++){
    const start=new Date(ms(at)-(91-i)*86400000).toISOString(),end=new Date(ms(start)+3*3600000).toISOString();
    const event:Event={id:`${prefix}:game:${i}`,league,season:'2026',homeId:teamId,awayId:`${prefix}:team:away`,home:'Test Harbour',away:'Test Ranges',startsAt:start};
    const stats={points:16+(i*7%17),rebounds:4+(i%5),assists:3+(i%4),threes:1+(i%3)};
    const raw={event,playerId,minutes:30+(i%3)-1,stats},source=retain(raw,end);
    logs.push({event,playerId,teamId,player:'Demo Player',completedAt:end,observedAt:end,minutes:raw.minutes,participated:true,stats,final:true,source});
  }
  const event:Event={id:`${prefix}:future`,league,season:'2026',homeId:teamId,awayId:`${prefix}:team:away`,home:'Test Harbour',away:'Test Ranges',startsAt:new Date(ms(at)+3600000).toISOString()};
  const source=retain({label:'Synthetic roster, fixture and terms only'},at);
  const context:Context={eventId:event.id,playerId,teamId,status:'available',expectedMinutes:30,minutesSD:1,observedAt:at,source,rosterVerified:true,opponentRateFactor:null,homeRateFactor:null,roleNote:'Synthetic stable role'};
  const terms:Terms={id:'synthetic-terms-1',bookmaker:'sportsbet',prop,league,includesOvertime:true,integerPush:true,dnpVoid:true,source};
  const registry:Registry={events:[{oddsId:'synthetic-odds-event',event,verifiedAt:at,source}],players:[{eventId:event.id,description:'Demo Player',playerId,player:'Demo Player',teamId,verifiedAt:at,source}]};
  const oddsRaw={id:'synthetic-odds-event',sport_key:league==='NBA'?'basketball_nba':'basketball_nbl',commence_time:event.startsAt,home_team:event.home,away_team:event.away,
    bookmakers:[{key:'sportsbet',title:'Sportsbet (synthetic)',markets:[{key:marketKeys[prop],last_update:at,outcomes:[{name:'Over',description:'Demo Player',point:line,price:2.4},{name:'Under',description:'Demo Player',point:line,price:1.5}]}]}]};
  const oddsSource=retain(oddsRaw,at);
  const bundle={label:'synthetic' as const,licenseReference:'Locally generated synthetic test data. No genuine prices.',exportedAt:at,sources,logs,contexts:[context],terms:[terms],registry};
  importBundle(bundle,store,at,true);
  const normalized=normalizeOdds(oddsRaw,oddsSource,registry,[terms]);
  const validation:Validation={modelVersion:MODEL_VERSION,league,prop,selected:'minutes-bootstrap',generatedAt:at,datasetHash:hash(logs),reportHash:hash('synthetic validation fixture, never eligible live'),samples:400,dates:90,players:10,asOfVerified:false,simulated:true,eligible:true,selectionBrier:.2,baselineBrier:.21,testBrier:.19,baselineTestBrier:.21,testLogLoss:.6,baselineTestLogLoss:.61};
  const config=configSchema.parse({deliveryEnabled:true,screen:{minGames:30,minEV:.06,minRobustEV:.01,maxProbabilityGap:.25},database:':memory:'});
  return{logs,event,context,terms,registry,quote:normalized.quotes[0],otherQuote:normalized.quotes[1],validation,config,bundle};
}
export async function runDemo(path=`.local/demos/${Date.now()}/signals.sqlite`) {
  const store=new Store(path),d=syntheticData(store);
  const decision=screen(d.quote,d.logs,d.context,d.terms,d.validation,d.config,DEMO_AT,true);
  if(!decision.qualified)throw new Error(`Demo did not qualify: ${decision.reasons.join('; ')}`);
  const signal=store.issue(decision,DEMO_AT,true);
  let current=DEMO_AT;
  const fake:NotificationTransport={async send(){return{guid:'simulated-guid',deliveredAt:null};},async status(){return{deliveredAt:new Date(ms(DEMO_AT)+1000).toISOString(),failed:false};}};
  await dispatch(store,fake,d.config,async()=>({decision,checkedAt:current}),()=>current,true);
  current=new Date(ms(DEMO_AT)+2000).toISOString();
  await dispatch(store,fake,d.config,async()=>({decision,checkedAt:current}),()=>current,true);
  const end=new Date(ms(d.event.startsAt)+3*3600000).toISOString();
  const finalBody=JSON.stringify({label:'Synthetic independently ingested final',points:27,event:d.event.id});
  const source=syntheticReceipt(finalBody,end);store.receipt(source,finalBody);
  const final:GameLog={...d.logs[0],event:d.event,completedAt:end,observedAt:end,stats:{points:27,rebounds:8,assists:5,threes:3},source};
  store.ingest([final],end,true);const grading=settle(store,[final],end);
  const report={label:'SIMULATED — no live source calls, actual messages, validated edge or genuine outcomes',at:DEMO_AT,database:path,
    qualified:decision.qualified,probability:decision.forecast!.win,EV:decision.ev,robustEV:decision.forecast!.robustEV,issuedNow:!!signal,duplicateSuppressed:store.issue(decision,DEMO_AT,true)===null,
    delivery:store.outboxes().map(o=>({state:o.state,simulated:true})),grading,performance:performance(store.signals(),store.outcomes()),
    evaluation:evaluate(d.logs,'NBA','points',DEMO_AT,'as-of').validation,message:message(store.signals()[0]),liveCalls:0};
  mkdirSync('.local',{recursive:true,mode:0o700});writeFileSync('.local/demo-bundle.json',JSON.stringify(d.bundle,null,2),{mode:0o600});writeFileSync('.local/demo-report.json',JSON.stringify(report,null,2),{mode:0o600});store.close();return report;
}
