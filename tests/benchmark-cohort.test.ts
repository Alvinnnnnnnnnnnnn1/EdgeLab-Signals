import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store';
import { hash,type GameLog } from '../src/core/domain';
import { createDataset } from '../src/research/dataset';
import { runExperiment } from '../src/research/experiment';

test('target-season evaluation retains older genuine history while freezing a separate target cohort',()=>{
  const store=new Store(':memory:'),at='2026-11-21T01:00:00.000Z';
  try{
    const body=JSON.stringify({label:'TEST-ONLY mocked historical source'}),source={provider:'balldontlie',endpoint:'https://api.balldontlie.io/nba/v1/stats',retrievedAt:at,publishedAt:null,hash:hash(body),simulated:false};store.receipt(source,body);
    const logs:GameLog[]=[2024,2026].flatMap(season=>Array.from({length:season===2024?14:20},(_,i)=>({
      event:{id:`bdl:nba:game:${season*100+i}`,league:'NBA' as const,season:String(season),homeId:'bdl:nba:team:1',awayId:'bdl:nba:team:2',home:'TEST-ONLY Home',away:'TEST-ONLY Away',startsAt:new Date(Date.UTC(season,9,i+1)).toISOString()},
      playerId:'bdl:nba:player:70',player:'TEST-ONLY Player',teamId:'bdl:nba:team:1',completedAt:null,observedAt:at,minutes:30,participated:true,stats:{points:10+i%5,rebounds:5,assists:4,threes:2},final:true,source,research:{phase:'regular' as const,overtimePeriods:0,threeAttempts:5,rosterOpportunityVerified:false},
    })));
    store.ingest(logs,at);
    const dataset=createDataset(store,logs.map(log=>({log,metadata:log.research!})),['TEST-ONLY mocked source permission'],at);
    const report=runExperiment(dataset,'NBA','points',at,'retrospective',['2026']);
    assert.equal(report.state,'evaluated');assert.equal(report.split!.dates,20);assert.deepEqual(report.cohort.targetSeasons,['2026']);
    if(report.state==='evaluated'){assert.equal(report.stageCounts.train,10);assert.equal(report.models[0].metrics.playerGames,4);assert.ok(report.frozenPredictions.every(r=>r.season==='2026'));assert.equal(report.promotion.eligible,false);}
    assert.throws(()=>runExperiment(dataset,'NBA','points',at,'retrospective',['2026–27']),/source season/);
  }finally{store.close();}
});
