import { z } from 'zod';
import { id, stamp, quoteSchema, hash, ms, type Prop, type Receipt, type Quote, type Terms, type League } from '../core/domain';
import { exactEvent, exactPlayer, type Registry } from './identity';
import { JsonHTTP } from './http';
const outcomeSchema = z.object({ name: z.string(), description: z.string().optional(), price: z.number(), point: z.number().optional() });
const oddsSchema = z.object({ id, sport_key: id, commence_time: stamp, home_team: id, away_team: id, bookmakers: z.array(z.object({ key: id, title: id, last_update: stamp.optional(), markets: z.array(z.object({ key: id, last_update: stamp.optional(), outcomes: z.array(outcomeSchema) })) })) });
export const marketKeys: Record<Prop, string> = { points: 'player_points', rebounds: 'player_rebounds', assists: 'player_assists', threes: 'player_threes' };
const byKey = Object.fromEntries(Object.entries(marketKeys).map(([a,b]) => [b,a])) as Record<string, Prop | undefined>;
export interface NormalizedOdds { quotes: Quote[]; exclusions: { identity: string; reason: string }[]; marketHash: string; }
export function normalizeOdds(raw: unknown, receipt: Receipt, registry: Registry, terms: Terms[], bookmaker = 'sportsbet'): NormalizedOdds {
  const input = oddsSchema.parse(raw), quotes: Quote[] = [], exclusions: NormalizedOdds['exclusions'] = [];
  const event = exactEvent(registry, input);
  const books = input.bookmakers.filter(b => b.key === bookmaker);
  if (books.length > 1) throw new Error('Duplicate bookmaker identity');
  if (!books.length) exclusions.push({ identity: input.id, reason: 'Requested bookmaker absent; no substitution' });
  const seen = new Set<string>(), ambiguous = new Set<string>();
  for (const b of books) for (const m of b.markets) {
    const prop = byKey[m.key];
    if (!prop) { exclusions.push({ identity: m.key, reason: 'Unsupported market family or milestone terms' }); continue; }
    for (const o of m.outcomes) {
      const identity = [input.id, m.key, o.description, o.name, o.point].join(':');
      try {
        if (!o.description || !['Over', 'Under'].includes(o.name) || o.point === undefined || !m.last_update) throw new Error('Missing exact player, line, side or ORIGINAL market timestamp');
        if (seen.has(identity)) { ambiguous.add(identity); throw new Error('Duplicate/conflicting exact outcome'); } seen.add(identity);
        const p = exactPlayer(registry, event.id, o.description);
        const exactTerms = terms.filter(t => t.bookmaker === b.key && t.prop === prop && t.league === event.league);
        const q = quoteSchema.parse({ event, playerId: p.playerId, player: p.player, teamId: p.teamId, prop, side: o.name.toLowerCase(), line: o.point, decimalOdds: o.price, bookmaker: b.key,
          quotedAt: m.last_update, retrievedAt: receipt.retrievedAt, expiresAt: new Date(Math.min(ms(event.startsAt) - 120000, ms(m.last_update) + 180000)).toISOString(), source: receipt, termsId: exactTerms.length === 1 ? exactTerms[0].id : null, mappingProof:{event:registry.events.find(e=>e.event.id===event.id),player:registry.players.find(x=>x.eventId===event.id&&x.description===o.description)}, mappingHash: p.mappingHash });
        quotes.push(q);
      } catch (e) { exclusions.push({ identity, reason: e instanceof Error ? e.message : 'Invalid outcome' }); }
    }
  }
  const safeQuotes=quotes.filter(q=>!ambiguous.has([input.id,marketKeys[q.prop],registry.players.find(p=>p.eventId===q.event.id&&p.playerId===q.playerId)?.description,q.side==='over'?'Over':'Under',q.line].join(':')));
  return { quotes:safeQuotes, exclusions, marketHash: hash(safeQuotes.map(q => [q.playerId, q.prop, q.line, q.side, q.decimalOdds, q.bookmaker]).sort()) };
}
export class OddsProvider {
  constructor(private http: JsonHTTP) {}
  async events(league: League) { return this.http.get('odds', `/v4/sports/${league === 'NBA' ? 'basketball_nba' : 'basketball_nbl'}/events`, {}, 900, 0); }
  async event(league: League, oddsId: string, fresh = false) {
    return this.http.get('odds', `/v4/sports/${league === 'NBA' ? 'basketball_nba' : 'basketball_nbl'}/events/${encodeURIComponent(oddsId)}/odds`, { bookmakers: 'sportsbet', markets: Object.values(marketKeys).join(','), oddsFormat: 'decimal', dateFormat: 'iso' }, 120, 4, fresh);
  }
  async markets(league: League, oddsId: string) { return this.http.get('odds', `/v4/sports/${league === 'NBA' ? 'basketball_nba' : 'basketball_nbl'}/events/${encodeURIComponent(oddsId)}/markets`, { bookmakers: 'sportsbet' }, 3600, 1); }
}
