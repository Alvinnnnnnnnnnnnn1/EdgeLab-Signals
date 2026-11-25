import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {hash} from '../src/core/domain';
import {firstPredictions} from '../src/model-engineering/report';
test('primary reader streams metadata, excludes other fixtures and counts refreshes without loading their PMFs',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE engineering_predictions(id TEXT,model_id TEXT,event_id TEXT,player_id TEXT,prop TEXT,registered_at TEXT,body TEXT)');
 const put=db.prepare('INSERT INTO engineering_predictions VALUES (?,?,?,?,?,?,?)');
 const record={artifact:{id:'model'},state:{event:{id:'fixture'},playerId:'player'},prop:'points',distribution:[.5,.5]};
 put.run('a','model','fixture','player','points','01',JSON.stringify({...record,id:'a',bodyHash:hash(record)}));
 // Refresh bodies are deliberately not decodable: primary selection must not deserialize them.
 for(let n=0;n<500;n++)put.run('r'+n,'model','fixture','player','points','02','unread refresh PMF');
 put.run('other','model','other','player','points','01','unread other fixture');
 const x=firstPredictions(db,['fixture']);assert.equal(x.revisions,501);assert.equal(x.first.size,1);assert.equal([...x.first.values()][0].id,'a');
 const y=firstPredictions(db,[]);assert.equal(y.revisions,0);assert.equal(y.first.size,0);
 db.prepare("UPDATE engineering_predictions SET body=? WHERE id='a'").run(JSON.stringify({...record,id:'a',bodyHash:'tampered'}));
 assert.throws(()=>firstPredictions(db,['fixture']),/PREDICTION_BODY_CHANGED/);db.close();
});

test('lease contention waits without replacement, supports shutdown and surfaces other failures',async()=>{
 const {awaitTrialOwner}=await import('../src/m1-trial/service');let attempts=0,waits=0;
 assert.equal(await awaitTrialOwner(()=>{if(++attempts<3)throw Error('M1_TRIAL_ALREADY_OWNED');},()=>false,async()=>{waits++;}),true);
 assert.equal(attempts,3);assert.equal(waits,2);
 let stopped=false;assert.equal(await awaitTrialOwner(()=>{throw Error('M1_TRIAL_ALREADY_OWNED');},()=>stopped,async()=>{stopped=true;}),false);
 await assert.rejects(awaitTrialOwner(()=>{throw Error('SQLITE_FAILURE');},()=>false,async()=>{}),/SQLITE_FAILURE/);
});
