import { ms, type Prop, type League } from '../core/domain';
import { utcDay, rowKey, type ResearchRow } from './dataset';
export type KnowledgeMode = 'as-of' | 'retrospective';
export interface FeatureSet {
  playerId: string; league: League; prop: Prop; cutoff: string; history: ResearchRow[]; opportunities:ResearchRow[]; leagueHistory: ResearchRow[];
  values: number[]; names: string[]; missing: string[];
  last5: number; last10: number; ewa: number; seasonShrunk: number; rate: number;
  minutes: number; minutesSD: number; participation: number | null; recentTeamChanged: boolean;
}
export function priorRows(rows: ResearchRow[], cutoff: string, mode: KnowledgeMode) {
  const latest = new Map<string, ResearchRow>();
  for (const r of rows) {
    const l = r.log;
    if (utcDay(l.event.startsAt) >= utcDay(cutoff) || l.completedAt && ms(l.completedAt) >= ms(cutoff)) continue;
    if (mode === 'as-of' && (ms(l.observedAt) >= ms(cutoff) || [l.source, ...(l.supportingSources ?? [])].some(s => ms(s.retrievedAt) >= ms(cutoff)))) continue;
    const previous = latest.get(rowKey(r));
    if (!previous || ms(previous.log.observedAt) < ms(l.observedAt)) latest.set(rowKey(r), r);
  }
  return [...latest.values()].sort((a, b) => ms(a.log.event.startsAt) - ms(b.log.event.startsAt));
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function features(rows: ResearchRow[], target: Pick<ResearchRow['log'], 'event' | 'playerId' | 'teamId'>, prop: Prop, mode: KnowledgeMode, asOf?:string): FeatureSet | null {
  const available = priorRows(rows, asOf??target.event.startsAt, mode).filter(r => r.log.event.league === target.event.league);
  return availableFeatures(available,target,prop);
}
function availableFeatures(available:ResearchRow[],target:Pick<ResearchRow['log'],'event'|'playerId'|'teamId'>,prop:Prop):FeatureSet|null{
  const player = available.filter(r => r.log.playerId === target.playerId).slice(-120);
  const history = player.filter(r => r.log.participated === true && r.log.minutes !== null && r.log.minutes > 0 && r.log.stats[prop] !== null);
  if (history.length < 10) return null;
  const leagueHistory = available.filter(r => r.log.participated === true && r.log.minutes !== null && r.log.minutes > 0 && r.log.stats[prop] !== null);
  if (!leagueHistory.length) return null;
  const counts = history.map(r => r.log.stats[prop]!), recent = history.slice(-10), mins = recent.map(r => r.log.minutes!);
  const weights = counts.map((_, i) => Math.exp(-Math.LN2 * (counts.length - 1 - i) / 10)), weightSum = weights.reduce((a, b) => a + b, 0);
  const ewa = counts.reduce((n, y, i) => n + y * weights[i], 0) / weightSum;
  const leagueRate = leagueHistory.reduce((n, r) => n + r.log.stats[prop]!, 0) / leagueHistory.reduce((n, r) => n + r.log.minutes!, 0);
  const minutes = avg(mins), minutesSD = Math.max(1, Math.sqrt(avg(mins.map(m => (m - minutes) ** 2))));
  const season = history.filter(r => r.log.event.season === target.event.season), seasonMean = (season.reduce((n, r) => n + r.log.stats[prop]!, 0) + 5 * leagueRate * minutes + 5 * avg(counts)) / (season.length + 10);
  const totalMinutes = history.reduce((n, r, i) => n + r.log.minutes! * weights[i], 0);
  const rate = (counts.reduce((n, y, i) => n + y * weights[i], 0) + 120 * leagueRate) / (totalMinutes + 120);
  const roster = player.filter(r => r.metadata.rosterOpportunityVerified && r.log.participated !== null).slice(-30);
  const participation = roster.length >= 10 ? (roster.filter(r => r.log.participated).length + 1) / (roster.length + 2) : null;
  const last = history.at(-1)!, restDays = (ms(target.event.startsAt) - ms(last.log.event.startsAt)) / 86400000;
  const last5 = avg(counts.slice(-5)), last10 = avg(counts.slice(-10)), changed = last.log.teamId !== target.teamId;
  // Only facts derivable from prior logs and the pregame fixture. No target minutes, outcomes, injury revisions, pace, or inferred travel.
  const values = [last5, last10, ewa, seasonMean, minutes, minutesSD, rate, Math.min(14, restDays), Number(target.teamId === target.event.homeId), Number(changed)];
  return { playerId: target.playerId, league: target.event.league, prop, cutoff: target.event.startsAt, history, opportunities:roster, leagueHistory, values,
    names: ['last5', 'last10', 'ewa', 'seasonShrunk', 'minutes', 'minutesSD', 'rate', 'restDays', 'home', 'teamChanged'],
    missing: ['verified injury/availability history', 'usage', 'pace', 'travel', 'opponent defensive opportunities'], last5, last10, ewa, seasonShrunk: seasonMean, rate, minutes, minutesSD, participation, recentTeamChanged: changed };
}
/** Immutable experiment-local index: numeric clocks are parsed once. Every
 * revision, strict observation cutoff and UTC-day boundary matches priorRows. */
export function preparedFeatures(rows:ResearchRow[],mode:KnowledgeMode){
  const indexed=rows.map(r=>({r,key:rowKey(r),day:utcDay(r.log.event.startsAt),start:ms(r.log.event.startsAt),observed:ms(r.log.observedAt),completed:r.log.completedAt?ms(r.log.completedAt):null,known:Math.max(ms(r.log.observedAt),...[r.log.source,...(r.log.supportingSources??[])].map(s=>ms(s.retrievedAt)))}));
  const daily=mode==='retrospective'&&indexed.every(r=>r.completed===null),cache=new Map<string,ResearchRow[]>();
  return(target:Pick<ResearchRow['log'],'event'|'playerId'|'teamId'>,prop:Prop,asOf?:string)=>{
    const cutoff=asOf??target.event.startsAt,day=utcDay(cutoff),time=ms(cutoff),key=`${target.event.league}:${daily?day:time}`;
    let available=cache.get(key);
    if(!available){const latest=new Map<string,typeof indexed[number]>();for(const row of indexed){if(row.r.log.event.league!==target.event.league||row.day>=day||row.completed!==null&&row.completed>=time||mode==='as-of'&&row.known>=time)continue;const previous=latest.get(row.key);if(!previous||previous.observed<row.observed)latest.set(row.key,row);}available=[...latest.values()].sort((a,b)=>a.start-b.start).map(r=>r.r);cache.set(key,available);}
    return availableFeatures(available,target,prop);
  };
}
