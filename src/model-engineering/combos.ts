import { hash, type GameLog } from '../core/domain';
import { average, negativeBinomial, summary } from '../research/distributions';
import { latestRows, type RetainedRow } from './data';
export const combinations = {
  PRA: { components: ['points', 'rebounds', 'assists'], market: 'player_points_rebounds_assists' },
  PA: { components: ['points', 'assists'], market: 'player_points_assists' },
  PR: { components: ['points', 'rebounds'], market: 'player_points_rebounds' },
  RA: { components: ['rebounds', 'assists'], market: 'player_rebounds_assists' },
} as const;
export type Combination = keyof typeof combinations;
export const combinationNames = Object.keys(combinations) as Combination[];
export function combinedTarget(log: GameLog, combination: Combination) {
  if (!log.final) return { state: 'UNRESOLVED' as const, value: null };
  if (log.participated === false) return { state: 'DNP_CONFIRMED' as const, value: null };
  if (log.participated !== true || log.minutes === null || log.minutes <= 0) return { state: 'UNRESOLVED' as const, value: null };
  const values = combinations[combination].components.map(p => log.stats[p]);
  return values.some(v => v === null) ? { state: 'INCOMPLETE' as const, value: null } : { state: 'COMPLETE' as const, value: values.reduce<number>((s, v) => s + v!, 0) };
}
export function combinationHistory(rows: RetainedRow[], playerId: string, eventId: string, cutoff: string, mode: 'as-of' | 'retrospective', combination: Combination) {
  return latestRows(rows, cutoff, mode).filter(r => r.log.playerId === playerId && r.log.event.id !== eventId && combinedTarget(r.log, combination).state === 'COMPLETE').slice(-120);
}
export type CombinationMethod = 'last5' | 'last10' | 'ewa' | 'season-shrunk' | 'empirical' | 'shared-minutes-paired-rates';
/** Experimental direct targets and paired historical vectors. The joint
 * resampling preserves contemporaneous components and common minutes once;
 * it does not claim empirical joint calibration or authorise a market. */
export function combinationPMF(history: RetainedRow[], combination: Combination, method: CombinationMethod, minutesPMF?: number[], season?: string) {
  if (history.length < 10 || history.some(r => combinedTarget(r.log, combination).state !== 'COMPLETE')) throw Error('TEN_COMPLETE_SAME_GAME_TOTALS_REQUIRED');
  const values = history.map(r => combinedTarget(r.log, combination).value!), mean = average(values), variance = average(values.map(v => (v - mean) ** 2)), excess = Math.max(0, variance - mean) / Math.max(1, mean ** 2);
  const nb = (mu: number) => negativeBinomial(mu, mu + excess * mu ** 2), weights = values.map((_, i) => 2 ** (-(values.length - 1 - i) / 10)), total = weights.reduce((a, b) => a + b, 0);
  if (method === 'last5') return nb(average(values.slice(-5)));
  if (method === 'last10') return nb(average(values.slice(-10)));
  if (method === 'ewa') return nb(values.reduce((s, v, i) => s + weights[i] * v, 0) / total);
  if (method === 'season-shrunk') { const current = history.flatMap((r, i) => r.log.event.season === season ? [values[i]] : []); return nb((current.reduce((s, v) => s + v, 0) + 10 * mean) / (current.length + 10)); }
  const pmf = new Array<number>(501).fill(0);
  if (method === 'empirical') values.forEach((v, i) => { pmf[v] += weights[i] / total; });
  else {
    if (!minutesPMF || minutesPMF[0] !== 0) throw Error('COMMON_POSITIVE_MINUTES_REQUIRED'); summary(minutesPMF);
    minutesPMF.forEach((w, m) => { if (w) history.forEach((r, i) => { const count = Math.round(values[i] * m / r.log.minutes!); if (count > 500) throw Error('COMBINATION_TAIL_OUTSIDE_SUPPORT'); pmf[count] += w * weights[i] / total; }); });
  }
  const smooth = nb(mean), result = pmf.map((p, k) => .95 * p + .05 * smooth[k]); summary(result); return result;
}
export function independentConvolutionDiagnostic(components: number[][]) {
  if (!components.length) throw Error('COMPONENT_PMFS_REQUIRED'); components.forEach(summary);
  let result = [1];
  for (const p of components) { const next = new Array<number>(result.length + p.length - 1).fill(0); result.forEach((a, i) => { if (a) p.forEach((b, j) => { if (b) next[i + j] += a * b; }); }); result = next; }
  summary(result); return { pmf: result, assumption: 'INDEPENDENT_COMPONENT_DIAGNOSTIC_ONLY', lifecycle: 'RESEARCH_ONLY', productionEnabled: false };
}
export function withinPlayerRateDependence(history: RetainedRow[]) {
  const complete = history.filter(r => combinationNames.every(c => combinedTarget(r.log, c).state === 'COMPLETE'));
  const rate = (p: 'points' | 'rebounds' | 'assists') => complete.map(r => r.log.stats[p]! / r.log.minutes!);
  const corr = (a: number[], b: number[]) => { const ma = average(a), mb = average(b), va = a.reduce((s, v) => s + (v - ma) ** 2, 0), vb = b.reduce((s, v) => s + (v - mb) ** 2, 0); return a.length < 10 || va * vb === 0 ? null : a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / Math.sqrt(va * vb); };
  if (new Set(complete.map(r => r.log.playerId)).size > 1) throw Error('WITHIN_PLAYER_GROUP_REQUIRED');
  return { n: complete.length, pointsRebounds: corr(rate('points'), rate('rebounds')), pointsAssists: corr(rate('points'), rate('assists')), reboundsAssists: corr(rate('rebounds'), rate('assists')), inputHash: hash(complete.map(r => r.ref)), causal: false };
}
export const playerFixtureExposureGroup = (eventId: string, playerId: string) => hash(['player-fixture', eventId, playerId]);
export const combinationLifecycle = { state: 'RESEARCH_ONLY', prospectiveEnabled: false, marketAcquisitionEnabled: false, deliveryEnabled: false, defaultFuturePlayerFixtureLimit: 1,
  activationRequirements: ['Safe independent core cutover', 'Complete chronological and independently frozen prospective evidence', 'Exact bookmaker-specific coverage/OT/DNP/push/revision terms', 'Separate finite market grant and Telegram scope', 'Explicit transactional cross-market exposure policy; original single-prop claims stay unchanged'] } as const;
