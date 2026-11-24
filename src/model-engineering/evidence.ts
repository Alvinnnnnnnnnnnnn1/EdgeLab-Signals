import { hash, ms, type Event, type Receipt } from '../core/domain';
import type { Store } from '../core/store';
import { bdlEvent } from '../providers/balldontlie';
import { type Availability, type PregameState, type SourceFact } from './freshness';

/** Read-only retained source index. No current roster join is made to past
 * games; each lookup selects the original receipt available at that clock. */
export function pregameEvidence(source: Store) {
  const fixtures = new Map<string, SourceFact<Event>[]>(), rosters = new Map<string, SourceFact<{ playerId: string; teamId: string }>[] >(), injuries = new Map<string, SourceFact<Availability>[]>();
  const add = <T>(m: Map<string, SourceFact<T>[]>, id: string, value: T, receipt: Receipt) => { const a = m.get(id) ?? []; a.push({ value, observedAt: receipt.retrievedAt, source: receipt }); m.set(id, a); };
  for (const r of source.db.prepare("SELECT s.body receipt,r.body raw FROM source_receipts s JOIN receipts r ON s.hash=r.hash WHERE json_extract(s.body,'$.provider')='balldontlie' AND (json_extract(s.body,'$.endpoint') LIKE 'https://api.balldontlie.io/nba/v1/games%' OR json_extract(s.body,'$.endpoint') LIKE 'https://api.balldontlie.io/nba/v1/players/active%' OR json_extract(s.body,'$.endpoint') LIKE 'https://api.balldontlie.io/nba/v1/player_injuries%') ORDER BY json_extract(s.body,'$.retrievedAt'),s.id").all()) {
    const receipt = JSON.parse(String(r.receipt)) as Receipt; if (receipt.simulated || !source.hasReceipt(receipt)) throw Error('GENUINE_PREGAME_RECEIPT_REQUIRED');
    const body = JSON.parse(String(r.raw)), path = new URL(receipt.endpoint).pathname; if (!Array.isArray(body.data)) continue;
    for (const v of body.data) {
      if (path === '/nba/v1/games') { try { const event = bdlEvent(v); add(fixtures, event.id, event, receipt); } catch { /* Unknown canonical clocks stay unavailable. */ } }
      if (path === '/nba/v1/players/active' && Number.isInteger(v.id) && Number.isInteger(v.team?.id ?? v.team_id)) add(rosters, `bdl:nba:player:${v.id}`, { playerId: `bdl:nba:player:${v.id}`, teamId: `bdl:nba:team:${v.team?.id ?? v.team_id}` }, receipt);
      if (path === '/nba/v1/player_injuries' && Number.isInteger(v.player?.id) && typeof v.status === 'string') {
        const status = ({ available: 'Available', probable: 'Probable', questionable: 'Questionable', out: 'Out', 'late scratch': 'LateScratch' } as Record<string, Availability>)[v.status.toLowerCase()] ?? 'Unknown';
        add(injuries, `bdl:nba:player:${v.player.id}`, status, receipt);
      }
    }
  }
  const last = <T>(a: SourceFact<T>[] | undefined, at: string): SourceFact<T> | null => {
    const known = (a ?? []).filter(f => ms(f.observedAt) <= ms(at)), value = known.at(-1); if (!value) return null;
    return new Set(known.filter(f => f.observedAt === value.observedAt).map(f => hash(f.value))).size === 1 ? value : null;
  };
  return (event: Event, playerId: string, teamId: string, at: string): PregameState => ({ event, playerId, teamId, fixture: last(fixtures.get(event.id), at), roster: last(rosters.get(playerId), at), injury: last(injuries.get(playerId), at), starter: null,
    teammates: [...rosters.keys()].filter(id => id !== playerId && last(rosters.get(id), at)?.value.teamId === teamId).flatMap(id => { const status = last(injuries.get(id), at); return status ? [{ playerId: id, status }] : []; }) });
}
