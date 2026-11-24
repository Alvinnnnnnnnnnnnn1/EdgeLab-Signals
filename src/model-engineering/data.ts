import { hash, ms, gameLogSchema, type GameLog } from '../core/domain';
import type { Store } from '../core/store';
import { unknownMetadata, rowKey, type ResearchRow } from '../research/dataset';

export interface RetainedRow extends ResearchRow { ref: { id: string; bodyHash: string } }
export const knownAt = (l: GameLog) => Math.max(ms(l.observedAt), ...[l.source, ...(l.supportingSources ?? [])].map(s => ms(s.retrievedAt)));
/** One read transaction is owned by the caller. Every revision remains present;
 * selection of a correction is performed at the individual forecast cutoff. */
export function retainedRows(store: Store, at: string): RetainedRow[] {
  return store.db.prepare('SELECT id,body FROM logs WHERE observed_at<=? ORDER BY observed_at,id').all(at).map(r => {
    const log = gameLogSchema.parse(JSON.parse(String(r.body)));
    if (log.source.simulated || !log.final || [log.source, ...(log.supportingSources ?? [])].some(s => s.simulated || !store.hasReceipt(s))) throw Error('GENUINE_RETAINED_FINAL_REQUIRED');
    return { log, metadata: log.research ?? unknownMetadata(), ref: { id: String(r.id), bodyHash: hash(String(r.body)) } };
  });
}
export function latestRows(rows: RetainedRow[], cutoff: string, mode: 'as-of' | 'retrospective'): RetainedRow[] {
  const latest = new Map<string, RetainedRow>();
  for (const r of rows) {
    const l = r.log;
    if (l.event.startsAt.slice(0, 10) >= cutoff.slice(0, 10) || l.completedAt && ms(l.completedAt) >= ms(cutoff) || mode === 'as-of' && knownAt(l) >= ms(cutoff)) continue;
    const old = latest.get(rowKey(r));
    if (!old || ms(old.log.observedAt) < ms(l.observedAt)) latest.set(rowKey(r), r);
    else if (old.log.observedAt === l.observedAt && hash(old.log) !== hash(l)) throw Error('AMBIGUOUS_REVISION');
  }
  return [...latest.values()].sort((a, b) => a.log.event.startsAt.localeCompare(b.log.event.startsAt) || rowKey(a).localeCompare(rowKey(b)));
}
export function capabilityMatrix(store: Store, rows: RetainedRow[], at: string) {
  const latest = latestRows(rows, '9999-12-31T23:59:59.000Z', 'retrospective'), eligible = latest.filter(r => r.log.participated === true && r.log.minutes !== null && r.log.minutes > 0);
  const breadth = (rs: RetainedRow[]) => ({ rows: rs.length, dates: new Set(rs.map(r => r.log.event.startsAt.slice(0, 10))).size, fixtures: new Set(rs.map(r => r.log.event.id)).size, players: new Set(rs.map(r => r.log.playerId)).size });
  const raw = new Map<string, Map<string, Record<string, unknown>>>();
  const rawFor = (l: GameLog) => {
    if (!raw.has(l.source.hash)) {
      const body = JSON.parse(String(store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(l.source.hash)!.body));
      raw.set(l.source.hash, new Map((Array.isArray(body.data) ? body.data : []).filter((v: any) => v.game?.id && v.player?.id).map((v: any) => [`${v.game.id}:${v.player.id}`, v])));
    }
    return raw.get(l.source.hash)!.get(`${l.event.id.split(':').at(-1)}:${l.playerId.split(':').at(-1)}`);
  };
  const fields = Object.fromEntries(['fg3a', 'fg3m', 'fga', 'fgm', 'fta', 'ftm', 'starter', 'start_position'].map(k => [k, breadth(eligible.filter(r => rawFor(r.log)?.[k] !== undefined && rawFor(r.log)?.[k] !== null))]));
  const sources = store.db.prepare("SELECT json_extract(body,'$.endpoint') endpoint,count(*) receipts,min(json_extract(body,'$.retrievedAt')) first,max(json_extract(body,'$.retrievedAt')) last FROM source_receipts GROUP BY endpoint").all();
  const quotes = store.db.prepare("SELECT count(*) sides,count(DISTINCT json_extract(body,'$.quote.event.id')) fixtures,count(DISTINCT substr(json_extract(body,'$.quote.event.startsAt'),1,10)) dates,min(at) first,max(at) last FROM experimental_candidates").get();
  return { at, originHash: hash(rows.map(r => r.ref)), revisions: rows.length, latest: breadth(latest), participating: breadth(eligible), corrections: rows.length - latest.length,
    gameSpan: [latest[0]?.log.event.startsAt, latest.at(-1)?.log.event.startsAt], receiptSpan: [rows[0]?.log.observedAt, rows.at(-1)?.log.observedAt],
    genuinelyPriorReceiptTargets: breadth(eligible.filter(r => rows.some(p => p.log.playerId === r.log.playerId && p.log.event.id !== r.log.event.id && p.log.event.startsAt.slice(0, 10) < r.log.event.startsAt.slice(0, 10) && knownAt(p.log) < ms(r.log.event.startsAt)))),
    missingMinutes: latest.filter(r => r.log.minutes === null).length, unknownParticipation: latest.filter(r => r.log.participated === null).length,
    attemptMetadata: breadth(eligible.filter(r => r.metadata.threeAttempts !== null)), rawFieldCoverage: fields, quoteArchive: quotes, sources,
    availableNow: ['Retained genuine finals and historical game-team affiliations; retrospective lag-only research', 'Receipt-clock as-of features only where actually received before cutoff', 'Cached original quote and forecast journals; no network required'],
    explicitApprovalRequired: ['Any new paid or historical odds requests', 'New provider, official injury collector, remote hosting, new bookmaker transport', 'Model/policy promotion or exposure activation outside independently approved scope'],
    unavailable: ['Historical pregame lineup/starting-role archive', 'Historical injury snapshots before first retained receipt', 'Historical betting ROI without contemporaneous odds'],
    restrictions: ['No source-clock backdating; historical lag research is RETROSPECTIVE, not AS_OF', 'Raw box-score attempts are outcomes of prior games only; target starts/attempts are never features', 'No quantitative absence, pace or role effects are assumed', 'One-date quote evidence cannot train selected-line calibration honestly'] };
}
