import { hash, ms, props, type Prop } from '../core/domain';
import type { FeatureSet } from '../research/features';
import { average, negativeBinomial, summary, betaBinomial, rng, sampleCount } from '../research/distributions';
import { knownAt, type RetainedRow } from './data';

export const M1_VERSION = 'pooled-minutes-rate/1.0.0';
export type RoleBand = 'low' | 'rotation' | 'high';
export const roleBand = (m: number): RoleBand => m < 15 ? 'low' : m < 28 ? 'rotation' : 'high';
export const bound = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));
export const minuteVector = (f: FeatureSet) => {
  const minutes = f.history.map(r => r.log.minutes!), recent = minutes.slice(-20), weights = recent.map((_, i) => 2 ** (-(recent.length - 1 - i) / 5));
  return [average(minutes.slice(-5)), average(minutes.slice(-10)), recent.reduce((s, v, i) => s + v * weights[i], 0) / weights.reduce((a, b) => a + b, 0), f.minutesSD, f.values[7], Number(f.recentTeamChanged), minutes.length];
};
export function minuteCenter(f: FeatureSet) { const v = minuteVector(f); return .5 * v[2] + .3 * v[0] + .2 * v[1]; }
export interface TrainingExample { row: RetainedRow; f: FeatureSet; y: number; minutes: number }
interface RatePrior { rate: number; priorMinutes: number; excess: number; minuteSlope: number; attemptRate: number | null; makeRate: number | null }
export interface M1Artifact {
  algorithm: typeof M1_VERSION; seed: 2401; trainingCutoff: string; trainedAt: string;
  trainingMode: 'as-of' | 'retrospective'; trainingOriginHash: string; sourceHash: string;
  featureManifest: string[]; trainingDates: string[]; trainingRows: number;
  priors: Record<Prop, RatePrior>; roleRates: Record<Prop, Record<RoleBand, number>>;
  minuteResiduals: Record<RoleBand, number[]>; id: string;
}
const bands: RoleBand[] = ['low', 'rotation', 'high'];
function thin(values: number[], max = 31) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length <= max ? sorted : Array.from({ length: max }, (_, i) => sorted[Math.floor((i + .5) * sorted.length / max)]);
}
/** Fitting consumes only declared training labels and lagged features. The
 * caller must supply disjoint later residual/calibration/selection/test dates. */
export function fitM1(examples: Record<Prop, TrainingExample[]>, trainingCutoff: string, trainingMode: M1Artifact['trainingMode'], sourceHash: string, trainedAt: string): M1Artifact {
  const dates = [...new Set(props.flatMap(p => examples[p].map(e => e.row.log.event.startsAt.slice(0, 10))))].sort();
  if (dates.length < 8 || props.some(p => examples[p].length < 100)) throw Error('INSUFFICIENT_TRAINING_DATE_BREADTH');
  for (const p of props) for (const e of examples[p]) {
    if (e.row.log.source.simulated || e.row.log.participated !== true || e.minutes <= 0 || !Number.isInteger(e.y) || e.y < 0 || ms(e.row.log.event.startsAt) >= ms(trainingCutoff) || knownAt(e.row.log) > ms(trainedAt) || trainingMode === 'as-of' && knownAt(e.row.log) > ms(trainingCutoff) || e.f.prop !== p) throw Error('INVALID_TRAINING_LABEL_OR_CUTOFF');
    if (e.f.history.some(r => r.log.event.startsAt.slice(0, 10) >= e.row.log.event.startsAt.slice(0, 10) || trainingMode === 'as-of' && knownAt(r.log) >= ms(e.f.cutoff))) throw Error('FUTURE_TRAINING_FEATURE');
  }
  const priors = {} as M1Artifact['priors'], roleRates = {} as M1Artifact['roleRates'];
  for (const p of props) {
    const data = examples[p], exposure = data.reduce((s, e) => s + e.minutes, 0), rate = data.reduce((s, e) => s + e.y, 0) / exposure;
    const byPlayer = new Map<string, { y: number; m: number }>();
    data.forEach(e => { const old = byPlayer.get(e.f.playerId) ?? { y: 0, m: 0 }; byPlayer.set(e.f.playerId, { y: old.y + e.y, m: old.m + e.minutes }); });
    const players = [...byPlayer.values()], between = Math.max(0, average(players.map(e => (e.y / e.m - rate) ** 2 - rate / e.m)));
    // Gamma prior exposure: Var(rate)=rate/exposure. Bounds regularise tiny
    // training samples; these are model constants, never selection thresholds.
    const priorMinutes = between > 0 ? bound(rate / between, 30, 600) : 600;
    const role = Object.fromEntries(bands.map(b => { const a = data.filter(e => roleBand(e.f.minutes) === b); return [b, (a.reduce((s, e) => s + e.y, 0) + 1000 * rate) / (a.reduce((s, e) => s + e.minutes, 0) + 1000)]; })) as Record<RoleBand, number>;
    const residual = data.map(e => {
      const mu = Math.max(.01, e.f.rate * e.minutes), x = e.minutes - e.f.minutes;
      return { x, relative: (e.y - mu) / mu, excess: ((e.y - mu) ** 2 - e.y) / (mu * mu) };
    });
    const minuteSlope = bound(residual.reduce((s, e) => s + e.x * e.relative, 0) / (residual.reduce((s, e) => s + e.x ** 2, 0) + 1000), -.02, .02);
    const attemptRows = p === 'threes' ? data.filter(e => e.row.metadata.threeAttempts !== null) : [], attempts = attemptRows.reduce((s, e) => s + e.row.metadata.threeAttempts!, 0);
    priors[p] = { rate, priorMinutes, excess: bound(average(residual.map(e => e.excess)), 0, 1), minuteSlope,
      attemptRate: attemptRows.length === data.length ? attempts / exposure : null,
      makeRate: attemptRows.length === data.length && attempts > 0 ? attemptRows.reduce((s, e) => s + e.y, 0) / attempts : null }; roleRates[p] = role;
  }
  const minuteData = examples.points;
  const minuteResiduals = Object.fromEntries(bands.map(b => {
    const group = minuteData.filter(e => roleBand(e.f.minutes) === b), a = group.length >= 30 ? group : minuteData;
    return [b, thin(a.map(e => e.minutes - minuteCenter(e.f)))];
  })) as M1Artifact['minuteResiduals'];
  const body: Omit<M1Artifact, 'id'> = { algorithm: M1_VERSION, seed: 2401, trainingCutoff, trainedAt, trainingMode,
    trainingOriginHash: hash(props.map(p => examples[p].map(e => ({ ref: e.row.ref, features: hash({ values: e.f.values, history: e.f.history.map(r => hash(r.log)) }) })))), sourceHash,
    featureManifest: ['lagged minutes EWA/last5/last10', 'empirical positive-minute residuals', 'Gamma-Poisson partial pooling', 'historical minute/rate association', 'prior team affiliation only', 'no injury/starter/pace coefficients'],
    trainingDates: dates, trainingRows: examples.points.length, priors, roleRates, minuteResiduals };
  return { ...body, id: hash(body) };
}
export function assertArtifact(a: M1Artifact) { const { id, ...body } = a; if (a.algorithm !== M1_VERSION || hash(body) !== id) throw Error('MODEL_ARTIFACT_CHANGED'); }
export function m1Minutes(f: FeatureSet, a: M1Artifact, center = minuteCenter(f)) {
  const own = f.history.slice(-20).map(r => r.log.minutes!), ownCenter = average(own), pool = a.minuteResiduals[roleBand(f.minutes)];
  const p = new Array<number>(76).fill(0), ownWeight = own.length / (own.length + 10), change = Math.abs(average(own.slice(-5)) - average(own.slice(-10)));
  const add = (v: number, w: number) => { const m = bound(v, 1, 75), lo = Math.floor(m), hi = Math.ceil(m); p[lo] += w * (hi === lo ? 1 : hi - m); if (hi !== lo) p[hi] += w * (m - lo); };
  // Common minutes scenarios are reused across props. A lagged role-shift
  // sensitivity widens uncertainty; it is not a validated injury response.
  own.forEach(m => add(center + (m - ownCenter) * (1 + change / 15), ownWeight / own.length));
  pool.forEach(r => add(center + r * (f.recentTeamChanged ? 1.25 : 1), (1 - ownWeight) / pool.length));
  summary(p); return p;
}
export function predictM1(f: FeatureSet, a: M1Artifact, options: { poisson?: boolean; attempts?: boolean; minuteCenter?: number; minutesPMF?: number[] } = {}) {
  assertArtifact(a);
  if (f.history.length === 0 || ms(f.cutoff) < ms(a.trainingCutoff)) throw Error('MODEL_NOT_AVAILABLE_AT_CUTOFF');
  const prior = a.priors[f.prop], b = roleBand(f.minutes), history = f.history.slice(-60), weights = history.map((_, i) => 2 ** (-(history.length - 1 - i) / 10));
  const exposure = history.reduce((s, r, i) => s + r.log.minutes! * weights[i], 0), total = history.reduce((s, r, i) => s + r.log.stats[f.prop]! * weights[i], 0);
  const alpha = total + prior.priorMinutes * a.roleRates[f.prop][b], beta = exposure + prior.priorMinutes, rate = alpha / beta;
  const minutes = options.minutesPMF ?? m1Minutes(f, a, options.minuteCenter), center = summary(minutes).mean, pmf = new Array<number>(501).fill(0);
  if (minutes[0] !== 0 || minutes.some((w, m) => w > 0 && m > 75)) throw Error('POSITIVE_MINUTES_SUPPORT_REQUIRED');
  const useAttempts = options.attempts === true && f.prop === 'threes' && prior.attemptRate !== null && prior.makeRate !== null && history.every(r => r.metadata.threeAttempts !== null);
  if (options.attempts && !useAttempts) return null;
  const allAttempts = useAttempts ? history.reduce((s, r) => s + r.metadata.threeAttempts!, 0) : 0;
  const made = useAttempts ? history.reduce((s, r) => s + r.log.stats.threes!, 0) : 0;
  const attemptsRate = useAttempts ? (allAttempts + prior.priorMinutes * prior.attemptRate!) / (history.reduce((s, r) => s + r.log.minutes!, 0) + prior.priorMinutes) : null;
  const conditionals = new Map<number, number[]>();
  minutes.forEach((w, m) => {
    if (!w) return;
    const adjustedRate = rate * Math.exp(prior.minuteSlope * (m - center)), mu = adjustedRate * m;
    let d: number[];
    if (useAttempts) {
      // Conversion posterior uses observed attempts only. No target-game shots.
      const attemptMu = attemptsRate! * m, attempts = negativeBinomial(attemptMu, attemptMu + attemptMu ** 2 * (prior.excess + 1 / Math.max(1, allAttempts)));
      d = new Array<number>(501).fill(0);
      attempts.forEach((mass, n) => { if (mass > 1e-14) { const conversion = betaBinomial(n, made + .5 + 20 * prior.makeRate!, allAttempts - made + .5 + 20 * (1 - prior.makeRate!)); for (let k = 0; k <= n; k++) d[k] += mass * conversion[k]; } });
      const sum = d.reduce((s, p) => s + p, 0); if (Math.abs(sum - 1) > 1e-7) throw Error('ATTEMPT_TAIL_INCOMPLETE'); d = d.map(v => v / sum);
    } else d = negativeBinomial(mu, options.poisson ? mu : mu + mu ** 2 * (prior.excess + 1 / Math.max(.01, alpha)));
    conditionals.set(m, d); d.forEach((p, k) => { pmf[k] += w * p; });
  });
  const result = summary(pmf), variance = pmf.reduce((s, p, k) => s + p * (k - result.mean) ** 2, 0);
  const conditionalMeans = [...conditionals].map(([m, d]) => ({ w: minutes[m], mean: summary(d).mean })), minuteVariance = conditionalMeans.reduce((s, r) => s + r.w * (r.mean - result.mean) ** 2, 0);
  return { pmf, minutesPMF: minutes, mean: result.mean, rate, ratePriorMinutes: prior.priorMinutes, minutesMean: center,
    uncertainty: { minutesAndRateAssociation: minuteVariance, conditionalRateAndCount: Math.max(0, variance - minuteVariance), total: variance, minuteRateSlope: prior.minuteSlope },
    conditioning: 'ON_PLAYING' as const, participationProbability: null, starterProbability: null, modelHash: a.id,
    limitations: ['No validated teammate/injury response', 'Role bands derive only from past minutes; not known starters', 'Within-player historical minutes-rate association is not causal', 'Finite count tail must pass mass check; no hidden truncation', 'No bookmaker DNP settlement probability is inferred'] };
}
/** Shared minutes once per player scenario, conditional prop draws thereafter.
 * Remaining rate residual dependence is unknown, not claimed independent truth. */
export function sharedMinuteScenarios(predictions: Record<Prop, NonNullable<ReturnType<typeof predictM1>>>, seed = 2401, draws = 1000) {
  const random = rng(seed), minutes = predictions.points.minutesPMF;
  if (props.some(p => hash(predictions[p].minutesPMF) !== hash(minutes))) throw Error('COMMON_MINUTES_REQUIRED');
  // Marginal PMFs cannot recover the conditional joint; expose common minutes
  // scenarios only. Consumers must integrate their own conditional rates.
  return Array.from({ length: draws }, () => sampleCount(minutes, random));
}
