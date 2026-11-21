import { Store } from '../core/store';
import { hash, ms, props, type GameLog, type Receipt } from '../core/domain';
import { auditDataset,unknownMetadata } from './dataset';

function summarize(rows:GameLog[]){
  return{playerGames:rows.length,players:new Set(rows.map(r=>r.playerId)).size,fixtures:new Set(rows.map(r=>r.event.id)).size,
    fields:Object.fromEntries(['minutes',...props].map(p=>{const present=rows.filter(r=>(p==='minutes'?r.minutes:r.stats[p as keyof GameLog['stats']])!==null).length;return[p,{present,missing:rows.length-present,fraction:rows.length?present/rows.length:null}];})),
    participation:{positiveMinutes:rows.filter(r=>r.participated===true).length,verifiedDnp:rows.filter(r=>r.participated===false).length,unknown:rows.filter(r=>r.participated===null).length,verifiedRosterOpportunities:rows.filter(r=>r.research?.rosterOpportunityVerified).length},
    firstStart:rows.length?rows.map(r=>r.event.startsAt).sort()[0]:null,lastStart:rows.length?rows.map(r=>r.event.startsAt).sort().at(-1):null};
}
export function coverageReport(store:Store,at:string){
  const all=store.logs().filter(r=>!r.source.simulated&&r.event.league==='NBA'&&ms(r.observedAt)<=ms(at));
  const latest=new Map<string,GameLog>();for(const row of all)latest.set(`${row.event.id}:${row.playerId}`,row);
  const rows=[...latest.values()],receipts=new Map<string,Receipt>();
  for(const r of all)for(const source of [r.source,...(r.supportingSources??[])])receipts.set(hash(source),source);
  const missingReceipts=[...receipts].filter(([,r])=>!store.hasReceipt(r)).map(([id])=>id);
  const fixtureRows=store.db.prepare("SELECT value FROM meta WHERE key LIKE 'bdl:fixture:%'").all() as {value:string}[];
  const fixtures=fixtureRows.map(r=>JSON.parse(r.value) as {body:{id:number;season:number;status:string;home_team:{id:number};visitor_team:{id:number}};receipt:Receipt});
  const grouped=(key:(r:GameLog)=>string)=>[...new Set(rows.map(key))].sort().map(id=>({id,...summarize(rows.filter(r=>key(r)===id))}));
  const byFixture=grouped(r=>r.event.id).map(f=>({...f,teamIds:[...new Set(rows.filter(r=>r.event.id===f.id).map(r=>r.teamId))],rosterCompleteness:'unverified_no_independent_expected_roster'}));
  const finalFixturesWithoutLogs=fixtures.filter(f=>f.body.status==='Final'&&!rows.some(r=>r.event.id===`bdl:nba:game:${f.body.id}`)).map(f=>({id:`bdl:nba:game:${f.body.id}`,season:String(f.body.season)}));
  return{at,league:'NBA',summary:summarize(rows),revisions:all.length,audit:auditDataset(rows.map(log=>({log,metadata:log.research??unknownMetadata()}))),
    bySeason:[...new Set(['2024','2025','2026',...rows.map(r=>r.event.season)])].sort().map(id=>({id,...summarize(rows.filter(r=>r.event.season===id))})),byPlayer:grouped(r=>r.playerId).map(p=>({...p,player:rows.find(r=>r.playerId===p.id)!.player})),byFixture,
    discoveredFixtures:fixtures.length,finalFixturesWithoutLogs,missingExactReceipts:missingReceipts,
    quarantinePages:Number((store.db.prepare("SELECT count(*) AS n FROM meta WHERE key LIKE 'bdl:quarantine:%'").get() as {n:number}).n),
    retrospectiveRows:rows.filter(r=>ms(r.observedAt)>ms(r.event.startsAt)).length,
    historicalPregameAvailability:'not_established_by_historical_outcome_import',unknownsRemainNull:true};
}
