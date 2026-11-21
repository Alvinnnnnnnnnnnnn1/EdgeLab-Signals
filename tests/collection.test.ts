import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store';
import { configSchema } from '../src/core/config';
import { hash } from '../src/core/domain';
import { JsonHTTP } from '../src/providers/http';
import { BDLProvider } from '../src/providers/balldontlie';
import { collectionPlan,collectBatch,monthWindows } from '../src/research/collection';
import { coverageReport } from '../src/research/coverage';

const fixture={id:101,date:'2025-01-01',season:2024,status:'Final',postseason:false,period:4,datetime:'2025-01-02T01:00:00.000Z',home_team:{id:1,full_name:'TEST-ONLY Home'},visitor_team:{id:2,full_name:'TEST-ONLY Away'}};
const stat=(id=1)=>({id,min:'30',pts:20,reb:3,ast:2,fg3m:2,fg3a:5,player:{id,first_name:'TEST-ONLY',last_name:String(id)},team:fixture.home_team,game:{id:101,date:fixture.date,season:2024,status:'Final',home_team_id:1,visitor_team_id:2}});
const w={season:2024,from:'2025-01-01',to:'2025-01-01'};
function setup(handler:(url:URL)=>unknown){
  const store=new Store(':memory:'),config=configSchema.parse({networkEnabled:true,providers:{balldontlie:{enabled:true,tier:'all-star',dailyLimit:100,minIntervalSeconds:1}}});
  const old=process.env.BALLDONTLIE_API_KEY;process.env.BALLDONTLIE_API_KEY='TEST-ONLY-MOCK';
  let at='2026-11-21T01:00:00.000Z';const urls:URL[]=[];
  const http=new JsonHTTP(store,config,async input=>{const url=new URL(input);urls.push(url);return Response.json(handler(url));},()=>at);
  return{store,config,http,urls,clock:()=>at,wait:async(delay:number)=>{at=new Date(Date.parse(at)+delay).toISOString();},tick:()=>{at=new Date(Date.parse(at)+2000).toISOString();},close:()=>{store.close();if(old===undefined)delete process.env.BALLDONTLIE_API_KEY;else process.env.BALLDONTLIE_API_KEY=old;}};
}
function retainedFixture(store:Store){
  const body=JSON.stringify({data:[fixture],meta:{}}),receipt={provider:'balldontlie',endpoint:'https://api.balldontlie.io/nba/v1/games?start_date=2025-01-01&end_date=2025-01-31',retrievedAt:'2026-11-20T01:00:00.000Z',publishedAt:null,hash:hash(body),simulated:false};
  store.receipt(receipt,body);store.set('bdl:fixture:101',{body:fixture,receipt});
  store.set('ingest:70,71:2025-01-01:2025-01-31',{cursor:null,fixturesComplete:true,complete:true,at:receipt.retrievedAt});
}
test('league queries omit player IDs, preserve cursor filters, fetch empty tails and replay without HTTP',async()=>{
  const d=setup(url=>url.pathname.endsWith('/games')?{data:[fixture],meta:{}}:url.searchParams.has('cursor')?{data:[],meta:{}}:{data:Array.from({length:100},(_,i)=>stat(i+1)),meta:{next_cursor:100}});
  try{
    const result=await collectBatch(d.store,d.config,[w],3,d);
    assert.equal(result.complete,true);assert.equal(result.requestsUsed,3);assert.equal(d.store.logs().length,100);
    for(const url of d.urls){assert.equal(url.searchParams.get('seasons[]'),'2024');assert.equal(url.searchParams.get('per_page'),'100');assert.equal(url.searchParams.has('player_ids[]'),false);}
    assert.equal(d.urls[2].searchParams.get('cursor'),'100');
    const replay=await collectBatch(d.store,d.config,[w],1,d);assert.equal(replay.requestsUsed,0);assert.equal(d.urls.length,3);
  }finally{d.close();}
});
test('historical V1.2 fixture coverage serves contained league windows and different selected players permanently',async()=>{
  const d=setup(url=>{assert.ok(url.pathname.endsWith('/stats'));return{data:[stat(Number(url.searchParams.get('player_ids[]')??'1'))],meta:{}};});
  try{
    retainedFixture(d.store);
    const first=await collectBatch(d.store,d.config,[w],1,d);assert.equal(first.requestsUsed,1);assert.equal(first.complete,true);
    d.tick();const next=await new BDLProvider(d.http,d.store,d.config).stats(['2'],w.from,w.to,d.clock());assert.equal(next.inserted,1);
    assert.equal(d.urls.length,2);assert.ok(d.urls.every(u=>u.pathname.endsWith('/stats')));
    const report=coverageReport(d.store,d.clock());assert.equal(report.byPlayer.length,2);assert.equal(report.byFixture.length,1);assert.equal(report.missingExactReceipts.length,0);
  }finally{d.close();}
});
test('partial legacy fixture cursor resumes without fetching its first page again',async()=>{
  const d=setup(url=>{assert.equal(url.searchParams.get('cursor'),'101');return{data:[fixture],meta:{}};});
  try{
    d.store.set('ingest:1:2025-01-01:2025-01-01',{cursor:null,complete:false,fixtureCursor:101,fixturesComplete:false,at:d.clock()});
    const result=await new BDLProvider(d.http,d.store,d.config).stats(['1'],w.from,w.to,d.clock());assert.equal(result.stage,'fixture-page');assert.equal(d.urls.length,1);
  }finally{d.close();}
});
test('batch limits are actual reserved requests and never raise the configured daily cap',async()=>{
  const d=setup(()=>({data:[fixture],meta:{}}));
  try{
    const result=await collectBatch(d.store,d.config,[w],1,d);assert.equal(result.requestsUsed,1);assert.equal(result.complete,false);assert.equal(d.urls.length,1);
    const limited={...d.config,providers:{...d.config.providers,balldontlie:{...d.config.providers.balldontlie,dailyLimit:1}}};
    await assert.rejects(collectBatch(d.store,limited,[w],1,d),/remaining.*0/);assert.equal(d.urls.length,1);assert.equal(limited.providers.balldontlie.dailyLimit,1);
    for(const cap of [0,26,1.5])await assert.rejects(collectBatch(d.store,d.config,[w],cap,d));
  }finally{d.close();}
});
test('cyclic stats cursors fail without advancing the saved checkpoint or retrying',async()=>{
  let calls=0;const d=setup(()=>({data:[stat(++calls)],meta:{next_cursor:calls===2?200:100}}));
  try{
    retainedFixture(d.store);
    await assert.rejects(collectBatch(d.store,d.config,[w],3,d),/Repeated pagination/);
    assert.equal(d.urls.length,3);assert.equal(d.store.logs().length,2);
    assert.equal(d.store.get<{cursor:number}>('ingest:league:2024:2025-01-01:2025-01-01')!.cursor,200);
  }finally{d.close();}
});
test('out-of-scope responses fail closed and preserve the preceding checkpoint',async()=>{
  const d=setup(()=>({data:[{...fixture,season:2025}],meta:{}}));
  try{await assert.rejects(collectBatch(d.store,d.config,[w],1,d),/outside requested scope/);assert.equal(d.store.logs().length,0);assert.equal(d.urls.length,1);assert.equal(d.store.get('bdl:fixture:101'),null);}finally{d.close();}
});
test('quarantined stat rows retain raw evidence and block further acquisition in that batch',async()=>{
  const d=setup(()=>({data:[{...stat(),game:{...stat().game,id:999}}],meta:{next_cursor:1}}));
  try{retainedFixture(d.store);await assert.rejects(collectBatch(d.store,d.config,[w],2,d),/quarantine/);assert.equal(d.urls.length,1);assert.equal(coverageReport(d.store,d.clock()).quarantinePages,1);assert.equal(d.store.logs().length,0);}finally{d.close();}
});
test('configuration changes during cooldown stop before transport',async()=>{
  const d=setup(()=>({data:[stat()],meta:{}}));
  try{
    retainedFixture(d.store);d.store.reserve('balldontlie',d.config.providers.balldontlie,0,d.clock());let changed=false;
    await assert.rejects(collectBatch(d.store,d.config,[w],1,{...d,wait:async delay=>{await d.wait(delay);changed=true;},checkConfig:()=>changed?{...d.config,deliveryEnabled:true}:d.config}),/Configuration changed/);
    assert.equal(d.urls.length,0);
  }finally{d.close();}
});
test('calendar plan is bounded, nonoverlapping, source-season filtered and quota aware without HTTP',()=>{
  const d=setup(()=>{assert.fail('planning must never fetch');});
  try{
    const windows=monthWindows(2024,'2025-06-30');assert.equal(windows.length,9);assert.equal(windows[0].from,'2024-10-01');assert.equal(windows.at(-1)!.to,'2025-06-30');
    for(let i=1;i<windows.length;i++)assert.equal(Date.parse(windows[i].from)-Date.parse(windows[i-1].to),86400000);
    d.store.reserve('balldontlie',d.config.providers.balldontlie,0,d.clock());const plan=collectionPlan(d.store,d.config,d.clock());
    assert.equal(plan.quota.remaining,99);assert.equal(plan.capChanged,false);assert.ok(plan.estimatedTotalRequests[1]>plan.estimatedTotalRequests[0]);assert.equal(d.urls.length,0);
  }finally{d.close();}
});
