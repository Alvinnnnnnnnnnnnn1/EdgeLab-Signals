import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './support/suggestions-fixture';import {researchRows} from '../src/research/metadata';
for(const shape of ['array','object','unsupported'] as const)test(`research metadata ${shape} response preserves original source and log`,()=>{const d=fixture();try{
 const game={...d.rawGame,postseason:false,ist_stage:'East Group A'},source=d.retain({data:shape==='array'?[game]:shape==='object'?game:'TEST-ONLY invalid shape'},'https://api.balldontlie.io/nba/v1/games/100'),log={...d.logs[0],event:d.event,source,observedAt:d.at,research:{...d.logs[0].research!,phase:'unknown' as const}},before=JSON.stringify(log),body=d.store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(source.hash)!.body;
 assert.equal(researchRows(d.store,[log])[0].metadata.phase,shape==='unsupported'?'unknown':'regular');assert.equal(JSON.stringify(log),before);assert.equal(d.store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(source.hash)!.body,body);
 }finally{d.close();}});
