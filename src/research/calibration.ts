import { summary } from './distributions';
export type Calibration = { method: 'raw' } | { method: 'sigmoid'; a: number; b: number } | { method: 'isotonic'; x: number[]; y: number[] };
export interface CalibrationRow { pmf: number[]; y: number; }
const clip = (p: number) => Math.max(1e-8, Math.min(1 - 1e-8, p));
const logit = (p: number) => Math.log(clip(p) / (1 - clip(p)));
const logistic = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
function pairs(rows: CalibrationRow[]) {
  return rows.flatMap(r => {
    let cdf = 0; const result: { p: number; y: number }[] = [];
    r.pmf.forEach((p, k) => { cdf += p; if (cdf > .01 && cdf < .99) result.push({ p: cdf, y: Number(r.y <= k) }); });
    // Equal per-player-game weight, independent of the number of useful integer cutoffs.
    return result.map(s => ({ ...s, w: 1 / Math.max(1, result.length) }));
  });
}
export function fitCalibration(rows: CalibrationRow[], method: 'sigmoid' | 'isotonic'): Calibration | null {
  if (rows.length < 200) return null;
  const data = pairs(rows); if (!data.length) return null;
  if (method === 'sigmoid') {
    let a = 1, b = 0;
    for (let iteration = 0; iteration < 200; iteration++) {
      let ga = .01 * (a - 1), gb = .01 * b;
      for (const d of data) { const x = logit(d.p), error = logistic(a * x + b) - d.y; ga += error * x * d.w / rows.length; gb += error * d.w / rows.length; }
      a = Math.max(.05, Math.min(5, a - .1 * ga)); b = Math.max(-5, Math.min(5, b - .1 * gb));
    }
    return { method, a, b };
  }
  // Pool-adjacent-violators over unique CDF probabilities, with bounded end points.
  const groups = new Map<number, { w: number; y: number }>();
  for (const d of data) { const old = groups.get(d.p) ?? { w: 0, y: 0 }; groups.set(d.p, { w: old.w + d.w, y: old.y + d.y * d.w }); }
  const blocks: { lo: number; hi: number; w: number; y: number }[] = [];
  for (const [p, d] of [...groups.entries()].sort(([a], [b]) => a - b)) {
    blocks.push({ lo: p, hi: p, ...d });
    while (blocks.length > 1 && blocks.at(-2)!.y / blocks.at(-2)!.w > blocks.at(-1)!.y / blocks.at(-1)!.w) {
      const right = blocks.pop()!, left = blocks.pop()!; blocks.push({ lo: left.lo, hi: right.hi, w: left.w + right.w, y: left.y + right.y });
    }
  }
  return { method, x: [0, ...blocks.flatMap(b => [b.lo, b.hi]), 1], y: [0, ...blocks.flatMap(b => [b.y / b.w, b.y / b.w]), 1] };
}
export function calibrateCDF(pmf: number[], calibration: Calibration): number[] {
  if (calibration.method === 'raw') return [...pmf];
  const transform = (p: number) => {
    if (p <= 1e-12) return 0; if (p >= 1 - 1e-12) return 1;
    if (calibration.method === 'sigmoid') return logistic(calibration.a * logit(p) + calibration.b);
    const { x, y } = calibration; let i = 0; while (i + 1 < x.length && x[i + 1] <= p) i++;
    if (i + 1 === x.length) return y[i]; const span = x[i + 1] - x[i]; return span ? y[i] + (y[i + 1] - y[i]) * (p - x[i]) / span : y[i];
  };
  let cdf = 0, previous = 0;
  const result = pmf.map(p => { cdf += p; const next = transform(cdf), mass = Math.max(0, next - previous); previous = next; return mass; });
  const total = result.reduce((a, b) => a + b, 0); const normalized = result.map(p => p / total); summary(normalized); return normalized;
}
