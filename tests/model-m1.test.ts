import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store';
import { syntheticData, DEMO_AT } from '../src/demo';
import { features } from '../src/research/features';
import { hash, props } from '../src/core/domain';
import { probabilities } from '../src/core/models';
import { summary } from '../src/research/distributions';
import { M1_VERSION, predictM1, m1Minutes, sharedMinuteScenarios, type M1Artifact } from '../src/model-engineering/m1';
function fixture() {
  const store = new Store(':memory:'), d = syntheticData(store), rows = d.logs.map(log => ({ log, metadata: log.research ?? { phase: 'regular' as const, overtimePeriods: 0, threeAttempts: 6, rosterOpportunityVerified: false } }));
  const prior = { rate: .5, priorMinutes: 120, excess: .08, minuteSlope: .001, attemptRate: .2, makeRate: .35 };
  const body: Omit<M1Artifact, 'id'> = { algorithm: M1_VERSION, seed: 2401, trainingCutoff: '2026-01-01T00:00:00.000Z', trainedAt: DEMO_AT, trainingMode: 'retrospective', trainingOriginHash: hash('TEST-ONLY'), sourceHash: hash('TEST-ONLY code'), featureManifest: ['TEST-ONLY'], trainingDates: ['2025-01-01'], trainingRows: 100,
    priors: Object.fromEntries(props.map(p => [p, prior])) as M1Artifact['priors'], roleRates: Object.fromEntries(props.map(p => [p, { low: .2, rotation: .4, high: .6 }])) as M1Artifact['roleRates'], minuteResiduals: { low: [-5, 0, 5], rotation: [-8, 0, 8], high: [-10, 0, 10] } };
  const artifact: M1Artifact = { ...body, id: hash(body) };
  return { store, artifact, get: (prop: typeof props[number]) => features(rows, { ...d.logs[0], event: d.event }, prop, 'as-of')! };
}
test('M1 is deterministic, integer, conditional on playing, and complements whole/half lines for all props', () => {
  const d = fixture(); try {
    for (const prop of props) {
      const f = d.get(prop), a = predictM1(f, d.artifact)!, b = predictM1(f, d.artifact)!;
      assert.equal(hash(a), hash(b)); assert.equal(a.conditioning, 'ON_PLAYING'); assert.equal(a.participationProbability, null); assert.equal(a.minutesPMF[0], 0); assert.equal(a.pmf.length, 501); summary(a.pmf);
      for (const line of [0, .5, 2, 10.5, 20]) { const o = probabilities(a.pmf, line, 'over'), u = probabilities(a.pmf, line, 'under'); assert.ok(Math.abs(o.win + u.win + o.push - 1) < 1e-8); assert.equal(o.push, u.push); }
      assert.ok(Math.abs(a.uncertainty.minutesAndRateAssociation + a.uncertainty.conditionalRateAndCount - a.uncertainty.total) < 1e-8);
    }
  } finally { d.store.close(); }
});
test('zero-rate and sparse/low-minute/return/trade/high-usage scenario tests are software properties only', () => {
  const d = fixture(); try {
    const f = d.get('points');
    for (const scenario of ['rookie', 'low-bench', 'return', 'trade', 'promotion', 'blowout', 'high-usage', 'overprediction']) {
      const s = structuredClone(f); if (scenario === 'rookie') s.history = s.history.slice(-2);
      if (scenario === 'trade') s.recentTeamChanged = true;
      if (scenario === 'low-bench') { s.minutes = 5; s.history.forEach(r => { r.log.minutes = 5; r.log.stats.points = 2; }); }
      if (scenario === 'promotion') s.history.slice(-5).forEach(r => { r.log.minutes = 42; });
      if (scenario === 'return') s.history.at(-1)!.log.minutes = 2;
      const p = predictM1(s, d.artifact)!; summary(p.pmf); assert.ok(p.mean >= 0); assert.equal(p.starterProbability, null);
    }
    const zero = structuredClone(d.artifact), zf = structuredClone(f); zf.history.forEach(r => { r.log.stats.points = 0; }); zero.roleRates.points = { low: 0, rotation: 0, high: 0 }; const { id, ...body } = zero; zero.id = hash(body);
    assert.equal(predictM1(zf, zero)!.pmf[0], 1);
    const tampered = structuredClone(d.artifact); tampered.priors.points.excess = .9; assert.throws(() => predictM1(f, tampered), /ARTIFACT/);
  } finally { d.store.close(); }
});
test('unknown attempts refuse attempt/make; known zero attempts remain legitimate count evidence', () => {
  const d = fixture(); try {
    const f = d.get('threes'); f.history.forEach(r => { r.metadata.threeAttempts = null; }); assert.equal(predictM1(f, d.artifact, { attempts: true }), null);
    f.history.forEach(r => { r.metadata.threeAttempts = 0; r.log.stats.threes = 0; }); summary(predictM1(f, d.artifact, { attempts: true })!.pmf);
  } finally { d.store.close(); }
});
test('common minutes scenarios are sampled once; role change widens sensitivity without asserting calibration', () => {
  const d = fixture(); try {
    const predictions = Object.fromEntries(props.map(p => [p, predictM1(d.get(p), d.artifact)!])) as Parameters<typeof sharedMinuteScenarios>[0];
    assert.deepEqual(sharedMinuteScenarios(predictions), sharedMinuteScenarios(predictions));
    const f = d.get('points'), original = m1Minutes(f, d.artifact), changed = structuredClone(f); changed.recentTeamChanged = true;
    const variance = (p: number[]) => { const mean = summary(p).mean; return p.reduce((s, w, k) => s + w * (k - mean) ** 2, 0); };
    assert.ok(variance(m1Minutes(changed, d.artifact)) > variance(original));
  } finally { d.store.close(); }
});
