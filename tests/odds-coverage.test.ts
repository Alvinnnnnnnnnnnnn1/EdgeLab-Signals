import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync,mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/core/store';
import { configSchema } from '../src/core/config';
import { hash } from '../src/core/domain';
import { testOddsCoverage,oddsCoveragePlan } from '../src/research/odds-coverage';

function setup(remaining=481){
  mkdirSync('.local',{recursive:true});const directory=mkdtempSync('.local/odds-coverage-test-');
  const store=new Store(':memory:'),config=configSchema.parse({networkEnabled:true,providers:{odds:{minIntervalSeconds:1}}});
  let at=new Date().toISOString();const old=process.env.ODDS_API_KEY;process.env.ODDS_API_KEY='TEST-ONLY-MOCK';
  const prior={monthlyOddsCeiling:60},grant={id:randomUUID(),ownerApproved:true,approvedAt:at,expiresAt:new Date(Date.parse(at)+3600000).toISOString(),month:at.slice(0,7),apiKeyFingerprint:hash('TEST-ONLY-MOCK'),maxRequests:4,maxCredits:5,reserve:100,oldLedgerPath:`${directory}/ledger.json`,oldConfigPath:`${directory}/old.json`,oldConfigHash:hash(prior),oldMonthlyCeiling:60,scope:'one-nba-sportsbet-coverage-test'};
  for(const [path,value] of [[grant.oldLedgerPath,{period:grant.month,reserved:19,remaining:481,uncertain:false}],[grant.oldConfigPath,prior],[`${directory}/grant.json`,grant]] as const)writeFileSync(path,JSON.stringify(value),{mode:0o600});
  const event={id:'exact-event',sport_key:'basketball_nba',commence_time:new Date(Date.parse(at)+6*3600000).toISOString(),home_team:'TEST-ONLY Home',away_team:'TEST-ONLY Away'};
  const urls:URL[]=[];
  const fetcher:typeof fetch=async input=>{const url=new URL(String(input));urls.push(url);let body:unknown=[];
    if(url.pathname.endsWith('/events'))body=[event];
    else if(url.pathname.endsWith('/markets'))body={...event,bookmakers:[{key:'sportsbet',markets:[]}]};
    else if(url.pathname.endsWith('/odds'))body={...event,bookmakers:[{key:'sportsbet',markets:['player_points','player_rebounds','player_assists','player_threes'].map(key=>({key,last_update:at,outcomes:[{name:'Over',description:'TEST-ONLY Player',point:20.5,price:1.9},{name:'Under',description:'TEST-ONLY Player',point:20.5,price:1.9}]}))}]};
    return Response.json(body,{headers:{'x-requests-remaining':String(remaining),'x-requests-used':'19','x-requests-last':url.pathname.endsWith('/odds')?'4':url.pathname.endsWith('/markets')?'1':'0'}});
  };
  return{store,config,grant,directory,grantPath:`${directory}/grant.json`,urls,fetcher,clock:()=>at,wait:async(delay:number)=>{at=new Date(Date.parse(at)+delay).toISOString();},close:()=>{store.close();rmSync(directory,{recursive:true,force:true});if(old===undefined)delete process.env.ODDS_API_KEY;else process.env.ODDS_API_KEY=old;}};
}
test('shared-key coverage is bounded to four requests/five reserved credits and never enables persistent config',async()=>{
  const d=setup();try{
    const original=hash(d.config),result=await testOddsCoverage(d.store,d.config,d.grantPath,d);
    assert.equal(result.state,'sportsbet_observed');assert.equal(result.coverage.length,4);assert.ok(result.coverage.every(c=>c.missingExactFields===0));
    assert.equal(d.urls.length,4);assert.equal(hash(d.config),original);assert.equal(d.config.providers.odds.enabled,false);
    const usage=d.store.usage()[0] as {requests:number;reservedCredits:number};assert.equal(usage.requests,4);assert.equal(usage.reservedCredits,5);
    assert.deepEqual(d.store.get(`request-allowance:odds:${d.grant.id}`),{binding:hash(d.grant),requests:4,credits:5});
    await assert.rejects(testOddsCoverage(d.store,d.config,d.grantPath,d),/quota|allowance/);assert.equal(d.urls.length,4);
    const receipts=d.store.db.prepare('SELECT receipt FROM receipts').all() as {receipt:string}[];assert.ok(receipts.every(r=>!r.receipt.includes('TEST-ONLY-MOCK')));
  }finally{d.close();}
});
test('paid coverage cannot consume the reserve or the old worker remaining allocation',async()=>{
  const d=setup(141);try{await assert.rejects(testOddsCoverage(d.store,d.config,d.grantPath,d),/headroom/);assert.equal(d.urls.length,2);assert.equal((d.store.usage()[0] as {reservedCredits:number}).reservedCredits,0);}finally{d.close();}
});
test('changed old controls, uncertain ledger, expired grant and wrong key stop without spending',async()=>{
  for(const change of ['controls','uncertain','expired','key'] as const){
    const d=setup();try{
      if(change==='controls')writeFileSync(d.grant.oldConfigPath,JSON.stringify({monthlyOddsCeiling:100}));
      if(change==='uncertain')writeFileSync(d.grant.oldLedgerPath,JSON.stringify({period:d.grant.month,reserved:19,remaining:481,uncertain:true}));
      if(change==='expired')writeFileSync(d.grantPath,JSON.stringify({...d.grant,expiresAt:d.grant.approvedAt}));
      if(change==='key')process.env.ODDS_API_KEY='DIFFERENT-TEST-KEY';
      await assert.rejects(testOddsCoverage(d.store,d.config,d.grantPath,d));assert.equal(d.urls.length,0);assert.equal(d.store.usage().length,0);
    }finally{d.close();}
  }
});
test('coverage planning makes no network request and does not claim mappings or delivery',()=>{const plan=oddsCoveragePlan();assert.equal(plan.maximumCredits,5);assert.equal(plan.maximumRequests,4);assert.equal(plan.sendsMessages,false);assert.equal(plan.enablesPersistentOddsCollection,false);});
test('shared grant reservations survive a daily reset and cannot be rebound or refunded',()=>{
  const store=new Store(':memory:'),provider=configSchema.parse({providers:{odds:{enabled:true,dailyLimit:100,monthlyCredits:200,reserve:100,minIntervalSeconds:1}}}).providers.odds;
  const grant={id:randomUUID(),binding:hash('TEST-ONLY reviewed grant'),maxRequests:2,maxCredits:5,expiresAt:'2026-11-22T00:10:00.000Z'};
  try{
    const first=store.reserve('odds',provider,4,'2026-11-21T23:59:00.000Z',grant);store.finishReservation(first,'transport_or_parse_failure');
    store.reserve('odds',provider,1,'2026-11-22T00:00:00.000Z',grant);
    assert.throws(()=>store.reserve('odds',provider,0,'2026-11-22T00:00:02.000Z',grant),/allowance exhausted/);
    assert.throws(()=>store.reserve('odds',provider,0,'2026-11-22T00:00:02.000Z',{...grant,binding:hash('changed'),maxRequests:4}),/binding changed/);
    assert.equal((store.get(`request-allowance:odds:${grant.id}`) as {credits:number}).credits,5);
  }finally{store.close();}
});
