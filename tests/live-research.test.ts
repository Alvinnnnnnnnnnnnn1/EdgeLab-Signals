import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store';
import { configSchema } from '../src/core/config';
import { hash,type GameLog,props } from '../src/core/domain';
import { bdlEvent } from '../src/providers/balldontlie';
import { JsonHTTP } from '../src/providers/http';
import { liveOnce,livePlan,liveStatus,liveWorker } from '../src/research/live';
import { freezeConditionalShadow,researchModels,type RosterCandidate } from '../src/research/shadow';
import { backup } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactSchema } from '../src/research/inference';
import { modelSpec,RESEARCH_VERSION } from '../src/research/models';

const fixture={id:100,date:'2026-11-21',season:2026,datetime:'2026-11-21T21:45:00.000Z',status:'Scheduled',status_state:'scheduled',postseason:false,home_team:{id:1,full_name:'TEST-ONLY Home'},visitor_team:{id:2,full_name:'TEST-ONLY Away'}};
function setup(mode:'research'|'shadow'='shadow',start='2026-11-21T20:15:00.000Z',testFixture:typeof fixture|null=fixture){
  const store=new Store(':memory:'),config=configSchema.parse({networkEnabled:true,operatingMode:mode,research:{historicalBackfill:false},providers:{balldontlie:{enabled:true,tier:'all-star',dailyLimit:100,minIntervalSeconds:1}}});let at=start;const old=process.env.BALLDONTLIE_API_KEY;process.env.BALLDONTLIE_API_KEY='TEST-ONLY-key';const urls:URL[]=[];
  const http=new JsonHTTP(store,config,async input=>{const u=new URL(input);urls.push(u);assert.equal(u.host,'api.balldontlie.io');if(u.pathname.endsWith('/players/active'))return Response.json({data:[{id:70,first_name:'TEST-ONLY',last_name:'Player',team:{id:1}}],meta:{}});if(u.pathname.endsWith('/player_injuries'))return Response.json({data:[],meta:{}});if(u.pathname.endsWith('/games'))return Response.json({data:u.searchParams.get('start_date')==='2026-11-21'&&testFixture?[testFixture]:[],meta:{}});return Response.json({data:[],meta:{}});},()=>at);
  const logs:GameLog[]=Array.from({length:14},(_,i)=>{const startsAt=new Date(Date.UTC(2026,9,i+1)).toISOString(),observedAt=new Date(Date.parse(startsAt)+4*3600000).toISOString(),body=JSON.stringify({label:'TEST-ONLY mocked normalized history',i}),source={provider:'test-only-mock-provider',endpoint:'https://example.invalid/mock',retrievedAt:observedAt,publishedAt:null,hash:hash(body),simulated:false};store.receipt(source,body);return{event:{id:`bdl:nba:game:${i+1}`,league:'NBA',season:'2026',homeId:'bdl:nba:team:1',awayId:'bdl:nba:team:2',home:'TEST-ONLY Home',away:'TEST-ONLY Away',startsAt},playerId:'bdl:nba:player:70',player:'TEST-ONLY Player',teamId:'bdl:nba:team:1',observedAt,completedAt:null,minutes:30,participated:true,stats:{points:20,rebounds:5,assists:4,threes:2},final:true,source,research:{phase:'regular',overtimePeriods:0,threeAttempts:5,rosterOpportunityVerified:false}};});store.ingest(logs,at);
  const artifact=artifactSchema.parse({protocol:'chronological-challenge/1.1.0',modelVersion:RESEARCH_VERSION,datasetId:hash('TEST-ONLY dataset'),generatedAt:'2026-11-20T00:00:00.000Z',trainedBefore:'2026-10-05',selectedAt:'2026-10-10',calibrationBefore:'2026-10-15',testIds:hash('mock'),bestSimple:modelSpec('last10'),selected:modelSpec('hierarchical-nb'),calibration:{method:'raw'},featureNames:['last5','last10','ewa','seasonShrunk','minutes','minutesSD','rate','restDays','home','teamChanged']});
  for(const prop of props)store.db.prepare('INSERT INTO research_models VALUES (?,?,?,?)').run(prop,at,prop,JSON.stringify({prop,artifact,artifactHash:hash(artifact),reportHash:hash('mock'),qualifiedEligible:false}));
  return{store,config,http,urls,clock:()=>at,setAt:(value:string)=>{at=value;},tick:()=>{at=new Date(Date.parse(at)+60000).toISOString();},close:()=>{store.close();if(old===undefined)delete process.env.BALLDONTLIE_API_KEY;else process.env.BALLDONTLIE_API_KEY=old;}};
}
test('research scheduler discovers exact fixtures/rosters and freezes conditional shadow without odds or availability claims',async()=>{
  const d=setup();try{const initial=d.store.db.prepare('SELECT count(*) AS n FROM research_jobs').get()!.n;const dry=livePlan(d.store,d.config,d.clock());assert.equal(dry.mode,'dry_run_no_network');assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM research_jobs').get()!.n,initial);assert.equal(d.urls.length,0);
    await liveOnce(d.store,d.config,d);assert.equal(d.urls.length,1);d.tick();const run=await liveOnce(d.store,d.config,d);assert.equal('forecastsFrozen' in run?run.forecastsFrozen:0,4);assert.equal(d.urls.length,2);
    const records=d.store.db.prepare('SELECT body FROM shadow_forecasts').all() as {body:string}[];assert.equal(records.length,4);for(const row of records){const r=JSON.parse(row.body);assert.equal(r.availabilityVerified,false);assert.equal(r.promotionEligible,false);assert.equal(r.inputs.context.minutesEvidence,'model-estimated');assert.equal(r.inputs.context.status,'unknown');}
    d.tick();await liveOnce(d.store,d.config,d);assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM shadow_forecasts').get()!.n,4);assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM prospective_forecasts').get()!.n,0);assert.equal(d.store.signals().length,0);assert.equal(liveStatus(d.store,d.config,d.clock()).marketStatus,'MARKET_DATA_NOT_AUTHORISED');
  }finally{d.close();}
});
test('RESEARCH computes model versus baseline but does not silently activate SHADOW registration',async()=>{
  const d=setup('research');try{await liveOnce(d.store,d.config,d);d.tick();const run=await liveOnce(d.store,d.config,d);assert.ok('predictionsGenerated' in run&&run.predictionsGenerated===4);assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM shadow_forecasts').get()!.n,0);assert.equal(d.store.signals().length,0);}finally{d.close();}
});
test('quota exhaustion defers network jobs to the next UTC day without retry loops or false cycle success',async()=>{
  const d=setup();try{for(let i=0;i<100;i++)d.store.db.prepare('INSERT INTO quota VALUES (?,?,?,?,?)').run(`mock-${i}`,'balldontlie','2026-11-21T08:00:00.000Z',0,'success');const first=await liveOnce(d.store,d.config,d);assert.equal(first.state,'deferred');assert.equal(d.urls.length,0);d.tick();await liveOnce(d.store,d.config,d);assert.equal(d.urls.length,0);const jobs=d.store.db.prepare("SELECT next_at FROM research_jobs WHERE error='BDL_DAILY_QUOTA_EXHAUSTED'").all() as {next_at:string}[];assert.ok(jobs.length>0&&jobs.every(j=>j.next_at.startsWith('2026-11-22')));assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM research_runs').get()!.n,2);assert.throws(()=>d.store.db.prepare('DELETE FROM research_runs').run(),/cannot be removed/);}finally{d.close();}
});
test('fixture cancellation blocks a previously planned pregame job rather than guessing a replacement',async()=>{
  const d=setup();try{await liveOnce(d.store,d.config,d);const f=d.store.get<{event:unknown;source:unknown;status:string}>('live:fixture:100')!;d.store.set('live:fixture:100',{...f,status:'canceled'});d.tick();await liveOnce(d.store,d.config,d);assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM shadow_forecasts').get()!.n,0);}finally{d.close();}
});
test('SQLite reopen preserves jobs and first shadow forecasts instead of duplicating them',async()=>{
  const d=setup(),directory=mkdtempSync(join(tmpdir(),'edgelab-restart-'));let reopened:Store|undefined;
  try{await liveOnce(d.store,d.config,d);d.tick();await liveOnce(d.store,d.config,d);await backup(d.store.db,join(directory,'restart.sqlite'));reopened=new Store(join(directory,'restart.sqlite'));d.tick();const http=new JsonHTTP(reopened,d.config,async()=>Response.json({data:[],meta:{}}),d.clock);await liveOnce(reopened,d.config,{clock:d.clock,http});assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM shadow_forecasts').get()!.n,4);assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM research_runs').get()!.n,3);}finally{reopened?.close();d.close();rmSync(directory,{recursive:true,force:true});}
});
test('an expensive calculation cannot register a forecast after its actual pregame deadline',async()=>{
  const d=setup('research');try{await liveOnce(d.store,d.config,d);d.tick();await liveOnce(d.store,d.config,d);const f=d.store.get<{event:Parameters<typeof freezeConditionalShadow>[1];source:Parameters<typeof freezeConditionalShadow>[2]}>('live:fixture:100')!,p=d.store.get<RosterCandidate>('live:roster:70')!;const result=freezeConditionalShadow(d.store,f.event,f.source,[{...p,injuryStatus:null}],researchModels(d.store),d.clock(),30,true,()=> '2026-11-21T21:44:00.000Z');assert.equal(result.inserted,0);assert.ok(result.exclusions.every(e=>e.reason.includes('deadline')));}finally{d.close();}
});
test('single-worker ownership and graceful stop do not start another network loop',async()=>{
  const d=setup();try{const now=new Date().toISOString(),lease=d.store.acquire('live-worker',now,150)!;await assert.rejects(liveWorker(d.store,()=>d.config,new AbortController().signal),/already active/);d.store.release('live-worker',lease);const controller=new AbortController();controller.abort();await liveWorker(d.store,()=>d.config,controller.signal);assert.equal(d.store.get<{state:string}>('live:worker')!.state,'stopped');assert.equal(d.urls.length,0);}finally{d.close();}
});
test('a schedule cursor from before a prolonged outage is not reused with a new date scope',async()=>{
  const d=setup();try{d.store.db.prepare("INSERT INTO research_jobs(id,kind,next_at,state,body) VALUES ('fixtures','fixtures',?,'queued',?)").run(d.clock(),JSON.stringify({scope:{from:'2026-11-10',to:'2026-11-13'},cursor:999,seen:[999]}));await liveOnce(d.store,d.config,d);assert.equal(d.urls[0].searchParams.get('start_date'),'2026-11-21');assert.equal(d.urls[0].searchParams.has('cursor'),false);}finally{d.close();}
});

function retainFixture(d:ReturnType<typeof setup>,game:typeof fixture){
  const body=JSON.stringify({data:[game],meta:{}}),source={provider:'balldontlie',endpoint:'https://api.balldontlie.io/nba/v1/games?start_date=2026-11-21&end_date=2026-11-24&per_page=100',retrievedAt:d.clock(),publishedAt:null,hash:hash(body),simulated:false};
  d.store.receipt(source,body);d.store.set(`live:fixture:${game.id}`,{event:bdlEvent(game),source,status:'scheduled'});d.store.set('live:fixtures-complete',{at:d.clock(),source});
}
test('routine overnight heartbeats defer acquisition without requests or send attempts',async()=>{
  const d=setup('shadow','2026-11-21T15:30:00.000Z');try{
    await liveOnce(d.store,d.config,d);d.tick();await liveOnce(d.store,d.config,d);assert.equal(d.urls.length,0);
    const source=d.store.db.prepare("SELECT next_at,attempts,error FROM research_jobs WHERE kind='fixtures'").get()!;
    assert.equal(source.next_at,'2026-11-21T20:15:00.000Z');assert.equal(source.attempts,0);assert.equal(source.error,'OUTSIDE_DAYTIME_RESEARCH_WINDOW');
  }finally{d.close();}
});
test('an empty completed discovery does not poll roster, injuries or results without relevant fixtures',async()=>{
  const d=setup('research',undefined,null);try{
    await liveOnce(d.store,d.config,d);for(let i=0;i<5;i++){d.tick();await liveOnce(d.store,d.config,d);}
    assert.equal(d.urls.length,1);assert.equal(d.urls[0].pathname,'/nba/v1/games');
    assert.equal(d.store.db.prepare("SELECT attempts FROM research_jobs WHERE id='roster'").get()!.attempts,0);
  }finally{d.close();}
});
test('early Melbourne fixtures retain independent T-90/T-20 collection and shadow registration during quiet hours',async()=>{
  const early={...fixture,datetime:'2026-11-21T17:00:00.000Z'},d=setup('shadow','2026-11-21T15:30:00.000Z',early);
  try{retainFixture(d,early);const run=await liveOnce(d.store,d.config,d);
    assert.equal('forecastsFrozen' in run?run.forecastsFrozen:0,4);assert.equal(d.urls.length,1);assert.ok(d.urls[0].pathname.endsWith('/players/active'));
    const jobs=d.store.db.prepare("SELECT body,next_at,deadline FROM research_jobs WHERE kind='pregame' ORDER BY next_at").all() as {body:string;next_at:string;deadline:string}[];
    assert.deepEqual(jobs.map(j=>JSON.parse(j.body).window),[90,20]);assert.equal(jobs[1].next_at,'2026-11-21T16:40:00.000Z');assert.equal(jobs[1].deadline,'2026-11-21T16:58:00.000Z');
    d.tick();await liveOnce(d.store,d.config,d);assert.equal(d.urls.length,2);assert.ok(d.urls[1].pathname.endsWith('/player_injuries'));
    d.setAt('2026-11-21T16:40:00.000Z');await liveOnce(d.store,d.config,d);assert.equal(d.urls.length,3);assert.ok(d.urls[2].pathname.endsWith('/games'));
    const before=d.urls.length;d.setAt('2026-11-21T17:01:00.000Z');await liveOnce(d.store,d.config,d);assert.equal(d.urls.length,before);
    assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM shadow_forecasts').get()!.n,4);assert.equal(d.store.signals().length,0);
    assert.equal(d.store.db.prepare("SELECT state FROM research_jobs WHERE kind='pregame' AND deadline='2026-11-21T16:58:00.000Z'").get()!.state,'complete');
  }finally{d.close();}
});
test('wake after early fixture deadlines expires missed jobs without backdated forecasts or requests',async()=>{
  const early={...fixture,datetime:'2026-11-21T17:00:00.000Z'},d=setup('shadow','2026-11-21T15:00:00.000Z',early);
  try{retainFixture(d,early);await liveOnce(d.store,d.config,d);d.setAt('2026-11-21T18:00:00.000Z');await liveOnce(d.store,d.config,d);
    assert.equal(d.urls.length,0);assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM shadow_forecasts').get()!.n,0);
    const rows=d.store.db.prepare("SELECT state FROM research_jobs WHERE deadline IS NOT NULL").all() as {state:string}[];assert.ok(rows.length>0&&rows.every(r=>r.state==='expired'));
  }finally{d.close();}
});
test('pregame exceptions never bypass exhausted BDL quota',async()=>{
  const early={...fixture,datetime:'2026-11-21T17:00:00.000Z'},d=setup('shadow','2026-11-21T15:30:00.000Z',early);
  try{retainFixture(d,early);for(let i=0;i<100;i++)d.store.db.prepare('INSERT INTO quota VALUES (?,?,?,?,?)').run(`exhausted-${i}`,'balldontlie','2026-11-21T08:00:00.000Z',0,'success');
    await liveOnce(d.store,d.config,d);assert.equal(d.urls.length,0);assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM shadow_forecasts').get()!.n,0);
    assert.ok(d.store.db.prepare("SELECT id FROM research_jobs WHERE error='BDL_DAILY_QUOTA_EXHAUSTED' AND deadline IS NOT NULL").get());
  }finally{d.close();}
});

test('overlapping fixture tasks resume one shared roster cursor after SQLite reopen',async()=>{
  const early={...fixture,datetime:'2026-11-21T17:00:00.000Z'},d=setup('shadow','2026-11-21T15:30:00.000Z',early),directory=mkdtempSync(join(tmpdir(),'edgelab-source-cursor-'));let reopened:Store|undefined;
  const rosterPages:(string|null)[]=[];
  const makeHTTP=(store:Store)=>new JsonHTTP(store,d.config,async input=>{
    const u=new URL(input);if(u.pathname.endsWith('/players/active')){const cursor=u.searchParams.get('cursor');rosterPages.push(cursor);return Response.json({data:cursor?[{id:70,first_name:'TEST-ONLY',last_name:'Player',team:{id:1}}]:[],meta:cursor?{}:{next_cursor:50}});}
    return Response.json({data:[],meta:{}});
  },d.clock);
  try{retainFixture(d,early);retainFixture(d,{...early,id:101,datetime:'2026-11-21T17:05:00.000Z'});
    await liveOnce(d.store,d.config,{clock:d.clock,http:makeHTTP(d.store)});assert.equal(d.store.get<{cursor:number}>('live:source-progress:roster')!.cursor,50);
    await backup(d.store.db,join(directory,'restart.sqlite'));reopened=new Store(join(directory,'restart.sqlite'));d.tick();
    await liveOnce(reopened,d.config,{clock:d.clock,http:makeHTTP(reopened)});assert.equal(reopened.get('live:source-progress:roster'),null);
    for(let i=0;i<5;i++){d.tick();await liveOnce(reopened,d.config,{clock:d.clock,http:makeHTTP(reopened)});}
    assert.deepEqual(rosterPages,[null,'50']);assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM shadow_forecasts').get()!.n,8);
  }finally{reopened?.close();d.close();rmSync(directory,{recursive:true,force:true});}
});
