import { z } from 'zod';
import { hash, type Prop } from '../core/domain';
import { average, negativeBinomial, attemptMakeDistribution, mixPMFs, normal, rng, sampleCount, summary, COUNT_CAP } from './distributions';
import { boostedMean, type BoostedModel } from './boost';
import type { FeatureSet } from './features';
export const RESEARCH_VERSION = 'prop-research/1.1.0';
export const researchCandidateSchema = z.enum(['last5', 'last10', 'ewa', 'season-shrunk', 'recent-rate', 'hierarchical-nb', 'minutes-mc', 'attempts-beta-binomial', 'boosted-stumps-nb', 'boosted-form-only', 'ensemble']);
export type ResearchCandidate = z.infer<typeof researchCandidateSchema>;
export const controls: ResearchCandidate[] = ['last5', 'last10', 'ewa', 'season-shrunk', 'recent-rate'];
export interface Prediction { pmf: number[]; participation: number | null; minutes: number; minutesSD: number; seed: number | null; scenarios: { low: number; high: number }; limitations: string[]; }
export interface ModelSpec { candidate: ResearchCandidate; seed: number; draws: number; priorMinutes: number; boosted?: BoostedModel; ensemble?: { members: ModelSpec[]; weights: number[] }; }
export function modelSpec(candidate: ResearchCandidate, priorMinutes = 120): ModelSpec { return { candidate, priorMinutes, seed: 1729, draws: 4000 }; }
export function predict(f: FeatureSet, spec: ModelSpec): Prediction | null {
  const counts = f.history.map(r => r.log.stats[f.prop]!), recent = counts.slice(-10), avg = average(counts);
  const variance = counts.reduce((n, y) => n + (y - avg) ** 2, 0) / Math.max(1, counts.length - 1);
  const leagueRate = f.leagueHistory.reduce((n, r) => n + r.log.stats[f.prop]!, 0) / f.leagueHistory.reduce((n, r) => n + r.log.minutes!, 0);
  const weights = f.history.map((_, i) => Math.exp(-Math.LN2 * (counts.length - 1 - i) / 20));
  const rate = (counts.reduce((n, y, i) => n + y * weights[i], 0) + spec.priorMinutes * leagueRate) / (f.history.reduce((n, r, i) => n + r.log.minutes! * weights[i], 0) + spec.priorMinutes);
  const dispersion = Math.max(.5, avg ** 2 / Math.max(.1, variance - avg));
  const nb = (mean: number) => negativeBinomial(mean, mean + mean ** 2 / dispersion);
  let pmf: number[], seed: number | null = null;
  const limitations = [...f.missing];
  switch (spec.candidate) {
    case 'last5': pmf = nb(f.last5); break;
    case 'last10': pmf = nb(f.last10); break;
    case 'ewa': pmf = nb(f.ewa); break;
    case 'season-shrunk': pmf = nb(f.seasonShrunk); break;
    case 'recent-rate': pmf = nb(f.rate * f.minutes); break;
    case 'hierarchical-nb': pmf = nb(rate * f.minutes); break;
    case 'minutes-mc': {
      seed = Number.parseInt(hash([spec.seed, f.playerId, f.cutoff, f.prop]).slice(0, 8), 16);
      const random = rng(seed), minutesHistory = f.history.slice(-20).map(r => r.log.minutes!), maximum = f.league === 'NBA' ? 48 : 40;
      const hist = new Array<number>(COUNT_CAP + 1).fill(0), n = spec.draws;
      const knownOT=f.history.filter(r=>r.metadata.overtimePeriods!==null),minuteAverage=average(minutesHistory),pmfCache=new Map<number,number[]>();
      if (!Number.isInteger(n) || n < 1000 || n > 100000) throw new Error('Bounded Monte Carlo draws required');
      for (let draw = 0; draw < n; draw++) {
        const residual = minutesHistory[Math.floor(random() * minutesHistory.length)] - minuteAverage;
        // Earlier observed OT labels can support an OT mixture. Unknown is never encoded as no OT.
        const overtime = knownOT.length ? knownOT[Math.floor(random() * knownOT.length)].metadata.overtimePeriods! : null;
        const cap = maximum + 5 * (overtime ?? 0);
        const minutes = Math.max(1, Math.min(cap, f.minutes + residual + normal(random) * .5));
        const bucket=Math.round(minutes*2)/2;let distribution=pmfCache.get(bucket);if(!distribution){distribution=nb(rate*bucket);pmfCache.set(bucket,distribution);}hist[sampleCount(distribution, random)]++;
      }
      // A small analytic component prevents finite-draw zero probabilities from masquerading as impossibility.
      pmf = mixPMFs([hist.map(v => v / n), nb(rate * f.minutes)], [.99, .01]);
      if (f.history.some(r => r.metadata.overtimePeriods === null)) limitations.push('Overtime coverage incomplete; regulation minutes cap sensitivity only.');
      if (f.participation === null) limitations.push('Participation denominator unverified; cannot supply a live DNP probability.');
      break;
    }
    case 'attempts-beta-binomial': {
      if (f.prop !== 'threes' || f.history.some(r => r.metadata.threeAttempts === null)) return null;
      const attempts = f.history.map(r => r.metadata.threeAttempts!), total = attempts.reduce((a, b) => a + b, 0), made = counts.reduce((a, b) => a + b, 0);
      const leagueKnown = f.leagueHistory.filter(r => r.metadata.threeAttempts !== null), leagueAttempts = leagueKnown.reduce((n, r) => n + r.metadata.threeAttempts!, 0);
      if (!total || !leagueAttempts) return null;
      const leaguePct = leagueKnown.reduce((n, r) => n + r.log.stats.threes!, 0) / leagueAttempts;
      const attemptMean = attempts.reduce((n, a, i) => n + a * weights[i], 0) / f.history.reduce((n, r, i) => n + r.log.minutes! * weights[i], 0) * f.minutes;
      const aMean = average(attempts), aVariance = average(attempts.map(v => (v - aMean) ** 2));
      pmf = attemptMakeDistribution(attemptMean, Math.max(attemptMean, aVariance), made + .5 + 20 * leaguePct, total - made + .5 + 20 * (1 - leaguePct)); break;
    }
    case 'boosted-stumps-nb': case 'boosted-form-only': {
      if (!spec.boosted) return null;
      const mean = boostedMean(spec.boosted, f.values); pmf = negativeBinomial(mean, mean + spec.boosted.varianceExcess); break;
    }
    case 'ensemble': {
      if (!spec.ensemble) return null;
      const predictions = spec.ensemble.members.map(m => predict(f, m));
      if (predictions.some(p => p === null)) return null;
      pmf = mixPMFs(predictions.map(p => p!.pmf), spec.ensemble.weights); break;
    }
  }
  summary(pmf);
  return { pmf, participation: f.participation, minutes: f.minutes, minutesSD: f.minutesSD, seed,
    scenarios: { low: Math.max(1, f.minutes - 1.64 * f.minutesSD), high: Math.min(f.league === 'NBA' ? 48 : 40, f.minutes + 1.64 * f.minutesSD) }, limitations };
}
