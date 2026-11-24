import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/suggestions-fixture';
import { hash } from '../src/core/domain';
import { combinedTarget, combinations, combinationNames, combinationHistory, combinationPMF, independentConvolutionDiagnostic, withinPlayerRateDependence, combinationLifecycle, playerFixtureExposureGroup } from '../src/model-engineering/combos';
test('combined targets use one exact player-game and never infer missing, DNP or participation as zero', () => {
  const d = fixture(); try {
    const l = structuredClone(d.logs[0]); l.stats = { points: 20, rebounds: 7, assists: 9, threes: 3 };
    assert.equal(combinedTarget(l, 'PRA').value, 36); assert.equal(combinedTarget(l, 'PA').value, 29); assert.equal(combinedTarget(l, 'PR').value, 27); assert.equal(combinedTarget(l, 'RA').value, 16);
    l.stats.assists = null; assert.equal(combinedTarget(l, 'PRA').state, 'INCOMPLETE'); assert.equal(combinedTarget(l, 'PR').value, 27);
    l.participated = null; assert.equal(combinedTarget(l, 'PR').value, null); l.participated = false; assert.equal(combinedTarget(l, 'PRA').state, 'DNP_CONFIRMED');
  } finally { d.close(); }
});
test('direct and common-minutes baselines are deterministic complete integer PMFs for all requested combinations', () => {
  const d = fixture(); try {
    const rows = d.logs.map(log => ({ log, metadata: log.research!, ref: { id: hash(log), bodyHash: hash(log) } })), minutes = new Array<number>(76).fill(0); minutes[20] = .5; minutes[40] = .5;
    for (const c of combinationNames) for (const method of ['last5', 'last10', 'ewa', 'season-shrunk', 'empirical', 'shared-minutes-paired-rates'] as const) {
      const p = combinationPMF(rows, c, method, minutes, d.event.season); assert.ok(p.every(v => Number.isFinite(v) && v >= 0)); assert.ok(Math.abs(p.reduce((s, v) => s + v, 0) - 1) < 1e-9); assert.equal(hash(p), hash(combinationPMF(rows, c, method, minutes, d.event.season)));
    }
    assert.throws(() => combinationPMF(rows, 'PRA', 'shared-minutes-paired-rates', [1]), /MINUTES/);
  } finally { d.close(); }
});
test('combo history rejects target/future rows, applies original revisions and does not join another player', () => {
  const d = fixture(); try {
    const rows = d.logs.map(log => ({ log, metadata: log.research!, ref: { id: hash(log), bodyHash: hash(log) } })), late = structuredClone(rows[0]); late.log.observedAt = d.event.startsAt; late.log.source.retrievedAt = d.event.startsAt; late.log.stats.points = 100;
    const before = combinationHistory(rows, d.logs[0].playerId, d.event.id, d.at, 'as-of', 'PRA'), after = combinationHistory([...rows, late], d.logs[0].playerId, d.event.id, d.at, 'as-of', 'PRA'); assert.equal(hash(before), hash(after)); assert.equal(combinationHistory(rows, 'OTHER_PLAYER', d.event.id, d.at, 'as-of', 'PRA').length, 0);
  } finally { d.close(); }
});
test('correlated paired vectors are distinct from independence convolution; mixed players cannot manufacture dependence', () => {
  const d = fixture(); try {
    const rows = d.logs.map((log, i) => ({ log: { ...log, stats: { ...log.stats, points: i, rebounds: i, assists: i } }, metadata: log.research!, ref: { id: hash(log), bodyHash: hash(log) } }));
    assert.equal(withinPlayerRateDependence(rows).pointsRebounds, 1); rows[0].log.playerId = 'OTHER'; assert.throws(() => withinPlayerRateDependence(rows), /WITHIN_PLAYER/);
    const independent = independentConvolutionDiagnostic([[.5, .5], [.5, .5]]); assert.deepEqual(independent.pmf, [.25, .5, .25]); assert.equal(independent.lifecycle, 'RESEARCH_ONLY');
  } finally { d.close(); }
});
test('four exact combo keys remain research-only and share exposure identity without modifying single-prop claims', () => {
  assert.equal(combinations.PRA.market, 'player_points_rebounds_assists'); assert.equal(combinations.PA.market, 'player_points_assists'); assert.equal(combinations.PR.market, 'player_points_rebounds'); assert.equal(combinations.RA.market, 'player_rebounds_assists');
  assert.equal(combinationLifecycle.deliveryEnabled, false); assert.equal(combinationLifecycle.marketAcquisitionEnabled, false); assert.equal(combinationLifecycle.prospectiveEnabled, false); assert.equal(playerFixtureExposureGroup('game', 'player'), playerFixtureExposureGroup('game', 'player')); assert.notEqual(playerFixtureExposureGroup('game', 'player'), playerFixtureExposureGroup('game', 'other'));
});
