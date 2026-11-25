import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './support/suggestions-fixture';import {policyFixture} from './support/recurring-fixture';
import {recurringCycle} from '../src/suggestions/recurring';
import {suggestions} from '../src/suggestions/engine';import {bdlEvent} from '../src/providers/balldontlie';import {readBetLog} from '../src/suggestions/bet-log';

test('recurring NBA collection discovers, prices and sends at T-20, then covers another fixture with the same authorisation',async()=>{
 const d=fixture(),p=policyFixture(d.store);let used=32,paid=0,calls=0;let events=[{id:d.rawOdds.id,sport_key:d.rawOdds.sport_key,commence_time:d.event.startsAt,home_team:d.event.home,away_team:d.event.away}];
 const fetcher=async(input:string|URL)=>{calls++;const url=new URL(input),price=url.pathname.endsWith('/odds');if(price){used+=4;paid++;}const match=events.find(e=>url.pathname.includes(e.id))??events[0];return Response.json(price?{...d.rawOdds,...match,bookmakers:d.rawOdds.bookmakers.map(b=>({...b,markets:b.markets.map(m=>({...m,last_update:p.clock()}))}))}:url.pathname.endsWith('/events')?events:[],{headers:{'x-requests-used':String(used),'x-requests-remaining':String(500-used),'x-requests-last':price?'4':'0'}});};
 const run=()=>{d.setAt(p.clock());return recurringCycle(d.store,{...d.config,providers:p.config.providers,suggestionsGrantFile:'/TEST-ONLY/expired-hour-grant'},p.path,{clock:p.clock,fetcher,transport:d.transport});};
 try{let result=await run();assert.equal(result.state,'fixture_discovered');assert.equal(result.networkRequests,1);assert.equal(d.store.get<{state:string}>('recurring:last-run')?.state,'fixture_discovered');p.tick();result=await run();assert.equal(result.state,'complete',JSON.stringify(result));assert.equal(paid,1);const first=suggestions(d.store).length;assert.ok(first>0);assert.equal(d.sends(),1);
 // A process can disappear after retaining the paid response but before saving
 // its job transition. Recover that exact receipt without paying or sending twice.
 const job=d.store.db.prepare("SELECT id,body FROM recurring_market_jobs WHERE state='complete'").get() as {id:string;body:string},body=JSON.parse(job.body);delete body.lastPrice;delete body.selection;
 d.store.db.prepare("UPDATE recurring_market_jobs SET state='requesting',body=? WHERE id=?").run(JSON.stringify(body),job.id);const callsBeforeRecovery=calls;p.tick();result=await run();assert.equal(result.state,'complete');assert.equal(calls,callsBeforeRecovery);assert.equal(suggestions(d.store).length,first);assert.equal(paid,1);assert.equal(d.sends(),1);
 const second={...d.rawGame,id:101,datetime:'2026-11-22T07:12:00.000Z',visitor_team:{id:3,full_name:'TEST-ONLY Third'}},event=bdlEvent(second);p.setAt('2026-11-22T06:52:00.000Z');d.setAt(p.clock());const source=d.retain({data:[second],meta:{}},'https://api.balldontlie.io/nba/v1/games');d.store.set('live:fixture:101',{event,source,status:'scheduled'});events.push({id:'SECOND-EXACT-ID',sport_key:'basketball_nba',commence_time:event.startsAt,home_team:event.home,away_team:event.away});
 for(let i=0;i<12;i++){await run();if(Number(paid)===2)break;p.tick();}
 assert.equal(paid,2);assert.ok(suggestions(d.store).length>first);assert.equal(d.sends(),2);assert.equal(p.store.db.prepare('SELECT count(*) AS n FROM experimental_annotations').get()!.n,0);assert.equal(readBetLog(d.store).summary.total,suggestions(d.store).length);assert.ok(calls<15);
 }finally{p.close();}
});
test('market authorisation expiry and stopped collection do not stop authentic-shaped hypothetical grading',async()=>{
 const d=fixture(),p=policyFixture(d.store);try{const {rankAndIssue}=await import('../src/suggestions/engine');rankAndIssue(d.store,d.config,d.quotes,d.terms,d.clock());const count=suggestions(d.store).length,at='2027-02-20T11:00:00.000Z',observedAt='2026-11-22T11:00:00.000Z',stats={points:30,rebounds:20,assists:15,threes:8};const source=d.retain({label:'TEST-ONLY independent final',stats},'https://example.invalid/TEST-ONLY/final',observedAt,'TEST-ONLY');d.store.ingest([{...d.logs[0],event:d.event,stats,source,observedAt,research:{...d.logs[0].research!,threeAttempts:12}}],observedAt);
 const result=await recurringCycle(d.store,d.config,p.path,{clock:()=>at,fetcher:async()=>{throw new Error('No request allowed');},transport:d.transport});assert.equal(result.state,'blocked');assert.equal(result.reason,'RECURRING_POLICY_EXPIRED_OR_INVALID');assert.equal(readBetLog(d.store,at).summary.settled,count);assert.equal(d.sends(),0);
 }finally{p.close();}
});
test('quiet-hour early fixtures retain source tasks but do not pay for opportunities that cannot be delivered',async()=>{const d=fixture('2026-11-22T15:00:00Z'),p=policyFixture(d.store);try{p.setAt('2026-11-22T15:40:00Z');d.setAt(p.clock());const result=await recurringCycle(d.store,d.config,p.path,{clock:p.clock,fetcher:async()=>{throw new Error('Quiet hours must make no requests');},transport:d.transport});assert.equal(result.state,'quiet_hours');assert.equal(d.sends(),0);assert.equal(d.store.db.prepare("SELECT count(*) AS n FROM quota WHERE id!='TEST-ONLY-legacy'").get()!.n,0);}finally{p.close();}});

test('retained price waits only for known missing forecasts inside original quote/stage clocks',async()=>{
 const {retainedPriceWait}=await import('../src/suggestions/recurring');const d=fixture();
 try{const at=d.clock(),deadline=new Date(Date.parse(at)+600000).toISOString(),q={...d.quotes[0],quotedAt:at,expiresAt:new Date(Date.parse(at)+180000).toISOString()};
 assert.equal(retainedPriceWait([q],true,at,deadline),true);assert.equal(retainedPriceWait([q],false,at,deadline),false);
 assert.equal(retainedPriceWait([q],true,new Date(Date.parse(at)+120000).toISOString(),deadline),false);
 assert.equal(retainedPriceWait([q],true,at,new Date(Date.parse(at)+30000).toISOString()),false);
 assert.equal(retainedPriceWait([],true,at,deadline),false);
 }finally{d.close();}
});

test('diagnostic failure keeps exit cause with bounded redacted stderr',async()=>{const {diagnosticFailure}=await import('../src/suggestions/worker');const x=diagnosticFailure(null,'SIGTERM','x'.repeat(9000)+' Error: database full SECRET-VALUE',['SECRET-VALUE']);assert.equal(x.signal,'SIGTERM');assert.equal(x.code,null);assert.ok(x.stderr.length<=2048);assert.match(x.stderr,/database full/);assert.ok(!x.stderr.includes('SECRET-VALUE'));assert.match(x.stderr,/redacted/);});
