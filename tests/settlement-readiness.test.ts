import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './support/suggestions-fixture';
import {rankAndIssue,settleSuggestions,suggestions} from '../src/suggestions/engine';
import {readBetLog,betLogCSV} from '../src/suggestions/bet-log';
import {settlementReadiness} from '../src/suggestions/settlement-readiness';

test('missing final rows remain explicitly unresolved rather than a successful zero-held grading result',()=>{
 const d=fixture();try{rankAndIssue(d.store,d.config,d.quotes,d.terms,d.clock());const issues=suggestions(d.store);assert.ok(issues.length);
 const before=d.store.db.prepare('SELECT body FROM experimental_suggestions ORDER BY id').all(),r=settleSuggestions(d.store,d.clock());
 assert.equal(r.settled,0);assert.equal(r.held.length,0);assert.equal(r.pendingFinalEvidence.length,issues.length);assert.deepEqual(new Set(r.pendingFinalEvidence.map(x=>x.id)),new Set(issues.map(x=>x.id)));
 assert.ok(readBetLog(d.store,d.clock()).rows.every(r=>r.settlementState==='pending_final_evidence'&&r.result===null));assert.deepEqual(d.store.db.prepare('SELECT body FROM experimental_suggestions ORDER BY id').all(),before);
 }finally{d.close();}
});
test('valid finals show pending processing before idempotent grading; CSV and immutable issues preserve original inputs',()=>{
 const d=fixture();try{rankAndIssue(d.store,d.config,d.quotes,d.terms,d.clock());const at=new Date(Date.parse(d.event.startsAt)+4*3600000).toISOString(),before=d.store.db.prepare('SELECT body FROM experimental_suggestions ORDER BY id').all(),source=d.retain({label:'TEST-ONLY verified final'},'https://example.invalid/final',at,'TEST-ONLY');
 d.store.ingest([{...d.logs[0],event:d.event,source,observedAt:at,stats:{points:22,rebounds:8,assists:6,threes:3}}],at);
 const preview=readBetLog(d.store,at);assert.ok(preview.rows.every(r=>r.settlementState==='pending_processing'&&r.result===null));const csv=betLogCSV(preview);assert.ok(!csv.includes('pending_processing'));assert.ok(csv.includes('pending'));
 const result=settleSuggestions(d.store,at);assert.equal(result.settled,preview.rows.length);assert.equal(result.pendingFinalEvidence.length,0);assert.equal(settleSuggestions(d.store,at).settled,0);assert.ok(readBetLog(d.store,at).rows.every(r=>r.settlementState===r.result));assert.deepEqual(d.store.db.prepare('SELECT body FROM experimental_suggestions ORDER BY id').all(),before);
 }finally{d.close();}
});
test('identity conflicts are disputed, missing participation remains pending, and a retained DNP awaits normal void grading',()=>{
 const d=fixture();try{rankAndIssue(d.store,d.config,d.quotes,d.terms,d.clock());const issue=suggestions(d.store)[0];assert.ok(issue);let at=new Date(Date.parse(d.event.startsAt)+4*3600000).toISOString();
 const add=(extra:any)=>{const source=d.retain({label:'TEST-ONLY revision',at,extra},'https://example.invalid/final',at,'TEST-ONLY');d.store.ingest([{...d.logs[0],event:d.event,source,observedAt:at,...extra}],at);};
 add({teamId:d.event.awayId});assert.equal(settlementReadiness(d.store,issue,undefined,at).state,'disputed');
 at=new Date(Date.parse(at)+60000).toISOString();add({participated:null});assert.equal(settlementReadiness(d.store,issue,undefined,at).state,'pending_final_evidence');
 at=new Date(Date.parse(at)+60000).toISOString();add({participated:false,minutes:0,stats:{points:null,rebounds:null,assists:null,threes:null}});assert.equal(settlementReadiness(d.store,issue,undefined,at).state,'pending_processing');settleSuggestions(d.store,at);assert.ok(readBetLog(d.store,at).rows.every(r=>r.result==='void'));
 }finally{d.close();}
});
