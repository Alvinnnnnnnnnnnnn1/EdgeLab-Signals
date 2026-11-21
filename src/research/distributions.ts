import { countDistribution } from '../core/models';
export const COUNT_CAP = 500;
export const average = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
export function rng(seed: number) { let x = seed >>> 0; return () => { x += 0x6D2B79F5; let t = x; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function normal(random: () => number) { return Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random()); }
export function mixPMFs(pmfs: number[][], weights: number[]) {
  if (!pmfs.length || pmfs.length !== weights.length || weights.some(w => w < 0) || Math.abs(weights.reduce((a, b) => a + b, 0) - 1) > 1e-8) throw new Error('Invalid mixture');
  return pmfs[0].map((_, k) => pmfs.reduce((n, p, i) => n + (p[k] ?? 0) * weights[i], 0));
}
export function negativeBinomial(mean: number, variance: number) {
  return countDistribution(Math.max(0, mean), variance <= mean + 1e-6 ? null : Math.max(.5, mean ** 2 / (variance - mean)));
}
export function betaBinomial(n: number, alpha: number, beta: number): number[] {
  if (!Number.isInteger(n) || n < 0 || n > 100 || alpha <= 0 || beta <= 0) throw new Error('Invalid attempt/make distribution');
  // Product representation avoids factorial overflow and carries binomial uncertainty in the success probability.
  const p = new Array<number>(COUNT_CAP + 1).fill(0); let p0 = 1;
  for (let i = 0; i < n; i++) p0 *= (beta + i) / (alpha + beta + i);
  p[0] = p0;
  for (let k = 1; k <= n; k++) p[k] = p[k - 1] * (n - k + 1) / k * (alpha + k - 1) / (beta + n - k);
  return p;
}
export function attemptMakeDistribution(attemptMean: number, attemptVariance: number, alpha: number, beta: number) {
  const attempts = negativeBinomial(attemptMean, attemptVariance), pmf = new Array<number>(COUNT_CAP + 1).fill(0);
  const tail = attempts.slice(61).reduce((a, b) => a + b, 0);
  if (tail > 1e-7) throw new Error('Unsupported three-attempt tail');
  for (let n = 0; n <= 60; n++) { if (attempts[n] < 1e-14) continue; const makes = betaBinomial(n, alpha, beta); for (let k = 0; k <= n; k++) pmf[k] += attempts[n] * makes[k]; }
  const total = pmf.reduce((a, b) => a + b, 0); return pmf.map(p => p / total);
}
export function sampleCount(pmf: number[], random: () => number) { let u = random(); for (let k = 0; k < pmf.length; k++) { u -= pmf[k]; if (u <= 0) return k; } return pmf.length - 1; }
export function summary(pmf: number[]) {
  const total = pmf.reduce((a, b) => a + b, 0);
  if (pmf.some(p => !Number.isFinite(p) || p < 0) || Math.abs(total - 1) > 1e-7) throw new Error('Incomplete probability distribution');
  const quantile = (q: number) => { let c = 0; for (let k = 0; k < pmf.length; k++) { c += pmf[k]; if (c >= q) return k; } return pmf.length - 1; };
  return { mean: pmf.reduce((n, p, k) => n + p * k, 0), low: quantile(.1), high: quantile(.9) };
}
