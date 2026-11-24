import { summary } from '../research/distributions';
import { bound } from './m1';
export type CDFCalibration = { method: 'identity' } | { method: 'platt' | 'beta'; a: number; b: number; c: number; fittedDates: string[]; fittedRows: number };
const logistic = (x: number) => 1 / (1 + Math.exp(-bound(x, -40, 40)));
export function cdfMap(p: number, cal: CDFCalibration) {
  if (cal.method === 'identity' || p === 0 || p === 1) return p;
  p = bound(p, 1e-12, 1 - 1e-12);
  return logistic(cal.a * Math.log(p) - cal.b * Math.log1p(-p) + cal.c);
}
export function calibratePMF(pmf: number[], cal: CDFCalibration) {
  summary(pmf); let cdf = 0, previous = 0;
  const p = pmf.map((mass, k) => { cdf += mass; const next = k === pmf.length - 1 ? 1 : cdfMap(bound(cdf, 0, 1), cal), result = next - previous; previous = next; return Math.max(0, result); });
  summary(p); return p;
}
/** Research CDF thresholds, not selected bookmaker lines. Equal total weight
 * per player-game; date breadth is required in addition to row count. */
export function fitCDF(rows: { date: string; pmf: number[]; y: number }[], method: 'platt' | 'beta', before: string): CDFCalibration | null {
  const dates = [...new Set(rows.map(r => r.date))].sort();
  if (rows.some(r => r.date >= before.slice(0, 10))) throw Error('CALIBRATION_TIME_LEAK');
  if (dates.length < 6 || rows.length < 200) return null;
  const data = rows.flatMap(r => {
    let cdf = 0; const pairs: { x: number; z: number; y: number; w: number }[] = [];
    r.pmf.forEach((p, k) => { cdf += p; if (cdf > .01 && cdf < .99) pairs.push({ x: Math.log(cdf), z: -Math.log1p(-cdf), y: Number(r.y <= k), w: 0 }); });
    return pairs.map(p => ({ ...p, w: 1 / Math.max(1, pairs.length) / rows.length }));
  });
  let a = 1, b = 1, c = 0;
  for (let i = 0; i < 200; i++) {
    let ga = .02 * (a - 1), gb = .02 * (b - 1), gc = .02 * c;
    for (const d of data) { const error = (logistic(a * d.x + b * d.z + c) - d.y) * d.w; ga += error * d.x; gb += error * d.z; gc += error; }
    if (method === 'platt') { a = bound(a - .08 * (ga + gb), .05, 5); b = a; }
    else { a = bound(a - .08 * ga, .05, 5); b = bound(b - .08 * gb, .05, 5); }
    c = bound(c - .08 * gc, -3, 3);
  }
  return { method, a, b, c, fittedDates: dates, fittedRows: rows.length };
}
