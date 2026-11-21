import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { syntheticData,DEMO_AT } from '../src/demo';
import { features,preparedFeatures } from '../src/research/features';
import { predict,modelSpec } from '../src/research/models';
import { bdlPhase } from '../src/providers/balldontlie';
import { createDataset } from '../src/research/dataset';
import { benchmarkRun } from '../src/research/benchmark-run';
import { runExperiment } from '../src/research/experiment';
import { summary,attemptMakeDistribution,betaBinomial } from '../src/research/distributions';

test('zero observed player attempts are prior-smoothed without discarding the player; missing references stay unsupported',()=>{
  const store=new Store(':memory:'),d=syntheticData(store),rows=d.logs.map(log=>({log,metadata:{phase:'regular' as const,overtimePeriods:0,threeAttempts:6,rosterOpportunityVerified:false}}));
  try{const f=features(rows,{...d.logs[0],event:d.event},'threes','as-of')!,zero={...f,history:f.history.map(r=>({...r,log:{...r.log,stats:{...r.log.stats,threes:0}},metadata:{...r.metadata,threeAttempts:0}}))};
    const result=predict(zero,modelSpec('attempts-beta-binomial'));assert.ok(result);assert.ok(summary(result.pmf).mean>0);assert.ok(result.pmf.every(v=>Number.isFinite(v)&&v>=0));
    assert.equal(predict({...zero,history:zero.history.map(r=>({...r,metadata:{...r.metadata,threeAttempts:null}}))},modelSpec('attempts-beta-binomial')),null);
    const sparse={...zero,history:zero.history.map((r,i)=>i? r:{...r,metadata:{...r.metadata,threeAttempts:1}})};assert.ok(predict(sparse,modelSpec('attempts-beta-binomial')));
    assert.equal(predict({...zero,leagueHistory:zero.history},modelSpec('attempts-beta-binomial')),null);
  }finally{store.close();}
});
test('indexed chronological features are numerically identical across props, revisions and strict observation cutoffs',()=>{
  const store=new Store(':memory:'),d=syntheticData(store),rows=d.logs.map(log=>({log,metadata:{phase:'regular' as const,overtimePeriods:0,threeAttempts:6,rosterOpportunityVerified:true}}));
  try{for(const mode of ['as-of','retrospective'] as const){const get=preparedFeatures(rows,mode);for(const prop of ['points','rebounds','assists','threes'] as const)for(const target of [rows[20].log,rows[50].log,{...rows[0].log,event:d.event}])assert.deepEqual(get(target,prop),features(rows,target,prop,mode));}
    const correction=structuredClone(rows[0]);correction.log.stats.points=149;correction.log.observedAt=DEMO_AT;correction.log.source.retrievedAt=DEMO_AT;const revised=[...rows,correction],get=preparedFeatures(revised,'as-of');assert.deepEqual(get(rows[50].log,'points'),features(revised,rows[50].log,'points','as-of'));
  }finally{store.close();}
});
test('NBA Cup group, quarterfinal and semifinal games are regular; championship and unknown stages remain distinct',()=>{
  for(const ist_stage of ['East Group A','West Group C','East Quarterfinal','West Semifinal','Group Play','Quarterfinals','Semifinals'])assert.equal(bdlPhase({postseason:false,ist_stage}),'regular');
  assert.equal(bdlPhase({postseason:false,ist_stage:'Championship'}),'cup');assert.equal(bdlPhase({ist_stage:'Future Unsupported Stage'}),'unknown');assert.equal(bdlPhase({season_type:'ist'}),'unknown');assert.equal(bdlPhase({postseason:true}),'playoffs');assert.equal(bdlPhase({season_type:'preseason'}),'preseason');
});
test('attempt/make mixture preserves broad predictive tails and stable beta-binomial mass',()=>{assert.ok(summary(attemptMakeDistribution(12,90,40,70)).mean>0);const p=betaBinomial(200,3000,5);assert.ok(p.every(v=>Number.isFinite(v)&&v>=0));assert.ok(Math.abs(summary(p).mean-200*3000/3005)<1e-7);});
test('benchmark failure preserves completed props and resume verifies hashes and skips them',()=>{
  const store=new Store(':memory:'),dataset=createDataset(store,[],['TEST-ONLY empty genuine audit'],DEMO_AT),directory=mkdtempSync(join(tmpdir(),'edgelab-benchmark-'));let calls=0;
  try{const runner:typeof runExperiment=(...args)=>{calls++;if(args[2]==='threes')throw new Error('Missing attempts-beta-binomial prediction on common row');return runExperiment(...args);};
    const first=benchmarkRun(store,dataset,{mode:'retrospective',directory,runner,clock:()=>DEMO_AT});assert.equal(first.state,'failed');assert.equal(first.jobs['NBA:points'].state,'blocked');assert.equal(first.jobs['NBA:threes'].state,'failed');const original=readFileSync(first.jobs['NBA:points'].path!,'utf8');
    calls=0;const resumed=benchmarkRun(store,dataset,{mode:'retrospective',directory,resume:true,runner:(...args)=>{calls++;return runExperiment(...args);},clock:()=>DEMO_AT});assert.equal(calls,2);assert.equal(resumed.state,'complete');assert.equal(readFileSync(first.jobs['NBA:points'].path!,'utf8'),original);assert.ok(resumed.path);
    assert.throws(()=>benchmarkRun(store,dataset,{mode:'retrospective',directory,clock:()=>DEMO_AT}),/--resume/);
    const path=first.jobs['NBA:points'].path!;writeFileSync(path,JSON.stringify({...JSON.parse(readFileSync(path,'utf8')),generatedAt:'2026-01-01T00:00:00Z'}));assert.throws(()=>benchmarkRun(store,dataset,{mode:'retrospective',directory,resume:true,clock:()=>DEMO_AT}),/integrity mismatch/);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
