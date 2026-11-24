import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/suggestions-fixture';
import { hash, props } from '../src/core/domain';
import { features } from '../src/research/features';
import { EngineeringJournal, exactNoVig, verifyCachedQuote, type ShadowInput } from '../src/model-engineering/journal';
import { pregameEvidence } from '../src/model-engineering/evidence';
import { M1_VERSION, predictM1, type M1Artifact } from '../src/model-engineering/m1';
import { cachedShadowCycle } from '../src/model-engineering/shadow';
import { engineeringReport } from '../src/model-engineering/report';
function setup() {
  const d = fixture(), prior = { rate: .5, priorMinutes: 120, excess: .1, minuteSlope: 0, attemptRate: .2, makeRate: .35 };
  const body: Omit<M1Artifact, 'id'> = { algorithm: M1_VERSION, seed: 2401, trainingCutoff: '2026-10-01T00:00:00.000Z', dataAsOf: d.at, trainedAt: d.at, trainingMode: 'retrospective', trainingOriginHash: hash('TEST-ONLY training'), sourceHash: hash('TEST-ONLY code'), featureManifest: ['TEST-ONLY isolated'], trainingDates: ['2026-09-01'], trainingRows: 100,
    priors: Object.fromEntries(props.map(p => [p, prior])) as M1Artifact['priors'], roleRates: Object.fromEntries(props.map(p => [p, { low: .2, rotation: .5, high: .7 }])) as M1Artifact['roleRates'], minuteResiduals: { low: [-5, 0, 5], rotation: [-8, 0, 8], high: [-10, 0, 10] } };
  const artifact: M1Artifact = { ...body, id: hash(body) }, f = features(d.logs.map(log => ({ log, metadata: log.research! })), { ...d.logs[0], event: d.event }, 'points', 'as-of', d.at)!;
  f.cutoff = d.at; const p = predictM1(f, artifact)!;
  const input: ShadowInput = { asOf: d.at, state: pregameEvidence(d.store)(d.event, d.logs[0].playerId, d.event.homeId, d.at), artifact, featureHash: hash(f.values), featureRefs: d.logs.map(l => { const id = hash([l.event.id, l.playerId, l.source.hash]); return { id, bodyHash: hash(String(d.store.db.prepare('SELECT body FROM logs WHERE id=?').get(id)!.body)), knownAt: l.observedAt }; }), prop: 'points', distribution: p.pmf, minutesDistribution: p.minutesPMF, originalControl: { modelHash: hash('TEST-ONLY original'), distribution: d.fs[0].distribution }, frozenProduction: null, controls: { ewa: d.fs[0].distribution }, freshness: { role: 'unknown' }, previousRevisionId: null, market: null };
  const journal = new EngineeringJournal(':memory:', true, d.clock); journal.publish(artifact); return { ...d, artifact, input, journal, closeAll: () => { journal.close(); d.close(); } };
}
test('SHADOW registration is immutable, idempotent, conditional and has no source/outbox writes', () => {
  const d = setup(); try {
    const sourceBefore = hash(d.store.db.prepare('SELECT * FROM meta ORDER BY key').all()), outboxBefore = d.store.db.prepare('SELECT count(*) n FROM experimental_outbox').get()!.n;
    const a = d.journal.register(d.input, d.store), b = d.journal.register(d.input, d.store);
    assert.equal(a.inserted, true); assert.equal(b.inserted, false); assert.equal(a.record.id, b.record.id); assert.equal(a.record.dispatchAllowed, false); assert.equal(a.record.productionEnabled, false); assert.equal(a.record.participationProbability, null);
    assert.throws(() => d.journal.db.prepare('DELETE FROM engineering_predictions').run(), /immutable/); assert.throws(() => d.journal.db.prepare("UPDATE engineering_models SET body='{}'").run(), /immutable/);
    assert.equal(hash(d.store.db.prepare('SELECT * FROM meta ORDER BY key').all()), sourceBefore); assert.equal(d.store.db.prepare('SELECT count(*) n FROM experimental_outbox').get()!.n, outboxBefore);
  } finally { d.closeAll(); }
});
test('backdating, late registration, future feature/role snapshots and mutated feature bodies are rejected', () => {
  const d = setup(); try {
    const bad = structuredClone(d.input); bad.featureRefs[0].bodyHash = hash('wrong'); assert.throws(() => d.journal.register(bad, d.store), /MANIFEST/);
    const future = structuredClone(d.input); future.state.injury = { value: 'Out', observedAt: d.event.startsAt, source: { ...d.logs[0].source, retrievedAt: d.event.startsAt } }; assert.throws(() => d.journal.register(future, d.store), /AS_OF/);
    d.setAt(new Date(Date.parse(d.at) + 11000).toISOString()); assert.throws(() => d.journal.register(d.input, d.store), /BACKDATED/);
    d.setAt(d.event.startsAt); const late = { ...d.input, asOf: d.event.startsAt }; assert.throws(() => d.journal.register(late, d.store), /LATE/);
  } finally { d.closeAll(); }
});
test('Questionable teammate remains unknown at issue and later Out cannot enter earlier state', () => {
  const d = fixture(); try {
    const mate = { id: 71, first_name: 'TEST-ONLY', last_name: 'Mate', team: { id: 1 } };
    d.retain({ data: [mate], meta: {} }, 'https://api.balldontlie.io/nba/v1/players/active');
    d.retain({ data: [{ player: { id: 71 }, status: 'Questionable' }], meta: {} }, 'https://api.balldontlie.io/nba/v1/player_injuries');
    const after = new Date(Date.parse(d.at) + 60000).toISOString(); d.retain({ data: [{ player: { id: 71 }, status: 'Out' }], meta: {} }, 'https://api.balldontlie.io/nba/v1/player_injuries', after);
    const state = pregameEvidence(d.store)(d.event, d.logs[0].playerId, d.event.homeId, d.at);
    assert.equal(state.teammates[0].status.value, 'Questionable'); assert.equal(state.starter, null); assert.equal(state.injury, null);
  } finally { d.close(); }
});
test('grading appends corrections, does not turn unknown participation or absent stats into zero', () => {
  const d = setup(); try {
    const prediction = d.journal.register(d.input, d.store).record;
    const at = new Date(Date.parse(d.event.startsAt) + 4 * 3600000).toISOString(); d.setAt(at);
    const source = d.retain({ label: 'TEST-ONLY final', points: 25 }, 'https://test.invalid/final', at, 'TEST-ONLY');
    const final = { ...d.logs[0], event: d.event, source, observedAt: at, stats: { ...d.logs[0].stats, points: null }, participated: null };
    d.store.ingest([final], at); d.journal.grade(d.store); assert.equal(d.journal.db.prepare('SELECT count(*) n FROM engineering_grades').get()!.n, 0);
    const later = new Date(Date.parse(at) + 60000).toISOString(); d.setAt(later); const fixed = { ...final, observedAt: later, participated: true, stats: { ...final.stats, points: 25 }, source: d.retain({ label: 'TEST-ONLY correction', points: 25 }, 'https://test.invalid/final', later, 'TEST-ONLY') };
    d.store.ingest([fixed], later); d.journal.grade(d.store); d.journal.grade(d.store);
    assert.equal(d.journal.db.prepare('SELECT count(*) n FROM engineering_grades').get()!.n, 1); assert.equal(JSON.parse(String(d.journal.db.prepare('SELECT body FROM engineering_grades').get()!.body)).actual, 25);
    assert.equal(JSON.parse(String(d.journal.db.prepare('SELECT body FROM engineering_predictions WHERE id=?').get(prediction.id)!.body)).bodyHash, prediction.bodyHash);
    assert.equal(engineeringReport(d.journal.db).groups.length, 1);
    const invalidAt = new Date(Date.parse(later) + 60000).toISOString(); d.setAt(invalidAt);
    d.store.ingest([{ ...fixed, observedAt: invalidAt, stats: { ...fixed.stats, points: null }, source: d.retain({ label: 'TEST-ONLY unavailable correction' }, 'https://test.invalid/final', invalidAt, 'TEST-ONLY') }], invalidAt);
    d.journal.grade(d.store); const report = engineeringReport(d.journal.db); assert.equal(report.groups.length, 0); assert.equal(report.pending, 1);
    assert.equal(d.journal.db.prepare('SELECT count(*) n FROM engineering_grades').get()!.n, 1);
  } finally { d.closeAll(); }
});
test('refresh revisions are preserved but do not multiply primary prospective targets', () => {
  const d = setup(); try {
    d.journal.register(d.input, d.store); const revisedAt = new Date(Date.parse(d.at) + 1000).toISOString(); d.setAt(revisedAt); d.journal.register({ ...d.input, asOf: revisedAt, featureHash: hash('TEST-ONLY revised evidence') }, d.store);
    const report = engineeringReport(d.journal.db); assert.equal(report.registrationRevisions, 2); assert.equal(report.distinctModelPlayerGameProps, 1); assert.equal(report.pending, 1);
  } finally { d.closeAll(); }
});
test('matched no-vig rejects mismatched line/source/team/clock and retains exact original side prices', () => {
  const d = fixture(); try {
    const over = d.quotes.find(q => q.prop === 'points' && q.side === 'over')!, under = d.quotes.find(q => q.prop === 'points' && q.side === 'under')!;
    const market = exactNoVig(over, under, d.at, r => d.store.hasReceipt(r)); assert.ok(market.over > 0 && market.over < 1);
    for (const bad of [{ ...under, line: under.line + 1 }, { ...under, source: { ...under.source, hash: hash('wrong') } }, { ...under, quotedAt: new Date(Date.parse(under.quotedAt) - 1000).toISOString() }]) assert.throws(() => exactNoVig(over, bad, d.at, r => d.store.hasReceipt(r)));
  } finally { d.close(); }
});
test('default cached SHADOW pathway is fully disabled before reading source or constructing journals', () => {
  assert.equal(cachedShadowCycle({} as any, { enabled: false } as any, 'unused').state, 'DISABLED');
  const j = new EngineeringJournal(':memory:'); assert.throws(() => j.publish({} as any), /DISABLED/); j.close();
});
test('quote provenance rejects invented prices despite a retained source hash', () => {
  const d = fixture(); try { const q = d.quotes[0]; verifyCachedQuote(d.store, q, d.at); assert.throws(() => verifyCachedQuote(d.store, { ...q, decimalOdds: 1.91 }, d.at), /ORIGINAL_SOURCE/); } finally { d.close(); }
});
test('bounded grading cursor visits later forecasts and wraps for corrections', () => {
  const d = setup(); try {
    for (const prop of ['points', 'rebounds', 'assists'] as const) d.journal.register({ ...d.input, prop, featureHash: hash(prop) }, d.store);
    const visited: string[] = [];
    for (let i = 0; i < 4; i++) { d.journal.grade(d.store, 1); const cursor = JSON.parse(String(d.journal.db.prepare("SELECT value FROM engineering_runtime WHERE key='gradeCursor'").get()!.value)); visited.push(cursor.id); }
    assert.equal(new Set(visited.slice(0, 3)).size, 3); assert.equal(visited[0], visited[3]);
  } finally { d.closeAll(); }
});
