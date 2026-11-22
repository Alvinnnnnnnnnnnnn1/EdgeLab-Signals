import { z } from 'zod';
import { eventSchema, id, stamp, receiptSchema, ms, hash, assertReceipt, type Event, eventMappingSchema, playerMappingSchema } from '../core/domain';
import { Store } from '../core/store';
const eventMap = eventMappingSchema;
const playerMap = playerMappingSchema;
export const registrySchema = z.object({ events: z.array(eventMap), players: z.array(playerMap) }).strict();
export type Registry = z.infer<typeof registrySchema>;
export const emptyRegistry = (): Registry => ({ events: [], players: [] });
export function verifyRegistry(raw: unknown, store: Store, now: string, simulated = false): Registry {
  const registry = registrySchema.parse(raw), seen = new Set<string>();
  for (const r of [...registry.events, ...registry.players]) {
    assertReceipt(r.source, now, simulated);
    if (ms(r.verifiedAt) > ms(now) || !store.hasReceipt(r.source)) throw new Error('Unverified mapping receipt');
    const key = 'oddsId' in r ? `event:${r.oddsId}` : `player:${r.eventId}:${r.description}`;
    if (seen.has(key)) throw new Error('Ambiguous exact mapping'); seen.add(key);
  }
  for (const p of registry.players) {
    const events = registry.events.filter(e => e.event.id === p.eventId);
    if (events.length !== 1 || ![events[0].event.homeId, events[0].event.awayId].includes(p.teamId)) throw new Error('Roster bridge outside exact fixture');
  }
  for(const mapping of registry.events)if(mapping.clockBridgePolicy){
    if(!mapping.sourceStartsAt||!mapping.canonicalFixtureSource||ms(mapping.sourceStartsAt)<ms(mapping.event.startsAt)||ms(mapping.sourceStartsAt)-ms(mapping.event.startsAt)>15*60000)throw new Error('Invalid experimental source-clock bridge');
    assertReceipt(mapping.canonicalFixtureSource,now,simulated);if(!store.hasReceipt(mapping.canonicalFixtureSource))throw new Error('Canonical fixture source proof missing');
  }
  return registry;
}
export function exactEvent(registry: Registry, input: { id: string; sport_key: string; home_team: string; away_team: string; commence_time: string },allowClockBridge=false): Event {
  const matches = registry.events.filter(e => e.oddsId === input.id);
  if (matches.length !== 1) throw new Error('Exact event mapping missing or ambiguous');
  const e = matches[0].event;
  const mapping=matches[0],clockMatches=ms(input.commence_time)===ms(e.startsAt)||allowClockBridge&&mapping.clockBridgePolicy==='unique-team-pair-earliest-clock/1'&&!!mapping.sourceStartsAt&&ms(input.commence_time)===ms(mapping.sourceStartsAt)&&ms(mapping.sourceStartsAt)>=ms(e.startsAt)&&ms(mapping.sourceStartsAt)-ms(e.startsAt)<=15*60000;
  if (input.sport_key !== (e.league === 'NBA' ? 'basketball_nba' : 'basketball_nbl') || input.home_team !== e.home || input.away_team !== e.away || !clockMatches) throw new Error('Event metadata changed; reverify exact bridge');
  return e;
}
export function exactPlayer(registry: Registry, eventId: string, description: string) {
  const matches = registry.players.filter(p => p.eventId === eventId && p.description === description);
  if (matches.length !== 1) throw new Error('Exact player/roster mapping missing or ambiguous');
  return { ...matches[0], mappingHash: hash({ event: registry.events.find(e => e.event.id === eventId), player: matches[0] }) };
}
