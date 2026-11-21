import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store';
import { configSchema } from '../src/core/config';
import { hash,type GameLog,props } from '../src/core/domain';
import { JsonHTTP } from '../src/providers/http';
import { liveOnce,livePlan,liveStatus,liveWorker } from '../src/research/live';
import { freezeConditionalShadow,researchModels,type RosterCandidate } from '../src/research/shadow';
import { backup } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactSchema } from '../src/research/inference';
import { modelSpec,RESEARCH_VERSION } from '../src/research/models';

const fixture={id:100,date:'2026-11-21',season:2026,datetime:'2026-11-21T15:00:00.000Z',status:'Scheduled',status_state:'scheduled',postseason:false,home_team:{id:1,full_name:'TEST-ONLY Home'},visitor_team:{id:2,full_name:'TEST-ONLY Away'}};
function setup(mode:'research'|'shadow'='shadow'){
  const store=new Store(':memory:'),config=configSchema.parse({networkEnabled:true,operatingMode:mode,research:{historicalBackfill:false},providers:{balldontlie:{enabled:true,tier:'all-star',dailyLimit:100,minIntervalSeconds:1}}});let at='2026-11-21T09:00:00.000Z';const old=process.env.BALLDONTLIE_API_KEY;process.env.BALLDONTLIE_API_KEY='TEST-ONLY-key';const urls:URL[]=[];
  const http=new JsonHTTP(store,config,async input=>{const u=new URL(input);urls.push(u);assert.equal(u.host,'api.balldontlie.io');if(u.pathname.endsWith('/players/active'))return Response.json({data:[{id:70,first_name:'TEST-ONLY',last_name:'Player',team:{id:1}}],meta:{}});if(u.pathname.endsWith('/player_injuries'))return Response.json({data:[],meta:{}});if(u.pathname.endsWith('/games'))return Response.json({data:u.searchParams.get('start_date')==='2026-11-21'?[fixture]:[],meta:{}});return Response.json({data:[],meta:{}});},()=>at);
  const logs:GameLog[]=Array.from({length:14},(_,i)=>{const startsAt=new Date(Date.UTC(2026,9,i+1)).toISOString(),observedAt=new Date(Date.parse(startsAt)+4*3600000).toISOString(),body=JSON.stringify({label:'TEST-ONLY mocked normalized history',i}),source={provider:'test-only-mock-provider',endpoint:'https://example.invalid/mock',retrievedAt:observedAt,publishedAt:null,hash:hash(body),simulated:false};store.receipt(source,body);return{event:{id:`bdl:nba:game:${i+1}`,league:'NBA',season:'2026',homeId:'bdl:nba:team:1',awayId:'bdl:nba:team:2',home:'TEST-ONLY Home',away:'TEST-ONLY Away',startsAt},playerId:'bdl:nba:player:70',player:'TEST-ONLY Player',teamId:'bdl:nba:team:1',observedAt,completedAt:null,minutes:30,participated:true,stats:{points:20,rebounds:5,assists:4,threes:2},final:true,source,research:{phase:'regular',overtimePeriods:0,threeAttempts:5,rosterOpportunityVerified:false}};});store.ingest(logs,at);
  const artifact=artifactSchema.parse({protocol:'chronological-challenge/1.1.0',modelVersion:RESEARCH_VERSION,datasetId:hash('TEST-ONLY dataset'),generatedAt:'2026-11-20T00:00:00.000Z',trainedBefore:'2026-10-05',selectedAt:'2026-10-10',calibrationBefore:'2026-10-15',testIds:hash('mock'),bestSimple:modelSpec('last10'),selected:modelSpec('hierarchical-nb'),calibration:{method:'raw'},featureNames:['last5','last10','ewa','seasonShrunk','minutes','minutesSD','rate','restDays','home','teamChanged']});
  for(const prop of props)store.db.prepare('INSERT INTO research_models VALUES (?,?,?,?)').run(prop,at,prop,JSON.stringify({prop,artifact,artifactHash:hash(artifact),reportHash:hash('mock'),qualifiedEligible:false}));
  return{store,config,http,urls,clock:()=>at,tick:()=>{at=new Date(Date.parse(at)+60000).toISOString();},close:()=>{store.close();if(old===undefined)delete process.env.BALLDONTLIE_API_KEY;else process.env.BALLDONTLIE_API_KEY=old;}};
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
  const d=setup();try{for(let i=0;i<100;i++)d.store.db.prepare('INSERT INTO quota VALUES (?,?,?,?,?)').run(`mock-${i}`,'balldontlie','2026-11-21T08:00:00.000Z',0,'success');const first=await liveOnce(d.store,d.config,d);assert.equal(first.state,'deferred');assert.equal(d.urls.length,0);d.tick();await liveOnce(d.store,d.config,d);assert.equal(d.urls.length,0);const jobs=d.store.db.prepare("SELECT next_at FROM research_jobs WHERE kind IN ('fixtures','roster','injuries','finals')").all() as {next_at:string}[];assert.ok(jobs.every(j=>j.next_at.startsWith('2026-11-22')));assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM research_runs').get()!.n,2);assert.throws(()=>d.store.db.prepare('DELETE FROM research_runs').run(),/cannot be removed/);}finally{d.close();}
});
test('fixture cancellation blocks a previously planned pregame job rather than guessing a replacement',async()=>{
  const d=setup();try{await liveOnce(d.store,d.config,d);const f=d.store.get<{event:unknown;source:unknown;status:string}>('live:fixture:100')!;d.store.set('live:fixture:100',{...f,status:'canceled'});d.tick();await liveOnce(d.store,d.config,d);assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM shadow_forecasts').get()!.n,0);}finally{d.close();}
});
test('SQLite reopen preserves jobs and first shadow forecasts instead of duplicating them',async()=>{
  const d=setup(),directory=mkdtempSync(join(tmpdir(),'edgelab-restart-'));let reopened:Store|undefined;
  try{await liveOnce(d.store,d.config,d);d.tick();await liveOnce(d.store,d.config,d);await backup(d.store.db,join(directory,'restart.sqlite'));reopened=new Store(join(directory,'restart.sqlite'));d.tick();const http=new JsonHTTP(reopened,d.config,async()=>Response.json({data:[],meta:{}}),d.clock);await liveOnce(reopened,d.config,{clock:d.clock,http});assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM shadow_forecasts').get()!.n,4);assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM research_runs').get()!.n,3);}finally{reopened?.close();d.close();rmSync(directory,{recursive:true,force:true});}
});
test('an expensive calculation cannot register a forecast after its actual pregame deadline',async()=>{
  const d=setup('research');try{await liveOnce(d.store,d.config,d);d.tick();await liveOnce(d.store,d.config,d);const f=d.store.get<{event:Parameters<typeof freezeConditionalShadow>[1];source:Parameters<typeof freezeConditionalShadow>[2]}>('live:fixture:100')!,p=d.store.get<RosterCandidate>('live:roster:70')!;const result=freezeConditionalShadow(d.store,f.event,f.source,[{...p,injuryStatus:null}],researchModels(d.store),d.clock(),30,true,()=> '2026-11-21T14:59:00.000Z');assert.equal(result.inserted,0);assert.ok(result.exclusions.every(e=>e.reason.includes('deadline')));}finally{d.close();}
});
test('single-worker ownership and graceful stop do not start another network loop',async()=>{
  const d=setup();try{const now=new Date().toISOString(),lease=d.store.acquire('live-worker',now,150)!;await assert.rejects(liveWorker(d.store,()=>d.config,new AbortController().signal),/already active/);d.store.release('live-worker',lease);const controller=new AbortController();controller.abort();await liveWorker(d.store,()=>d.config,controller.signal);assert.equal(d.store.get<{state:string}>('live:worker')!.state,'stopped');assert.equal(d.urls.length,0);}finally{d.close();}
});
test('a schedule cursor from before a prolonged outage is not reused with a new date scope',async()=>{
  const d=setup();try{d.store.db.prepare("INSERT INTO research_jobs(id,kind,next_at,state,body) VALUES ('fixtures','fixtures',?,'queued',?)").run(d.clock(),JSON.stringify({scope:{from:'2026-11-10',to:'2026-11-13'},cursor:999,seen:[999]}));await liveOnce(d.store,d.config,d);assert.equal(d.urls[0].searchParams.get('start_date'),'2026-11-21');assert.equal(d.urls[0].searchParams.has('cursor'),false);}finally{d.close();}
});
