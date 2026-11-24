import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../src/core/domain';
import { assessFreshness, refreshBeforeIssue, refreshedLine, assertState, type PregameState, type FrozenForecast } from '../src/model-engineering/freshness';
const at = '2026-11-24T01:00:00.000Z', later = '2026-11-24T13:42:00.000Z';
const event = { id: 'TEST:game', league: 'NBA' as const, season: '2026', homeId: 'TEST:home', awayId: 'TEST:away', home: 'Test home', away: 'Test away', startsAt: '2026-11-24T15:00:00.000Z' };
function fact<T>(value: T, clock = at) { return { value, observedAt: clock, source: { provider: 'TEST-ONLY', endpoint: 'https://test.invalid', retrievedAt: clock, publishedAt: null, hash: hash([value, clock]), simulated: false } }; }
function state(): PregameState { return { event, playerId: 'TEST:player', teamId: event.homeId, fixture: fact(event), roster: fact({ playerId: 'TEST:player', teamId: event.homeId }), injury: fact('Available'), teammates: [{ playerId: 'TEST:teammate', status: fact('Questionable') }], starter: null }; }
function forecast(): FrozenForecast { return { id: hash('original'), at, asOf: at, modelHash: hash('old-model'), featureHash: hash('features'), event, playerId: 'TEST:player', teamId: event.homeId, prop: 'points', distribution: [.2, .8], state: state() }; }
test('12.7-hour computation refresh preserves original and distinguishes unchanged old source', () => {
  const f = forecast(), before = hash(f), p = refreshBeforeIssue(f, { enabled: true, at: later, state: state(), featureHash: f.featureHash, featureCutoffs: [at], modelHash: f.modelHash, quoteLastUpdate: later }, () => [.3, .7], () => true);
  assert.equal(hash(f), before); assert.equal(p.kind, 'REVISION'); if (p.kind !== 'REVISION') return;
  assert.notEqual(p.record.id, f.id); assert.equal(p.record.sameInputs, true); assert.equal(p.record.assessment.newerEvidence, false); assert.equal(p.record.assessment.forecastAgeMinutes, 762); assert.equal(p.record.assessment.sourceAgeMinutes.injury, 762);
  assert.equal(p.record.assessment.state, 'REVIEW_SHADOW'); assert.ok(p.record.assessment.flags.includes('ROLE_UNVERIFIED')); assert.equal(p.record.informationalImprovementEstablished, false);
  assert.equal(refreshedLine(p.record, .5, 'over').forecastId, p.record.id); assert.equal(refreshedLine(p.record, .5, 'over').win, .7);
});
test('disabled path cannot recalculate or acquire sources', () => { assert.equal(refreshBeforeIssue(forecast(), { enabled: false } as any, () => { throw Error('called'); }, () => { throw Error('called'); }).kind, 'DISABLED'); });
test('changed participation, late scratch and team state require review; stable new report is not new information', () => {
  for (const status of ['Probable', 'Out', 'Available', 'Questionable', 'LateScratch', 'Unknown'] as const) {
    const old = state(), current = state(); old.injury = fact('Questionable'); current.injury = fact(status, later);
    const a = assessFreshness(old, current, at, later); assert.equal(a.state, 'REVIEW_SHADOW'); assert.equal(a.newerEvidence, true); assert.equal(a.informationChanged, status !== 'Questionable');
  }
  const s = state(); s.injury = null; assert.ok(assessFreshness(s, s, at, later).flags.includes('INJURY_UNKNOWN'));
});
test('future injury, unretained receipt, team mismatch and critical unknown starter cannot qualify', () => {
  const s = state(); s.injury = fact('Out', '2026-11-24T14:00:00.000Z'); assert.throws(() => assertState(s, later, () => true), /AS_OF/);
  assert.throws(() => assertState(state(), later, () => false), /AS_OF/);
  const bad = state(); bad.roster = fact({ playerId: bad.playerId, teamId: 'OTHER' }); assert.throws(() => assertState(bad, later, () => true), /ROSTER/);
  const stable = state(); stable.teammates = []; assert.equal(assessFreshness(stable, stable, at, later, { version: 'test', rationale: 'Synthetic role test', sourceTTLMinutes: null, criticalRole: true }).state, 'REVIEW_SHADOW');
});
