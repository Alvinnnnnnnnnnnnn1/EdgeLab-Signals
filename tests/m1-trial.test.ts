import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support/suggestions-fixture';
import { hash,props,type Event } from '../src/core/domain';
import { researchModels } from '../src/research/shadow';
import { retainedRows } from '../src/model-engineering/data';
import { EngineeringJournal } from '../src/model-engineering/journal';
import { M1_VERSION,type M1Artifact } from '../src/model-engineering/m1';
import { trialContext,assertTrialFreshness } from '../src/m1-trial/context';
import { TRIAL_VERSION,trialRouting,trialFreshness,reviewWindow,melbourneMidnight,assertProtocol,type TrialProtocol } from '../src/m1-trial/contracts';
import { trialCodeHash,trialRoot } from '../src/m1-trial/code';
import { installTrial } from '../src/m1-trial/journal';
import { TrialForecaster,generationFeatures,trialIdle } from '../src/m1-trial/cycle';
import { productionRouting,legacyProductionRouting } from '../src/production/router';
import { trialReview } from '../src/m1-trial/review';
import { drainTrialRollback } from '../src/m1-trial/rollback';
import { fenceTrialJournal } from '../src/m1-trial/fence';
import { currentPlayerEvidence,archivePricedCandidates } from '../src/suggestions/engine';
import { backup } from 'node:sqlite';
import { EfficientStore } from '../src/research/reliability/store';

function setup(){
  const d=fixture(),dir=mkdtempSync(resolve('.local/m1-trial-test-')),path=dir+'/engineering-shadow.sqlite',j=new EngineeringJournal(path,true,d.clock);
  const prior={rate:.5,priorMinutes:120,excess:.1,minuteSlope:0,attemptRate:.2,makeRate:.35};
  const body:Omit<M1Artifact,'id'>={algorithm:M1_VERSION,seed:2401,trainingCutoff:'2026-10-01T00:00:00Z',dataAsOf:d.at,trainedAt:d.at,trainingMode:'retrospective',trainingOriginHash:hash('TEST-ONLY'),sourceHash:hash('TEST-ONLY statistical code'),featureManifest:['TEST-ONLY isolated mock'],trainingDates:['2026-09-01'],trainingRows:100,priors:Object.fromEntries(props.map(p=>[p,prior])) as M1Artifact['priors'],roleRates:Object.fromEntries(props.map(p=>[p,{low:.2,rotation:.5,high:.7}])) as M1Artifact['roleRates'],minuteResiduals:{low:[-5,0,5],rotation:[-3,0,3],high:[-2,0,2]}};
  const model={...body,id:hash(body)},hybrid={id:hash('TEST-ONLY hybrid'),parameters:{algorithm:'hybrid-quantile-ewa',blendWeight:.25,calibration:{method:'raw'},conditionalExcess:.1,minutes:{ridge:{weights:[30,...Array(12).fill(0)]},playerOffsets:{},residuals:[-3,0,3],quantiles:[.1,.25,.5,.75,.9].map((q,i)=>({base:27+i*1.5,q,trees:[]}))}}};
  const protocolBody:Omit<TrialProtocol,'id'>={version:TRIAL_VERSION,ownerReference:'TEST-ONLY isolated owner authority',instructionHash:hash('TEST-ONLY'),createdAt:d.at,modelId:model.id,statisticalSourceHash:model.sourceHash,codeHash:trialCodeHash(),release:trialRoot,commit:'0'.repeat(40),routing:trialRouting,originalArtifacts:Object.fromEntries(researchModels(d.store).map(m=>[m.prop,m.artifactHash])) as TrialProtocol['originalArtifacts'],hybridArtifactId:hybrid.id,hybridArtifactHash:hash(hybrid),calibration:'RAW_FROZEN',freshness:trialFreshness,qualificationHash:hash('TEST-ONLY qualifier'),configurationHashes:{},classification:'OWNER_AUTHORISED_PROSPECTIVE_NOT_INDEPENDENTLY_VALIDATED',minimumIndependentDates:30,rollback:{marketPlist:'TEST-ONLY original.plist',originalRouterHash:hash('TEST-ONLY router')},additionalPaidAcquisition:false};
  const protocol={...protocolBody,id:hash(protocolBody)};installTrial(j,protocol);j.publish(model);
  const forecaster=new TrialForecaster(protocol,model,hybrid,j,d.clock);
  const window=reviewWindow(d.at,[d.event,{...d.event,id:'TEST-ONLY next fixture',startsAt:new Date(Date.parse(d.event.startsAt)+86400000).toISOString()}]);
  const abody={protocolId:protocol.id,activatedAt:d.at,window,frozen:true as const,marketPID:1,researchPID:2,comparisonPID:3},activation={...abody,id:hash(abody)},marker={enabled:true as const,protocol,activation,journalPath:path};
  d.store.db.exec('CREATE TABLE m1_trial_activations(id TEXT PRIMARY KEY,body TEXT NOT NULL)');d.store.db.prepare('INSERT INTO m1_trial_activations VALUES (?,?)').run(activation.id,JSON.stringify({markerHash:hash(marker)}));
  return{...d,dir,j,forecaster,model,protocol,marker,hybrid,closeAll:()=>{j.close();d.close();rmSync(dir,{recursive:true,force:true});}};
}
test('M1 live routes use immutable matched pre-tip records; 3PM distribution and old objects are unchanged',()=>{
  const d=setup();try{
    const baseline=legacyProductionRouting(d.store,d.at,[d.event.id]);const cycle=d.forecaster.cycle(d.store,10000,8);assert.equal(cycle.inserted,4,JSON.stringify(cycle));
    assert.equal(d.j.db.prepare('SELECT count(*) n FROM m1_trial_ready').get()!.n,3);
    d.store.set('production:m1-trial',d.marker);const r=productionRouting(d.store,d.at,[d.event.id]);assert.equal(r.forecasts.length,4,JSON.stringify(r.decisions));
    assert.equal(hash(r.forecasts.find(f=>f.prop==='threes')),hash(baseline.forecasts.find(f=>f.prop==='threes')));
    for(const f of r.forecasts.filter(f=>f.prop!=='threes')){assert.equal(f.modelVersion,M1_VERSION);assert.doesNotThrow(()=>currentPlayerEvidence(d.store,f,d.at));}
    const shadow=d.j.db.prepare('SELECT body FROM engineering_predictions').all().map(r=>JSON.parse(String(r.body)));assert.equal(shadow.length,4);assert.ok(shadow.every(p=>!p.dispatchAllowed&&!p.productionEnabled));
    assert.equal(d.forecaster.cycle(d.store,10000,8).inserted,0);assert.throws(()=>d.j.db.exec('DELETE FROM m1_trial_ready'),/immutable/);
    assert.throws(()=>assertProtocol({...d.protocol,calibration:'TUNED'} as any),/CHANGED/);
    const report=trialReview(d.store,d.j,d.marker,d.at);assert.equal(report.populations.allProspective,4);assert.equal(report.status,'OBSERVING_FUTURE_OUTCOMES_PENDING');assert.equal(report.confirmedCash.profitAUD,null);assert.equal(report.quality.groups.length,0);
  }finally{d.closeAll();}
});
test('active trial never falls back its missing/stale M1 routes; disabled routing is identical',()=>{
  const d=setup();try{
    const old=productionRouting(d.store,d.at,[d.event.id]);d.store.set('production:m1-trial',d.marker);assert.deepEqual(productionRouting(d.store,d.at,[d.event.id]).forecasts.map(f=>f.prop),['threes']);
    d.forecaster.cycle(d.store,10000,8);const f=productionRouting(d.store,d.at,[d.event.id]).forecasts.find(f=>f.prop==='points')!;
    d.store.set('live:injury:70',{status:'Questionable',observedAt:d.at,source:d.retain({data:[{player:{id:70},status:'Questionable'}]},'https://api.balldontlie.io/nba/v1/player_injuries')});
    assert.throws(()=>assertTrialFreshness(d.store,f,d.at),/REFRESH/);assert.deepEqual(productionRouting(d.store,d.at,[d.event.id]).forecasts.map(f=>f.prop),['threes']);
    d.store.db.prepare("DELETE FROM meta WHERE key='production:m1-trial'").run();assert.equal(hash(productionRouting(d.store,d.at,[d.event.id])),hash(old));assert.throws(()=>currentPlayerEvidence(d.store,f,d.at),/NO_LONGER_ACTIVE/);
  }finally{d.closeAll();}
});
test('material teammate news creates a new immutable revision; refreshes are not new independent forecasts',()=>{
  const d=setup();try{
    d.forecaster.cycle(d.store,10000,8);const before=d.j.db.prepare('SELECT id,body FROM engineering_predictions ORDER BY id').all();
    const later=new Date(Date.parse(d.at)+1000).toISOString();d.setAt(later);const source=d.retain({data:[{player:{id:71},status:'Out'}]},'https://api.balldontlie.io/nba/v1/player_injuries',later);
    const roster=d.retain({data:[{id:71,team:{id:1}}]},'https://api.balldontlie.io/nba/v1/players/active',later);d.store.set('live:roster:71',{playerId:'bdl:nba:player:71',teamId:d.event.homeId,source:roster,observedAt:later});d.store.set('live:injury:71',{status:'Out',observedAt:later,source});
    d.forecaster.cycle(d.store,10000,8);assert.equal(d.j.db.prepare('SELECT count(*) n FROM engineering_predictions').get()!.n,8);
    for(const r of before)assert.equal(d.j.db.prepare('SELECT body FROM engineering_predictions WHERE id=?').get(r.id)!.body,r.body);
    const review=trialReview(d.store,d.j,d.marker,later);assert.equal(review.populations.allProspective,4);assert.equal(review.populations.forecastRevisions,8);
  }finally{d.closeAll();}
});
test('same-UTC-day completed received finals are usable; target/future receipts stay excluded',()=>{
  const d=setup();try{
    const startsAt=new Date(Date.parse(d.at)-4*3600000).toISOString(),received=new Date(Date.parse(d.at)-3600000).toISOString();
    const l={...d.logs[0],event:{...d.event,id:'TEST-ONLY earlier today',startsAt},observedAt:received,source:d.retain({label:'TEST-ONLY same day final'},'https://test.invalid/same-day',received),final:true};d.store.ingest([l],d.at);
    const rows=retainedRows(d.store,d.at),f=generationFeatures(rows,d.at)({event:d.event,playerId:l.playerId,teamId:l.teamId},'points')!;
    assert.ok(f.history.some(r=>r.log.event.id===l.event.id));
    const target={...l,event:d.event,source:d.retain({label:'TEST-ONLY impossible future target outcome'},'https://test.invalid/target',d.at)};assert.throws(()=>d.store.ingest([target],d.at),/chronology/);
    const f2=generationFeatures([...retainedRows(d.store,d.at),{log:target,metadata:target.research!,ref:{id:'TEST-ONLY future',bodyHash:hash(target)}}],d.at)({event:d.event,playerId:l.playerId,teamId:l.teamId},'points')!;assert.ok(!f2.history.some(r=>r.log.event.id===d.event.id));
    const cycle=d.forecaster.cycle(d.store,10000,8);assert.equal(cycle.inserted,4,JSON.stringify(cycle));
  }finally{d.closeAll();}
});
test('source/acquisition ownership and uncertain debits yield cached worker without source mutation',()=>{
  const d=setup();try{const sourceBefore=hash(d.store.db.prepare('SELECT * FROM meta ORDER BY key').all());d.store.acquire('experimental-cycle',d.at,60);assert.equal(trialIdle(d.store,d.at),false);assert.equal(d.forecaster.cycle(d.store).inserted,0);assert.equal(hash(d.store.db.prepare('SELECT * FROM meta ORDER BY key').all()),sourceBefore);}finally{d.closeAll();}
});
test('Melbourne two-complete-day window excludes partial slates and handles daylight savings',()=>{
  const event=(id:string,startsAt:string)=>({id,startsAt,league:'NBA'} as Event);
  const w=reviewWindow('2026-11-24T23:15:00Z',[event('TEST-ONLY1','2026-11-24T23:00:00Z'),event('TEST-ONLY2','2026-11-25T01:00:00Z'),event('TEST-ONLY3','2026-11-26T00:00:00Z'),event('TEST-ONLY4','2026-11-27T00:00:00Z')]);
  assert.deepEqual(w.operatingDates,['2026-11-26','2026-11-27']);assert.deepEqual(w.partialDates,['2026-11-25']);assert.equal(w.endExclusive,'2026-11-27T13:00:00.000Z');
  assert.equal(melbourneMidnight('2026-04-05'),'2026-04-04T13:00:00.000Z');assert.equal(melbourneMidnight('2026-04-06'),'2026-04-05T14:00:00.000Z');
});
test('stopped-market trial rollback rejects live owners/uncertain sends and preserves immutable bodies',()=>{
  const d=setup();try{
    const authority={ownerReference:'TEST-ONLY',protocolId:d.protocol.id,marketPID:123,at:d.at,expiresAt:new Date(Date.parse(d.at)+60000).toISOString()};
    d.store.set('production:m1-trial',d.marker);assert.throws(()=>drainTrialRollback(d.store,authority,d.at,()=>({processPresent:true,labelPresent:false})),/STOPPED/);
    const before=hash(d.store.db.prepare('SELECT id,body FROM experimental_forecasts ORDER BY id').all());const r=drainTrialRollback(d.store,authority,d.at,()=>({processPresent:false,labelPresent:false}));assert.equal(r.sourceRestored,false);assert.equal(d.store.get('production:m1-trial'),null);assert.equal(hash(d.store.db.prepare('SELECT id,body FROM experimental_forecasts ORDER BY id').all()),before);
  }finally{d.closeAll();}
});
test('expired or replaced journal owner cannot publish, including within an open writer transaction',()=>{
  const d=setup();try{
    const set=(token:string,expiresAt:string)=>d.j.db.prepare("INSERT INTO engineering_runtime VALUES ('trial-owner',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({token,expiresAt}));
    set('TEST-ONLY owner',new Date(Date.parse(d.at)+60000).toISOString());const fence=fenceTrialJournal(d.j,'TEST-ONLY owner',d.clock);
    d.j.hold({label:'TEST-ONLY valid owner'},'TEST-ONLY');d.setAt(new Date(Date.parse(d.at)+61000).toISOString());assert.throws(()=>d.j.hold({},'EXPIRED'),/OWNERSHIP_LOST/);
    fence.raw.prepare("UPDATE engineering_runtime SET value=? WHERE key='trial-owner'").run(JSON.stringify({token:'TEST-ONLY replacement',expiresAt:new Date(Date.parse(d.at)+120000).toISOString()}));
    assert.throws(()=>d.j.db.exec('BEGIN IMMEDIATE'),/OWNERSHIP_LOST/);assert.equal(d.j.db.isTransaction,false);assert.equal(d.j.db.prepare('SELECT count(*) n FROM engineering_holds').get()!.n,1);
  }finally{d.closeAll();}
});
test('changing material news between bounded batches cannot starve later prop targets',()=>{
  const d=setup();try{
    for(let i=0;i<4;i++){const at=new Date(Date.parse(d.at)+i*1000).toISOString();d.setAt(at);const status=i%2?'Questionable':'Available',source=d.retain({data:[{player:{id:70},status}]},'https://api.balldontlie.io/nba/v1/player_injuries',at);d.store.set('live:injury:70',{status,source,observedAt:at});assert.equal(d.forecaster.cycle(d.store,10000,1).inserted,1);}
    assert.equal(d.j.db.prepare('SELECT count(DISTINCT prop) n FROM engineering_predictions').get()!.n,4);
  }finally{d.closeAll();}
});
test('identical relevant facts with later source clocks keep a forecast usable while current freshness still applies',()=>{
  const d=setup();try{d.forecaster.cycle(d.store,10000,8);d.store.set('production:m1-trial',d.marker);const f=productionRouting(d.store,d.at,[d.event.id]).forecasts.find(f=>f.prop==='points')!;
    const at=new Date(Date.parse(d.at)+60000).toISOString();d.setAt(at);const fixture=d.store.get<any>('live:fixture:100'),source=d.retain({data:[d.rawGame],meta:{}},'https://api.balldontlie.io/nba/v1/games',at);d.store.set('live:fixture:100',{...fixture,source});
    d.store.set('live:injuries-complete',{at,source:d.retain({data:[],meta:{}},'https://api.balldontlie.io/nba/v1/player_injuries',at)});assert.doesNotThrow(()=>currentPlayerEvidence(d.store,f,at));
    d.setAt(new Date(Date.parse(at)+4*3600000+1).toISOString());assert.throws(()=>currentPlayerEvidence(d.store,f,d.clock()),/injury|fixture/i);
  }finally{d.closeAll();}
});
test('verified immutable reference cache is restricted to a physically read-only source and remains cutoff-bound',async()=>{
  const d=setup();let ro:EfficientStore|undefined;try{const path=d.dir+'/source-test-only.sqlite';await backup(d.store.db,path);ro=new EfficientStore(path,true);assert.equal(ro.physicalReadOnly,true);assert.throws(()=>ro!.db.prepare("DELETE FROM logs").run(),/readonly/);const f=new TrialForecaster(d.protocol,d.model,d.hybrid,d.j,d.clock);assert.equal(f.cycle(ro,10000,8).inserted,4);assert.equal(f.cycle(ro,10000,8).inserted,0);}finally{ro?.close();d.closeAll();}
});
