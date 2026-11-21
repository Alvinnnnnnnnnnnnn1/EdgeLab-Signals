import test from 'node:test';
import assert from 'node:assert/strict';
import { Store,type Signal } from '../src/core/store';
import { configSchema } from '../src/core/config';
import { Telegram,enqueueTelegramCanary,dispatchTelegramStatus,enqueueResearchDigest } from '../src/core/telegram';

function setup(send?:(n:number)=>Promise<Response>){
  const store=new Store(':memory:'),config=configSchema.parse({networkEnabled:true,telegram:{allowlist:['123']}}),old={token:process.env.TELEGRAM_BOT_TOKEN,chat:process.env.TELEGRAM_CHAT_ID};process.env.TELEGRAM_BOT_TOKEN='TEST_ONLY_TOKEN';process.env.TELEGRAM_CHAT_ID='123';let at='2026-11-21T12:00:00.000Z',sends=0;
  const transport=new Telegram(config,store,async input=>{const method=new URL(input).pathname.split('/').at(-1);if(method==='getMe')return Response.json({ok:true,result:{id:7,is_bot:true}});if(method==='getChat')return Response.json({ok:true,result:{id:123,type:'private'}});sends++;return send?send(sends):Response.json({ok:true,result:{message_id:88,chat:{id:123,type:'private'}}});},()=>at);
  return{store,config,transport,clock:()=>at,tick:(ms:number)=>{at=new Date(Date.parse(at)+ms).toISOString();},sends:()=>sends,close:()=>{store.close();for(const [k,v] of [['TELEGRAM_BOT_TOKEN',old.token],['TELEGRAM_CHAT_ID',old.chat]])if(v===undefined)delete process.env[k!];else process.env[k!]=v;}};
}
test('integrated canary verifies exact private destination, persists acceptance and prevents duplicate sends',async()=>{
  const d=setup();try{await d.transport.verify();const id=enqueueTelegramCanary(d.store,d.clock());const result=await dispatchTelegramStatus(d.store,d.config,d.transport,{canaryId:id,clock:d.clock});assert.equal(result.accepted,1);assert.equal(d.sends(),1);assert.equal((await d.transport.status()).deliveredAt,null);
    assert.equal((await dispatchTelegramStatus(d.store,d.config,d.transport,{canaryId:enqueueTelegramCanary(d.store,d.clock()),clock:d.clock})).accepted,0);assert.equal(d.sends(),1);assert.equal(d.config.deliveryEnabled,false);assert.equal(d.config.telegram.statusEnabled,false);
    assert.throws(()=>d.store.db.prepare('UPDATE telegram_outbox SET body=?').run('{}'),/immutable/);
  }finally{d.close();}
});
test('unknown send outcomes and interrupted claims are never blindly retried or logged with credentials',async()=>{
  const d=setup(async()=>{throw new Error('https://api.telegram.org/botTEST_ONLY_TOKEN/sendMessage private chat 123');});try{await d.transport.verify();const id=enqueueTelegramCanary(d.store,d.clock());await dispatchTelegramStatus(d.store,d.config,d.transport,{canaryId:id,clock:d.clock});assert.equal(d.store.db.prepare('SELECT state FROM telegram_outbox').get()!.state,'uncertain');await dispatchTelegramStatus(d.store,d.config,d.transport,{canaryId:id,clock:d.clock});assert.equal(d.sends(),1);
    const row=JSON.stringify(d.store.db.prepare('SELECT * FROM telegram_outbox').get());assert.ok(!row.includes('TEST_ONLY_TOKEN'));assert.ok(!row.includes('private chat 123'));
    d.store.db.prepare("UPDATE telegram_outbox SET state='sending'").run();await dispatchTelegramStatus(d.store,d.config,d.transport,{canaryId:id,clock:d.clock});assert.equal(d.sends(),1);assert.equal(d.store.db.prepare('SELECT state FROM telegram_outbox').get()!.state,'uncertain');
  }finally{d.close();}
});
test('Telegram 429 defers a bounded retry, whereas status delivery cannot enable qualified transport',async()=>{
  const d=setup(async n=>n===1?Response.json({ok:false,error_code:429,parameters:{retry_after:2}},{status:429}):Response.json({ok:true,result:{message_id:89,chat:{id:123,type:'private'}}}));try{await d.transport.verify();const id=enqueueTelegramCanary(d.store,d.clock());await dispatchTelegramStatus(d.store,d.config,d.transport,{canaryId:id,clock:d.clock});assert.equal(d.store.db.prepare('SELECT state FROM telegram_outbox').get()!.state,'retryable_failed');await dispatchTelegramStatus(d.store,d.config,d.transport,{canaryId:id,clock:d.clock});assert.equal(d.sends(),1);d.tick(3000);assert.equal((await dispatchTelegramStatus(d.store,d.config,d.transport,{canaryId:id,clock:d.clock})).accepted,1);assert.equal(d.sends(),2);
    await assert.rejects(d.transport.send({simulated:false,decision:{qualified:true}} as Signal,'invalid opportunity'),/disabled_or_ineligible/);assert.equal(d.sends(),2);
  }finally{d.close();}
});
test('status digests require an actual journal and explicit opt-in; nonallowlisted destinations fail',async()=>{
  const d=setup();try{assert.throws(()=>enqueueResearchDigest(d.store,'missing',d.clock()),/journal/);await d.transport.verify();d.store.db.prepare('INSERT INTO research_runs VALUES (?,?,?)').run('run',d.clock(),JSON.stringify({state:'deferred',fixturesReviewed:2,playersExamined:3,forecastsFrozen:0,forecastsGraded:0,playersExcluded:3,marketStatus:'MARKET_DATA_NOT_AUTHORISED'}));enqueueResearchDigest(d.store,'run',d.clock());await dispatchTelegramStatus(d.store,d.config,d.transport,{clock:d.clock});assert.equal(d.sends(),0);
    process.env.TELEGRAM_CHAT_ID='456';await assert.rejects(d.transport.verify(),/not_allowlisted/);assert.equal(d.transport.verified(),false);
  }finally{d.close();}
});

test('routine digest survives quiet hours and restarts, then drains once at 07:00 without consuming overnight attempts',async()=>{
  const d=setup();try{
    d.config.telegram.statusEnabled=true;await d.transport.verify();d.tick(2*3600000); // 01:00 Melbourne
    d.store.db.prepare('INSERT INTO research_runs VALUES (?,?,?)').run('overnight',d.clock(),JSON.stringify({state:'deferred',fixturesReviewed:2,playersExamined:3,forecastsFrozen:0,forecastsGraded:0,playersExcluded:3,marketStatus:'MARKET_DATA_NOT_AUTHORISED'}));
    const id=enqueueResearchDigest(d.store,'overnight',d.clock());await dispatchTelegramStatus(d.store,d.config,d.transport,{clock:d.clock});
    let row=d.store.db.prepare('SELECT state,attempts,next_at FROM telegram_outbox WHERE id=?').get(id)!;assert.equal(row.state,'pending');assert.equal(row.attempts,0);assert.equal(row.next_at,'2026-11-21T20:00:00.000Z');assert.equal(d.sends(),0);
    d.tick(6*3600000-1000);await dispatchTelegramStatus(d.store,d.config,d.transport,{clock:d.clock});assert.equal(d.sends(),0);
    d.tick(1000);await dispatchTelegramStatus(d.store,d.config,d.transport,{clock:d.clock});await dispatchTelegramStatus(d.store,d.config,d.transport,{clock:d.clock});
    row=d.store.db.prepare('SELECT state,attempts FROM telegram_outbox WHERE id=?').get(id)!;assert.equal(row.state,'accepted');assert.equal(row.attempts,1);assert.equal(d.sends(),1);
  }finally{d.close();}
});
test('Telegram opportunity policy expires early fixtures instead of releasing them after quiet hours',()=>{
  const d=setup();try{d.tick(2*3600000);const signal={decision:{quote:{quotedAt:d.clock(),expiresAt:'2026-11-21T14:03:00.000Z',event:{startsAt:'2026-11-21T17:00:00.000Z'}}}} as Signal;
    assert.equal(d.transport.deliveryWindow(signal,d.clock()).state,'expired');assert.equal(d.sends(),0);
  }finally{d.close();}
});

test('crossing 00:30 between outbox claim and transport preserves the queued digest',async()=>{
  const d=setup();try{d.config.telegram.statusEnabled=true;await d.transport.verify();d.tick(90*60000);
    d.store.db.prepare('INSERT INTO research_runs VALUES (?,?,?)').run('boundary',d.clock(),JSON.stringify({state:'completed',fixturesReviewed:0,playersExamined:0,forecastsFrozen:0,forecastsGraded:0,playersExcluded:0,marketStatus:'MARKET_DATA_NOT_AUTHORISED'}));
    const id=enqueueResearchDigest(d.store,'boundary','2026-11-21T13:29:59.000Z');
    await dispatchTelegramStatus(d.store,d.config,d.transport,{clock:()=> '2026-11-21T13:29:59.000Z'});
    const row=d.store.db.prepare('SELECT state,attempts,next_at FROM telegram_outbox WHERE id=?').get(id)!;assert.equal(row.state,'pending');assert.equal(row.attempts,0);assert.equal(row.next_at,'2026-11-21T20:00:00.000Z');assert.equal(d.sends(),0);
  }finally{d.close();}
});
