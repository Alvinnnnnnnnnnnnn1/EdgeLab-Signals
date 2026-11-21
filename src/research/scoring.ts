import { probabilities } from '../core/models';
import { average, rng, summary } from './distributions';
export interface ScoredPrediction { id: string; date: string; fixture: string; season: string; player: string; team: string; lowMinute: boolean; y: number; pmf: number[]; }
export function scoreOne(pmf: number[], y: number, lines: number[]) {
  const s = summary(pmf); let cdf = 0, crps = 0;
  pmf.forEach((p, k) => { cdf += p; crps += (cdf - Number(y <= k)) ** 2; });
  const threshold = lines.map(line => { const p = probabilities(pmf, line, 'over').win, outcome = Number(y > line), bounded = Math.max(1e-9, Math.min(1 - 1e-9, p)); return { line, p, y: outcome, brier: (p - outcome) ** 2, logLoss: -outcome * Math.log(bounded) - (1 - outcome) * Math.log(1 - bounded) }; });
  return { absoluteError: Math.abs(s.mean - y), bias: s.mean - y, crps, nll: -Math.log(Math.max(1e-12, pmf[y] ?? 0)), covered80: Number(y >= s.low && y <= s.high), width80: s.high - s.low,
    brier: average(threshold.map(t => t.brier)), logLoss: average(threshold.map(t => t.logLoss)), threshold };
}
export function scoreRows(rows: ScoredPrediction[], lines: number[]) {
  if (!rows.length) return null;
  const scores = rows.map(r => scoreOne(r.pmf, r.y, lines));
  const bins = Array.from({ length: 10 }, (_, i) => { const data = scores.flatMap((s,i) => s.threshold.map(t=>({...t,id:rows[i].id}))).filter(s => s.p >= i / 10 && (i === 9 ? s.p <= 1 : s.p < (i + 1) / 10)); return { from: i / 10, to: (i + 1) / 10, thresholds: data.length, playerGames:new Set(data.map(d=>d.id)).size, predicted: data.length ? average(data.map(s => s.p)) : null, observed: data.length ? average(data.map(s => s.y)) : null }; });
  const ece = bins.reduce((n, b) => n + b.thresholds * Math.abs((b.predicted ?? 0) - (b.observed ?? 0)), 0) / (rows.length * lines.length);
  return { playerGames: rows.length, players: new Set(rows.map(r => r.player)).size, teams: new Set(rows.map(r => r.team)).size, fixtures: new Set(rows.map(r => r.fixture)).size, dates: new Set(rows.map(r => r.date)).size, thresholdScores: rows.length * lines.length,
    mae: average(scores.map(s => s.absoluteError)), bias: average(scores.map(s => s.bias)), crps: average(scores.map(s => s.crps)), nll: average(scores.map(s => s.nll)),
    brier: average(scores.map(s => s.brier)), logLoss: average(scores.map(s => s.logLoss)), coverage80: average(scores.map(s => s.covered80)), width80: average(scores.map(s => s.width80)), ece, maxCalibrationGap:bins.some(b=>b.playerGames>=100)?Math.max(...bins.filter(b=>b.playerGames>=100).map(b=>Math.abs(b.predicted!-b.observed!))):null, bins };
}
export function pairedDifference(a: ScoredPrediction[], b: ScoredPrediction[], lines: number[], seed = 911, draws = 500, cluster: 'date' | 'fixture' = 'date') {
  if (!a.length || a.length !== b.length || a.some((r, i) => r.id !== b[i].id)) throw new Error('Paired comparisons require identical ordered player-games');
  const groups = new Map<string, { crps: number; brier: number; logLoss: number }[]>();
  a.forEach((r, i) => { const x = scoreOne(r.pmf, r.y, lines), y = scoreOne(b[i].pmf, b[i].y, lines), key = cluster === 'date' ? r.date : r.fixture;
    const g = groups.get(key) ?? []; g.push({ crps: x.crps - y.crps, brier: x.brier - y.brier, logLoss: x.logLoss - y.logLoss }); groups.set(key, g); });
  const clusters = [...groups.values()], random = rng(seed), samples = { crps: [] as number[], brier: [] as number[], logLoss: [] as number[] };
  for (let draw = 0; draw < draws; draw++) {
    const selected = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]).flat();
    for (const metric of ['crps', 'brier', 'logLoss'] as const) samples[metric].push(average(selected.map(s => s[metric])));
  }
  const interval = (values: number[]) => { const s = values.sort((a, b) => a - b); return [s[Math.floor(.025 * s.length)], s[Math.min(s.length - 1, Math.floor(.975 * s.length))]]; };
  return { cluster, clusters: clusters.length, draws, seed, interval95: { crps: interval(samples.crps), brier: interval(samples.brier), logLoss: interval(samples.logLoss) }, interpretation: 'Candidate minus comparator; negative favours candidate. Thresholds stay inside their player-game and date/fixture clusters.' };
}
