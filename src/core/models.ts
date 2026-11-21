import { z } from 'zod';
import { hash, ms, type GameLog, type League, type Prop, type Quote, type Context, type Forecast, ev } from './domain';
export const MODEL_VERSION = 'prop-baselines/1.0.0';
export const candidateSchema = z.enum(['historical', 'minutes-bootstrap', 'gamma-poisson']);
export type Candidate = z.infer<typeof candidateSchema>;
export const candidates: Candidate[] = ['historical', 'minutes-bootstrap', 'gamma-poisson'];
// Fixed research priors, NOT claims about measured current league averages. Evaluation must justify them.
const priors: Record<League, Record<Prop, number>> = { NBA: { points: .55, rebounds: .18, assists: .12, threes: .055 }, NBL: { points: .50, rebounds: .17, assists: .11, threes: .060 } };
const mean = (v: number[]) => v.reduce((a,b) => a+b, 0) / v.length;
const CAP = 500;
export function countDistribution(mu: number, dispersion: number | null): number[] {
  if (!Number.isFinite(mu) || mu < 0 || mu > 150 || dispersion !== null && (!Number.isFinite(dispersion) || dispersion <= 0)) throw new Error('Invalid count model');
  const pmf = new Array<number>(CAP + 1).fill(0);
  if (mu === 0) { pmf[0] = 1; return pmf; }
  if (dispersion === null || dispersion > 1e6) {
    pmf[0] = Math.exp(-mu);
    for (let k=1; k<=CAP; k++) pmf[k] = pmf[k-1] * mu / k;
  } else {
    const r = dispersion, p = r/(r+mu);
    pmf[0] = Math.exp(r*Math.log(p));
    for (let k=1; k<=CAP; k++) pmf[k] = pmf[k-1] * (k-1+r)/k * (1-p);
  }
  const total = pmf.reduce((a,b) => a+b,0);
  if (Math.abs(total-1)>1e-7) throw new Error('Count distribution tail incomplete');
  return pmf.map(p => p/total);
}
export function probabilities(dist: number[], line: number, side: 'over' | 'under') {
  if (!Number.isFinite(line) || line < 0 || dist.some(p => !Number.isFinite(p) || p < 0) || Math.abs(dist.reduce((a,b) => a+b,0)-1)>1e-7) throw new Error('Invalid probability distribution');
  let win=0,push=0;
  dist.forEach((p,k) => { if(k===line) push+=p; else if (side==='over'?k>line:k<line) win+=p; });
  return { win, push, loss: Math.max(0,1-win-push) };
}
export function eligibleLogs(logs: GameLog[], q: Quote, cutoff: string, retrospective = false): GameLog[] {
  const eligible = logs.filter(r => r.event.league===q.event.league && r.playerId===q.playerId && r.event.id!==q.event.id && r.final && r.participated===true && r.minutes!==null && r.minutes>=3 && r.stats[q.prop]!==null
    && ms(r.event.startsAt)<ms(cutoff) && (!r.completedAt || ms(r.completedAt)<=ms(cutoff))
    && (retrospective ? r.event.startsAt.slice(0,10)<cutoff.slice(0,10) : ms(r.observedAt)<=ms(cutoff) && ms(r.source.retrievedAt)<=ms(cutoff)));
  const latest = new Map<string, GameLog>();
  for (const r of eligible) { const key = `${r.playerId}:${r.event.id}`; if (!latest.has(key) || ms(latest.get(key)!.observedAt) < ms(r.observedAt)) latest.set(key,r); }
  return [...latest.values()].sort((a,b) => ms(a.event.startsAt)-ms(b.event.startsAt)).slice(-120);
}
const mix = (distributions: number[][], weights: number[]) => distributions[0].map((_,k) => distributions.reduce((total,d,i) => total+d[k]*weights[i],0));
function minutesMixture(minutes: number, sd: number) {
  const delta = Math.sqrt(3)*sd;
  return { values: [Math.max(1,minutes-delta),minutes,Math.min(60,minutes+delta)], weights: [1/6,2/3,1/6] };
}
export function fitDistribution(history: GameLog[], prop: Prop, league: League, minutes: number, sd: number, candidate: Candidate, contextFactor = 1): number[] {
  if (!history.length || minutes<=0 || sd<0) throw new Error('Missing training history/minutes');
  const values = history.map(r=>r.stats[prop]!), rates=history.map(r=>r.stats[prop]!/r.minutes!);
  const priorRate = priors[league][prop], baselineMinutes=league==='NBA'?30:25;
  const prior = countDistribution(priorRate*(candidate==='historical'?baselineMinutes:minutes), 6);
  if (candidate==='historical') {
    const dist = prior.map(p=>p*5);
    for(const y of values) dist[y]+=1;
    return dist.map(p=>p/(values.length+5));
  }
  const scenarios = minutesMixture(minutes, sd);
  if (candidate==='minutes-bootstrap') {
    const distributions = scenarios.values.map(m=>{
      const d=prior.map(p=>p*5);
      history.forEach((r,i)=>{
        // Paired per-game bootstrap preserves empirical production dispersion. No invented teammate covariates.
        const y=Math.min(CAP-1,Math.max(0,Math.round(rates[i]*m*contextFactor)));
        d[Math.max(0,y-1)]+=.15; d[y]+=.70; d[y+1]+=.15;
      });
      return d.map(p=>p/(history.length+5));
    });
    return mix(distributions,scenarios.weights);
  }
  // Gamma-Poisson posterior mean with fixed 240-minute prior exposure; dispersion from shrunk residuals.
  const totalMinutes=history.reduce((n,r)=>n+r.minutes!,0), totalCount=values.reduce((a,b)=>a+b,0);
  const rate=(240*priorRate+totalCount)/(240+totalMinutes);
  const empiricalMean=mean(values), variance=values.reduce((n,v)=>n+(v-empiricalMean)**2,0)/Math.max(1,values.length-1);
  const shrunkExcess=(Math.max(0,variance-empiricalMean)*values.length+10*empiricalMean)/ (values.length+10);
  const dispersion=Math.max(1,empiricalMean**2/Math.max(.01,shrunkExcess));
  return mix(scenarios.values.map(m=>countDistribution(rate*m*contextFactor,dispersion)),scenarios.weights);
}
export function forecast(logs: GameLog[], q: Quote, context: Context, at: string, candidate: Candidate, minGames=30): Forecast | null {
  if (context.expectedMinutes===null || context.minutesSD===null) return null;
  const history=eligibleLogs(logs,q,at);
  if(history.length<minGames) return null;
  const minutes=context.expectedMinutes, sd=context.minutesSD;
  const factor=(context.opponentRateFactor??1)*(context.homeRateFactor??1);
  const distribution=fitDistribution(history,q.prop,q.event.league,minutes,sd,candidate,factor);
  const p=probabilities(distribution,q.line,q.side);
  const empirical=probabilities(fitDistribution(history,q.prop,q.event.league,minutes,sd,'minutes-bootstrap',factor),q.line,q.side);
  const gamma=probabilities(fitDistribution(history,q.prop,q.event.league,minutes,sd,'gamma-poisson',factor),q.line,q.side);
  // Conservative research stress: both directions of minutes movement and an approximate sampling penalty.
  const stressed=[Math.max(1,minutes-sd),Math.min(60,minutes+sd)].map(m=>probabilities(fitDistribution(history,q.prop,q.event.league,m,sd,candidate,factor),q.line,q.side));
  const penalty=1.64*Math.sqrt(p.win*(1-p.win)/(history.length+5));
  const lowerWin=Math.max(0,Math.min(p.win,...stressed.map(s=>s.win))-penalty);
  const robustEV=Math.min(ev(lowerWin,p.push,q.decimalOdds),...stressed.map(s=>ev(Math.max(0,s.win-penalty),s.push,q.decimalOdds)));
  const limitations=['Expected minutes and production can change unexpectedly.', 'Approximate sensitivity bound; not a calibrated confidence interval.'];
  if(context.opponentRateFactor===null) limitations.push('Verified opponent adjustment unavailable; omitted.');
  if(context.homeRateFactor===null) limitations.push('Verified home/away adjustment unavailable; omitted.');
  if(!context.roleNote) limitations.push('Verified role/teammate adjustment unavailable; omitted.');
  const inputs={ logs: history,context,quote:q };
  return { model:candidate,version:MODEL_VERSION,league:q.event.league,prop:q.prop,at,cutoff:at,inputHash:hash(inputs),n:history.length,expectedMinutes:minutes,minutesSD:sd,
    mean:distribution.reduce((n,p,k)=>n+p*k,0),...p,empiricalWin:empirical.win,gammaWin:gamma.win,lowerWin,robustEV,limitations,inputs };
}
