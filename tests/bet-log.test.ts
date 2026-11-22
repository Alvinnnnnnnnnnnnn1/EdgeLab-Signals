import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './support/suggestions-fixture';import {hash} from '../src/core/domain';import {grade} from '../src/core/settlement';import {probabilities} from '../src/core/models';
import {readBetLog,betLogCSV} from '../src/suggestions/bet-log';import {annotateSuggestion} from '../src/suggestions/ledger';

test('complete hypothetical log handles pending, won, lost, push, void and append-only corrections without placement data',()=>{
 const d=fixture();try{
  // Accounting fixtures represent five independently issued integer-line
  // positions. They are isolated test data, not evidence of live selection.
  const original=d.quotes.find(q=>q.prop==='points'&&q.side==='over')!,source=d.retain({label:'TEST-ONLY original integer price',line:20,price:2},'https://example.invalid/TEST-ONLY/price',d.clock(),'TEST-ONLY'),q={...original,line:20,decimalOdds:2,source,retrievedAt:source.retrievedAt},f=d.fs.find(f=>f.prop==='points')!,p=probabilities(f.distribution,20,'over'),ids:string[]=[];
  for(let i=0;i<5;i++){const id=hash(['TEST-ONLY accounting issue',i]),at=new Date(Date.parse(d.clock())+i).toISOString(),s={id,at,quote:q,forecastId:f.id,forecast:f,win:p.win,push:p.push,estimatedEV:0,conservativeEV:0,disagreement:0,score:0,reasoning:'TEST-ONLY accounting position',confidence:'TEST-ONLY',terms:d.terms[0],hypotheticalStakeAUD:5,experimental:true,validated:false,supersedes:null};d.store.db.prepare('INSERT INTO experimental_suggestions VALUES (?,?,?,?)').run(id,at,`TEST-ONLY-family-${i}`,JSON.stringify(s));ids.push(id);}
  const before=d.store.db.prepare('SELECT body FROM experimental_suggestions ORDER BY rowid').all();
  for(const [index,result] of ['won','lost','push','void'].entries()){
   const at='2026-11-22T11:00:00.000Z',value=result==='won'?21:result==='lost'?19:20,stats=result==='void'?{points:null,rebounds:null,assists:null,threes:null}:{points:value,rebounds:5,assists:4,threes:2},source=d.retain({label:'TEST-ONLY final',result,stats},'https://example.invalid/TEST-ONLY/final',at,'TEST-ONLY');
   const final={...d.logs[0],event:d.event,stats,participated:result!=='void',minutes:result==='void'?0:30,source,observedAt:at,research:{...d.logs[0].research!,threeAttempts:result==='void'?null:5}},outcome=grade({id:ids[index],issuedAt:d.clock(),simulated:false,decision:{quote:q}},final,at);assert.equal(outcome.result,result);d.store.db.prepare('INSERT INTO experimental_grades VALUES (?,?,?,?)').run(outcome.id,outcome.signalId,at,JSON.stringify(outcome));
  }
  let log=readBetLog(d.store);assert.deepEqual(log.summary,{total:5,won:1,lost:1,pending:1,push:1,void:1,settled:4,profitAUD:0,turnoverAUD:20,roi:0});assert.equal(log.rows[0].cumulativeProfitAUD,5);assert.equal(log.rows[0].cumulativeROI,1);assert.equal(log.rows.at(-1)!.profitAUD,null);
  annotateSuggestion(d.store,ids[0],{placed:'placed',actualOdds:3,actualStakeAUD:100},'2026-11-22T11:05:00Z');assert.deepEqual(readBetLog(d.store).summary,log.summary);assert.ok(!JSON.stringify(log).includes('actualStake'));
  const at='2026-11-22T12:00:00.000Z',stats={points:19,rebounds:5,assists:4,threes:2},correctionSource=d.retain({label:'TEST-ONLY source correction',stats},'https://example.invalid/TEST-ONLY/corrected',at,'TEST-ONLY'),final={...d.logs[0],event:d.event,stats,source:correctionSource,observedAt:at},outcome=grade({id:ids[0],issuedAt:d.clock(),simulated:false,decision:{quote:q}},final,at);d.store.db.prepare('INSERT INTO experimental_grades VALUES (?,?,?,?)').run(outcome.id,outcome.signalId,at,JSON.stringify(outcome));
  log=readBetLog(d.store);assert.equal(log.summary.profitAUD,-10);assert.equal(log.summary.roi,-.5);assert.equal(log.summary.pending,1);assert.equal(d.store.db.prepare('SELECT count(*) AS n FROM experimental_grades').get()!.n,5);assert.deepEqual(d.store.db.prepare('SELECT body FROM experimental_suggestions ORDER BY rowid').all(),before);
  const csv=betLogCSV(log);assert.equal(csv.split('\r\n').length,6);for(const label of ['Model version','Forecast ID','Source receipt ID','pending','lost'])assert.ok(csv.includes(label));assert.ok(!csv.includes('Actual accepted odds'));assert.ok(!csv.includes('Placed'));const malicious=structuredClone(log);malicious.rows[0].player='  =HYPERLINK("bad")';assert.ok(betLogCSV(malicious).includes("'  =HYPERLINK"));
 }finally{d.close();}
});
