import { hash, props, type Prop } from '../core/domain';
import { preparedFeatures, type FeatureSet } from '../research/features';
import { predict, modelSpec } from '../research/models';
import { fitBoosted, boostedMean } from '../research/boost';
import { summary, average, rng } from '../research/distributions';
import { scoreRows, scoreOne, pairedDifference, type ScoredPrediction } from '../research/scoring';
import { thresholds } from '../research/experiment';
import { latestRows, type RetainedRow } from './data';
import { fitM1, predictM1, minuteVector, bound, type TrainingExample } from './m1';
import { calibratePMF, fitCDF, type CDFCalibration } from './calibration';

export const EXPERIMENT_VERSION = 'minutes-rate-chronological/1';
export const incidentDates = ['2026-11-23', '2026-11-24'];
/** Protocol is frozen before reading candidate scores. Splits use whole dates;
 * all players/fixtures on a date stay together. No automatic search or retries. */
export function chronologicalProtocol(dates: string[]) {
  const d = [...new Set(dates)].filter(d => !incidentDates.includes(d)).sort();
  if (d.length < 40) throw Error('FORTY_DATE_RESEARCH_SPLIT_REQUIRED');
  const edges = [.55, .65, .75, .85].map(f => d[Math.floor(d.length * f)]);
  return { version: EXPERIMENT_VERSION, dates: d, trainEnd: edges[0], residualEnd: edges[1], calibrationEnd: edges[2], selectionEnd: edges[3], testEnd: d.at(-1)!,
    candidates: ['last5', 'last10', 'ewa', 'season-shrunk', 'hierarchical-nb', 'M1', 'M1-poisson', 'M1-attempts', 'M1-platt', 'M1-beta', 'M2-minutes'] as const,
    tuningBudget: 'One fixed M1, one 30-stump/.05 learning-rate M2; identity/Platt/beta CDF selection on disjoint dates; no tuning on final dates',
    incidentDatesExcluded: incidentDates, priceROI: 'NOT_ESTIMABLE_HISTORICALLY', promotion: 'SHADOW_ONLY',
    scientificLimit: 'Retrospective lag-only protocol; historical receipt and role availability is not established. Previously inspected older experimental dates cannot be called independently untouched.' };
}
export function exampleFactory(rows: RetainedRow[], mode: 'as-of' | 'retrospective') {
  const get = preparedFeatures(rows, mode), league = new Map<string, FeatureSet['leagueHistory']>();
  return (r: RetainedRow, prop: Prop, cutoff?: string): TrainingExample | null => {
    const f = get(r.log, prop, cutoff); if (!f || r.log.participated !== true || r.log.minutes === null || r.log.minutes <= 0 || r.log.stats[prop] === null) return null;
    f.cutoff = cutoff ?? r.log.event.startsAt;
    const key = `${mode === 'retrospective' ? f.cutoff.slice(0, 10) : f.cutoff}:${prop}`;
    if (!league.has(key)) league.set(key, f.leagueHistory); f.leagueHistory = league.get(key)!;
    return { row: r, f, minutes: r.log.minutes, y: r.log.stats[prop]! };
  };
}
export function positiveMinuteResiduals(center: number, residuals: number[]) {
  if (!residuals.length) throw Error('DISJOINT_MINUTES_RESIDUALS_REQUIRED');
  const pmf = new Array<number>(76).fill(0);
  for (const r of residuals) { const m = bound(center + r, 1, 75), lo = Math.floor(m), hi = Math.ceil(m); pmf[lo] += (hi === lo ? 1 : hi - m) / residuals.length; if (hi !== lo) pmf[hi] += (m - lo) / residuals.length; }
  summary(pmf); return pmf;
}
const scored = (e: TrainingExample, pmf: number[]): ScoredPrediction => ({ id: hash([e.row.log.event.id, e.row.log.playerId]), date: e.row.log.event.startsAt.slice(0, 10), fixture: e.row.log.event.id, season: e.row.log.event.season, player: e.row.log.playerId, team: e.row.log.teamId, lowMinute: e.f.minutes < 15, y: e.y, pmf });
export function supplemental(rows: ScoredPrediction[]) {
  if (!rows.length) return null;
  const quantile = (p: number[], q: number) => { let c = 0; return p.findIndex(v => (c += v) >= q); }, random = rng(2401);
  const pit = rows.map(r => r.pmf.slice(0, r.y).reduce((s, p) => s + p, 0) + random() * (r.pmf[r.y] ?? 0));
  return { intervals: [.5, .8, .9].map(level => { const ranges = rows.map(r => ({ lo: quantile(r.pmf, (1 - level) / 2), hi: quantile(r.pmf, (1 + level) / 2), y: r.y })); return { level, coverage: average(ranges.map(r => Number(r.y >= r.lo && r.y <= r.hi))), width: average(ranges.map(r => r.hi - r.lo)) }; }), randomizedPITSeed: 2401, pitHistogram: Array.from({ length: 10 }, (_, i) => pit.filter(v => v >= i / 10 && (i === 9 ? v <= 1 : v < (i + 1) / 10)).length), nllFloor: 1e-12 };
}
export function runChronological(rows: RetainedRow[], at: string, sourceHash: string, protocol: ReturnType<typeof chronologicalProtocol>) {
  const started = performance.now(), latest = latestRows(rows, '9999-12-31T23:59:59.000Z', 'retrospective').filter(r => r.log.event.league === 'NBA'), make = exampleFactory(rows, 'retrospective');
  const data = Object.fromEntries(props.map(p => [p, latest.filter(r => protocol.dates.includes(r.log.event.startsAt.slice(0, 10))).flatMap(r => { const e = make(r, p); return e ? [e] : []; })])) as Record<Prop, TrainingExample[]>;
  const part = (p: Prop, lo: string, hi: string) => data[p].filter(e => e.row.log.event.startsAt.slice(0, 10) >= lo && e.row.log.event.startsAt.slice(0, 10) < hi);
  const training = Object.fromEntries(props.map(p => [p, part(p, '', protocol.trainEnd)])) as typeof data;
  const artifact = fitM1(training, protocol.trainEnd + 'T00:00:00.000Z', 'retrospective', sourceHash, at);
  const minuteTraining = training.points, boosted = minuteTraining.length >= 200 ? fitBoosted(minuteTraining.map(e => minuteVector(e.f)), minuteTraining.map(e => e.minutes), [0, 1, 2, 3, 4, 5, 6], 30) : null;
  const residualExamples = part('points', protocol.trainEnd, protocol.residualEnd), residuals = boosted ? residualExamples.map(e => e.minutes - boostedMean(boosted, minuteVector(e.f))).sort((a, b) => a - b) : [];
  const boundedResiduals = Array.from({ length: Math.min(31, residuals.length) }, (_, i) => residuals[Math.floor((i + .5) * residuals.length / Math.min(31, residuals.length))]);
  const report: unknown[] = [], predictions: { prop: Prop; model: string; population: string; prediction: ScoredPrediction }[] = [], failures: { prop: Prop; target: string; model: string; reason: string }[] = [];
  const calibrators: Partial<Record<Prop, Record<string, CDFCalibration>>> = {};
  for (const p of props) {
    const cache = new Map<string, number[]>(), pmf = (e: TrainingExample, model: string): number[] | null => {
      const id = hash([e.row.ref, model]); if (cache.has(id)) return cache.get(id)!;
      try {
        let value: number[] | null;
        if (['last5', 'last10', 'ewa', 'season-shrunk', 'hierarchical-nb'].includes(model)) value = predict(e.f, modelSpec(model as Parameters<typeof modelSpec>[0]))!.pmf;
        else if (model === 'M2-minutes') value = boosted && boundedResiduals.length ? predictM1(e.f, artifact, { minutesPMF: positiveMinuteResiduals(boostedMean(boosted, minuteVector(e.f)), boundedResiduals) })!.pmf : null;
        else value = predictM1(e.f, artifact, { poisson: model === 'M1-poisson', attempts: model === 'M1-attempts' })?.pmf ?? null;
        if (value) cache.set(id, value); return value;
      } catch (error) { failures.push({ prop: p, target: hash(e.row.ref), model, reason: (error as Error).message }); return null; }
    };
    const calibration = part(p, protocol.residualEnd, protocol.calibrationEnd).flatMap(e => { const d = pmf(e, 'M1'); return d ? [{ date: e.row.log.event.startsAt.slice(0, 10), pmf: d, y: e.y }] : []; });
    const cals: Record<string, CDFCalibration> = { M1: { method: 'identity' } };
    for (const method of ['platt', 'beta'] as const) { const c = fitCDF(calibration, method, protocol.calibrationEnd + 'T00:00:00.000Z'); if (c) cals[`M1-${method}`] = c; }
    calibrators[p] = cals;
    const baseCandidates = ['last5', 'last10', 'ewa', 'season-shrunk', 'hierarchical-nb', 'M1', 'M1-poisson', ...(p === 'threes' ? ['M1-attempts'] : []), ...(boosted && boundedResiduals.length ? ['M2-minutes'] : []), ...Object.keys(cals).filter(k => k !== 'M1')];
    const evaluate = (examples: TrainingExample[]) => {
      const groups: Record<string, ScoredPrediction[]> = Object.fromEntries(baseCandidates.map(k => [k, []]));
      for (const e of examples) {
        const values = baseCandidates.map(model => ({ model, dist: model.startsWith('M1-') && cals[model] ? (() => { const raw = pmf(e, 'M1'); return raw ? calibratePMF(raw, cals[model]) : null; })() : pmf(e, model) }));
        // Primary comparison uses the same targets for all supported methods.
        if (values.some(v => v.dist === null)) continue;
        for (const v of values) groups[v.model].push(scored(e, v.dist!));
      }
      return groups;
    };
    const selection = evaluate(part(p, protocol.calibrationEnd, protocol.selectionEnd));
    const selected = Object.entries(selection).filter(([, rows]) => rows.length).sort(([ka, a], [kb, b]) => average(a.map(r => scoreOne(r.pmf, r.y, thresholds.NBA[p]).crps)) - average(b.map(r => scoreOne(r.pmf, r.y, thresholds.NBA[p]).crps)) || ka.localeCompare(kb))[0]?.[0] ?? null;
    const testExamples = part(p, protocol.selectionEnd, '9999-12-31'), test = evaluate(testExamples), lines = thresholds.NBA[p];
    const groups = Object.fromEntries(Object.entries(test).map(([k, rows]) => [k, { scores: scoreRows(rows, lines), ...supplemental(rows), vsEWA: new Set(rows.map(r => r.date)).size >= 2 ? pairedDifference(rows, test.ewa, lines, 2401, 400, 'date') : null,
      fixtureIntervalExploratory: new Set(rows.map(r => r.fixture)).size >= 2 ? pairedDifference(rows, test.ewa, lines, 2401, 300, 'fixture') : null,
      lowMinute: scoreRows(rows.filter(r => r.lowMinute), lines) }]));
    for (const [model, rs] of Object.entries(test)) for (const prediction of rs) predictions.push({ prop: p, model, population: 'RETROSPECTIVE_CHRONOLOGICAL_TEST_NOT_SOURCE_ASOF', prediction });
    const minuteErrors = testExamples.map(e => { const m = predictM1(e.f, artifact)!.minutesMean; return { expected: m, actual: e.minutes, error: m - e.minutes, rateError: e.y - e.y / e.minutes * m }; });
    report.push({ prop: p, eligibleRows: data[p].length, trainingRows: training[p].length, residualRows: residualExamples.length, calibrationRows: calibration.length, selectionRows: selection.ewa.length, testCandidates: testExamples.length, matchedTestRows: test.ewa.length,
      selectionWinner: selected, selectionScores: Object.fromEntries(Object.entries(selection).map(([k, v]) => [k, scoreRows(v, lines)])), models: groups,
      minutes: { mae: average(minuteErrors.map(e => Math.abs(e.error))), bias: average(minuteErrors.map(e => e.error)) },
      verdict: 'SHADOW_UNPROVEN', marketComparison: 'UNAVAILABLE_ON_THIS_HISTORICAL_COHORT', incidentExcluded: incidentDates });
  }
  return { version: EXPERIMENT_VERSION, at, datasetOriginHash: hash(rows.map(r => r.ref)), protocol, artifact, boosted, residuals: boundedResiduals, calibrators, report, failures, predictions,
    resources: { elapsedMs: performance.now() - started, maxRSSKiB: process.resourceUsage().maxRSS }, qualifiedEligible: false,
    limitations: ['No original production forecast exists for most historical targets; do not call retrospective baseline controls deployed forecasts.', 'Previously inspected historical experiments cannot be independently untouched; future prospective evidence remains required.', 'Synthetic research thresholds do not establish selected-line betting calibration.', 'No incident outcome is used for fitting, calibration or selection.'] };
}
