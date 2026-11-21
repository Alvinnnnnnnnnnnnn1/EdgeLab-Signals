import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store';
import { hash,type GameLog,type Event,type Context } from '../src/core/domain';
import { recordProspective,scoreProspective } from '../src/research/prospective';
import { modelSpec,RESEARCH_VERSION } from '../src/research/models';
import { artifactSchema } from '../src/research/inference';

const at='2026-11-21T10:00:00.000Z';
function setup(){
  const store=new Store(':memory:');
  function source(body:unknown,retrievedAt=at){const text=JSON.stringify({label:'TEST-ONLY mocked response',body}),r={provider:'balldontlie',endpoint:'https://api.balldontlie.io/nba/v1/games',retrievedAt,publishedAt:null,hash:hash(text),simulated:false};store.receipt(r,text);return r;}
  const event:Event={id:'bdl:nba:game:100',league:'NBA',season:'2026',homeId:'bdl:nba:team:1',awayId:'bdl:nba:team:2',home:'TEST-ONLY Home',away:'TEST-ONLY Away',startsAt:'2026-11-22T01:00:00.000Z'};
  const logs:GameLog[]=Array.from({length:14},(_,i)=>{
    const startsAt=new Date(Date.UTC(2026,9,1+i*2)).toISOString(),observedAt=new Date(Date.parse(startsAt)+4*3600000).toISOString(),receipt=source({id:i},observedAt);
    return{event:{...event,id:`bdl:nba:game:${i+1}`,startsAt},playerId:'bdl:nba:player:70',player:'TEST-ONLY Player',teamId:event.homeId,completedAt:null,observedAt,minutes:30,participated:true,stats:{points:20,rebounds:5,assists:4,threes:2},final:true,source:receipt,research:{phase:'regular',overtimePeriods:0,threeAttempts:5,rosterOpportunityVerified:false}};
  });
  store.ingest(logs,at);
  const context:Context={eventId:event.id,playerId:'bdl:nba:player:70',teamId:event.homeId,status:'available',expectedMinutes:30,minutesSD:2,observedAt:at,source:source({available:true}),rosterVerified:true,opponentRateFactor:null,homeRateFactor:null,roleNote:null};
  const artifact=artifactSchema.parse({protocol:'chronological-challenge/1.1.0',modelVersion:RESEARCH_VERSION,datasetId:hash('TEST-ONLY dataset'),generatedAt:'2026-11-20T01:00:00.000Z',trainedBefore:'2026-10-05',selectedAt:'2026-10-10',calibrationBefore:'2026-10-15',testIds:hash('TEST-ONLY test rows'),bestSimple:modelSpec('ewa'),selected:modelSpec('hierarchical-nb'),calibration:{method:'raw'},featureNames:['last5','last10','ewa','seasonShrunk','minutes','minutesSD','rate','restDays','home','teamChanged']});
  return{store,event,context,logs,source,models:[{prop:'points' as const,artifact,artifactHash:hash(artifact)}],events:[{event,source:source(event)}]};
}
test('prospective forecasts freeze genuine pregame inputs once without prices, recommendations or messages',()=>{
  const d=setup();try{
    const result=recordProspective(d.store,d.models,d.events,[d.context],at);assert.equal(result.inserted,1);assert.equal(result.networkRequests,0);assert.equal(result.outboundMessages,0);
    const rows=d.store.db.prepare('SELECT body FROM prospective_forecasts').all() as {body:string}[];const record=JSON.parse(rows[0].body);
    assert.equal(record.conditionalOnParticipating,true);assert.equal(record.participationProbability,null);assert.equal(record.promotionEligible,false);assert.equal(record.inputHash,hash(record.inputs));assert.equal(record.inputs.inputRefs.length,14);
    assert.ok(Math.abs(record.distribution.reduce((n:number,p:number)=>n+p,0)-1)<1e-8);assert.equal(d.store.signals().length,0);assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM outbox').get()!.n,0);
    const repeat=recordProspective(d.store,d.models,d.events,[d.context],at);assert.equal(repeat.inserted,0);assert.equal(repeat.existing,1);
    assert.throws(()=>d.store.db.prepare('UPDATE prospective_forecasts SET at=?').run(at),/immutable/);assert.throws(()=>d.store.db.prepare('DELETE FROM prospective_forecasts').run(),/removed/);
  }finally{d.store.close();}
});
test('missing, stale, future or nonpositive availability cannot produce a prospective forecast',()=>{
  const d=setup();try{
    assert.equal(recordProspective(d.store,d.models,[],[],at).state,'blocked');
    for(const change of [{status:'unknown' as const},{rosterVerified:false},{expectedMinutes:null},{expectedMinutes:0},{observedAt:'2026-11-21T09:00:00.000Z'},{observedAt:'2026-11-21T11:00:00.000Z'},{teamId:'bdl:nba:team:3'}]){
      const result=recordProspective(d.store,d.models,d.events,[{...d.context,...change}],at);assert.equal(result.inserted,0);assert.equal(result.state,'blocked');
    }
    assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM prospective_forecasts').get()!.n,0);
  }finally{d.store.close();}
});
test('post-tip events, missing source bytes, changed artifacts and insufficient histories fail closed',()=>{
  const d=setup();try{
    const late=[{...d.events[0],event:{...d.event,startsAt:'2026-11-21T09:00:00.000Z'}}];assert.equal(recordProspective(d.store,d.models,late,[d.context],at).inserted,0);
    const missing=[{...d.events[0],source:{...d.events[0].source,hash:'0'.repeat(64)}}];assert.equal(recordProspective(d.store,d.models,missing,[d.context],at).inserted,0);
    assert.throws(()=>recordProspective(d.store,[{...d.models[0],artifactHash:'0'.repeat(64)}],d.events,[d.context],at),/artifact/);
    assert.equal(recordProspective(d.store,d.models,d.events,[{...d.context,playerId:'bdl:nba:player:71'}],at).inserted,0);
  }finally{d.store.close();}
});
test('later genuine finals and corrections can score a frozen forecast without rewriting it',()=>{
  const d=setup();try{
    recordProspective(d.store,d.models,d.events,[d.context],at);
    const original=d.store.db.prepare('SELECT body FROM prospective_forecasts').get()!.body;
    const before=scoreProspective(d.store,at);assert.equal(before.groups.length,0);assert.equal(before.frozenRecords,1);
    for(const [points,observedAt] of [[25,'2026-11-22T05:00:00.000Z'],[10,'2026-11-23T05:00:00.000Z']] as const){
      const final={...d.logs[0],event:d.event,observedAt,source:d.source({points},observedAt),stats:{...d.logs[0].stats,points}};
      d.store.ingest([final],observedAt);const scored=scoreProspective(d.store,observedAt);assert.equal(scored.groups[0].metrics!.playerGames,1);assert.equal(scored.groups[0].paired.clusters,1);assert.equal(scored.promotionEligible,false);
    }
    assert.equal(d.store.db.prepare('SELECT body FROM prospective_forecasts').get()!.body,original);
    assert.throws(()=>d.store.db.prepare('DELETE FROM logs').run(),/cannot be removed/);
  }finally{d.store.close();}
});
