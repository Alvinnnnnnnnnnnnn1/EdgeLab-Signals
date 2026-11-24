import test from 'node:test';
import assert from 'node:assert/strict';
import { chronologicalProtocol, positiveMinuteResiduals } from '../src/model-engineering/experiment';
import { calibratePMF, fitCDF } from '../src/model-engineering/calibration';
import { latestRows } from '../src/model-engineering/data';
import { hash } from '../src/core/domain';
import { probabilities } from '../src/core/models';
test('whole-date protocol separates train/residual/calibration/selection/test and seen incidents', () => {
  const dates = Array.from({ length: 80 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
  const p = chronologicalProtocol([...dates, '2026-11-23', '2026-11-24', ...dates]);
  assert.equal(p.dates.length, 80); assert.ok(p.trainEnd < p.residualEnd && p.residualEnd < p.calibrationEnd && p.calibrationEnd < p.selectionEnd); assert.ok(!p.dates.includes('2026-11-24')); assert.equal(p.promotion, 'SHADOW_ONLY'); assert.throws(() => chronologicalProtocol(dates.slice(0, 10)), /FORTY/);
});
test('calibrators need independent date breadth, reject future labels, preserve integer PMFs and line consistency', () => {
  const rows = Array.from({ length: 240 }, (_, i) => ({ date: `2026-01-${String(i % 8 + 1).padStart(2, '0')}`, pmf: [.3, .4, .3], y: i % 3 }));
  assert.equal(fitCDF(rows.map(r => ({ ...r, date: '2026-01-01' })), 'beta', '2026-02-01'), null);
  assert.throws(() => fitCDF(rows, 'platt', '2026-01-02'), /TIME_LEAK/);
  for (const method of ['platt', 'beta'] as const) {
    const cal = fitCDF(rows, method, '2026-02-01')!, p = calibratePMF([.3, .4, .3], cal);
    assert.ok(p.every(v => v >= 0)); assert.ok(Math.abs(p.reduce((s, v) => s + v, 0) - 1) < 1e-10);
    for (const line of [0, .5, 1, 1.5, 2]) { const o = probabilities(p, line, 'over'), u = probabilities(p, line, 'under'); assert.ok(Math.abs(o.win + u.win + o.push - 1) < 1e-10); }
  }
});
test('as-of correction selection cannot consume later receipt even when its game date is old', () => {
  const old: any = { log: { event: { startsAt: '2026-01-01T00:00:00.000Z', id: 'TEST:game', league: 'NBA' }, playerId: 'TEST:player', observedAt: '2026-01-02T00:00:00.000Z', completedAt: null, source: { retrievedAt: '2026-01-02T00:00:00.000Z' }, stats: { points: 10 } } };
  const later = structuredClone(old); later.log.observedAt = '2026-02-01T00:00:00.000Z'; later.log.source.retrievedAt = later.log.observedAt; later.log.stats.points = 100;
  assert.equal(latestRows([old, later], '2026-01-03T00:00:00.000Z', 'as-of')[0].log.stats.points, 10);
  assert.equal(latestRows([old, later], '2026-01-03T00:00:00.000Z', 'retrospective')[0].log.stats.points, 100);
});
test('M2 residual distribution is positive-minute, reproducible and refuses absent calibration residuals', () => {
  assert.throws(() => positiveMinuteResiduals(25, []), /DISJOINT/); const a = positiveMinuteResiduals(25, [-20, -3, 0, 8, 25]);
  assert.equal(a[0], 0); assert.equal(hash(a), hash(positiveMinuteResiduals(25, [-20, -3, 0, 8, 25]))); assert.ok(Math.abs(a.reduce((s, v) => s + v, 0) - 1) < 1e-10);
});
