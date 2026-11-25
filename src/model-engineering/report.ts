import type { DatabaseSync } from 'node:sqlite';
import { hash, type Prop } from '../core/domain';
import { scoreRows, pairedDifference, type ScoredPrediction } from '../research/scoring';
import { thresholds } from '../research/experiment';
import { summary } from '../research/distributions';
import { promotionRule } from './journal';
/** Stream metadata and load only primary bodies. Revisions remain immutable in SQLite. */
export function firstPredictions(db:DatabaseSync,eventIds?:string[]){
  const first=new Map<string,any>();let revisions=0;
  const rows=db.prepare('SELECT id,model_id,event_id,player_id,prop FROM engineering_predictions ORDER BY registered_at,id');
  const body=db.prepare('SELECT body FROM engineering_predictions WHERE id=?');
  for(const r of rows.iterate()){
    if(eventIds&&!eventIds.includes(String(r.event_id)))continue;
    revisions++;const family=hash([r.model_id,r.event_id,r.player_id,r.prop]);
    if(first.has(family))continue;
    const p=JSON.parse(String(body.get(r.id!)!.body)),{id,bodyHash,...record}=p;
    if(hash(record)!==bodyHash)throw Error('PREDICTION_BODY_CHANGED');
    first.set(family,p);
  }
  return{first,revisions};
}
export function engineeringReport(db: DatabaseSync, eventIds?: string[]) {
  const {first,revisions}=firstPredictions(db,eventIds);
  const holds: unknown[] = [], groups = new Map<string, { prop: Prop; modelId: string; models: Record<string, ScoredPrediction[]>; market: any[] }>();
  let pending = 0;
  for (const p of first.values()) {
    const latest = db.prepare('SELECT body FROM engineering_checks WHERE prediction_id=? ORDER BY at DESC,rowid DESC LIMIT 1').get(p.id), check = latest ? JSON.parse(String(latest.body)) : null;
    const raw = db.prepare('SELECT body FROM engineering_grades WHERE prediction_id=? ORDER BY at DESC,rowid DESC LIMIT 1').get(p.id), grade = raw ? JSON.parse(String(raw.body)) : null;
    if (check?.state === 'HELD' || !grade) { pending++; holds.push({ id: p.id, reason: check?.reason ?? 'AWAITING_FINAL', fixture: p.state.event.id }); continue; }
    const key = hash([p.artifact.id, p.prop]), g: { prop: Prop; modelId: string; models: Record<string, ScoredPrediction[]>; market: any[] } = groups.get(key) ?? { prop: p.prop as Prop, modelId: p.artifact.id, models: {}, market: [] };
    const common = { id: p.id, date: grade.date, fixture: grade.fixture, season: p.state.event.season, player: p.state.playerId, team: p.state.teamId, lowMinute: summary(p.minutesDistribution).mean < 15, y: grade.actual };
    for (const [name, pmf] of Object.entries({ M1: p.distribution, originalControl: p.originalControl.distribution, ...(p.frozenProduction ? { frozenProduction: p.frozenProduction.distribution } : {}), ...p.controls })) { const rs = g.models[name] ?? []; rs.push({ ...common, pmf: pmf as number[] }); g.models[name] = rs; }
    const observations = db.prepare('SELECT id,body FROM engineering_markets WHERE prediction_id=? ORDER BY at,id').all(p.id);
    // One earliest coherent quote observation per forecast in the primary
    // calibration cohort. Later quotes and corrections remain separately stored.
    if (observations.length) { const r = db.prepare('SELECT body FROM engineering_market_grades WHERE observation_id=? ORDER BY at DESC,rowid DESC LIMIT 1').get(observations[0].id!); if (r) g.market.push(JSON.parse(String(r.body))); }
    if (p.market && !observations.length && grade.market) g.market.push({ ...grade.market, fixture: grade.fixture, date: grade.date });
    groups.set(key, g);
  }
  return { version: 'engineering-quality/1', lifecycle: 'CHALLENGER_SHADOW_UNPROVEN', registrationRevisions: revisions, distinctModelPlayerGameProps: first.size, pending, holds,
    groups: [...groups.values()].map(g => ({ modelId: g.modelId, prop: g.prop, models: Object.fromEntries(Object.entries(g.models).map(([k, rs]) => [k, scoreRows(rs, thresholds.NBA[g.prop])])),
      M1MinusOriginalControlByDate: new Set(g.models.M1.map(r => r.date)).size < 2 ? null : pairedDifference(g.models.M1, g.models.originalControl, thresholds.NBA[g.prop], 2401, 400, 'date'),
      M1MinusEWAByDate: new Set(g.models.M1.map(r => r.date)).size < 2 ? null : pairedDifference(g.models.M1, g.models.ewa, thresholds.NBA[g.prop], 2401, 400, 'date'),
      market: { forecasts: g.market.length, decisive: g.market.filter(r => !r.push).length, dates: new Set(g.market.map(r => r.date)).size, brier: g.market.filter(r => !r.push && r.brier !== null).length ? g.market.filter(r => !r.push && r.brier !== null).reduce((s, r) => s + r.brier, 0) / g.market.filter(r => !r.push && r.brier !== null).length : null }, verdict: 'SHADOW_UNPROVEN' })),
    promotionRule, productionEnabled: false, financialResults: 'NO_ISSUED_RECOMMENDATIONS_OR_INFERRED_CASH; genuine cached quotes are research opportunities only',
    limitations: ['First registration per model/player/game/prop is the primary population; refresh revisions are correlated diagnostics', 'Frozen production forecasts may have different source cutoffs; originalControl uses the same inputs as M1', 'No date interval with fewer than two dates; minimum review breadth is not proof of skill'] };
}
