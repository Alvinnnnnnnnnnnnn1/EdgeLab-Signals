export interface Stump { feature: number; threshold: number; left: number; right: number; }
export interface BoostedModel { base: number; learningRate: number; stumps: Stump[]; features: number[]; varianceExcess: number; }
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
// Deliberately small CPU alternative to a large LightGBM/XGBoost stack. It predicts log counts;
// the count variance is estimated separately from training residuals, never test outcomes.
export function fitBoosted(x: number[][], y: number[], features: number[], trees = 30): BoostedModel {
  if (x.length !== y.length || x.length < 200 || !features.length || x.some(r => r.some(v => !Number.isFinite(v)))) throw new Error('Boosted challenger requires 200 complete earlier training rows');
  const target = y.map(v => Math.log1p(v)), base = mean(target), prediction = target.map(() => base), stumps: Stump[] = [], learningRate = .05;
  for (let round = 0; round < trees; round++) {
    const residual = target.map((v, i) => v - prediction[i]); let best: Stump | null = null, loss = Infinity;
    for (const feature of features) {
      const sorted = x.map(r => r[feature]).sort((a, b) => a - b);
      for (const q of [.2, .4, .6, .8]) {
        const threshold = sorted[Math.floor(q * (sorted.length - 1))], left: number[] = [], right: number[] = [];
        x.forEach((r, i) => (r[feature] <= threshold ? left : right).push(residual[i]));
        if (left.length < 20 || right.length < 20) continue;
        const l = mean(left), r = mean(right), candidateLoss = left.reduce((n, v) => n + (v - l) ** 2, 0) + right.reduce((n, v) => n + (v - r) ** 2, 0);
        if (candidateLoss < loss) { loss = candidateLoss; best = { feature, threshold, left: l, right: r }; }
      }
    }
    if (!best) break; const stump = best; stumps.push(stump);
    x.forEach((r, i) => prediction[i] += learningRate * (r[stump.feature] <= stump.threshold ? stump.left : stump.right));
  }
  const means = prediction.map(p => Math.max(.01, Math.expm1(p)));
  const varianceExcess = Math.max(0, mean(y.map((v, i) => (v - means[i]) ** 2 - means[i])));
  return { base, learningRate, stumps, features, varianceExcess };
}
export function boostedMean(model: BoostedModel, x: number[]) { return Math.max(.01, Math.min(150, Math.expm1(model.base + model.learningRate * model.stumps.reduce((n, s) => n + (x[s.feature] <= s.threshold ? s.left : s.right), 0)))); }
