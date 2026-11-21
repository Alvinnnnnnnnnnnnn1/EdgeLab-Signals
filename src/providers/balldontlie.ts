import { z } from 'zod';
import { eventSchema, gameLogSchema, type GameLog, type Receipt, type Event, ms } from '../core/domain';
import { JsonHTTP } from './http';
import { Store } from '../core/store';
import type { Config } from '../core/config';
const nativeId = z.number().int().positive();
const teamSchema = z.object({ id: nativeId, full_name: z.string().min(1) });
const gameSchema = z.object({ id: nativeId, season: z.number().int(), datetime: z.string().nullable().optional(), status: z.string(), postseason:z.boolean().optional(),period:z.number().int().optional(),season_type:z.string().optional(),ist_stage:z.string().nullable().optional(), home_team: teamSchema, visitor_team: teamSchema });
const stat = z.number().int().nonnegative().nullable().optional();
const statGameSchema=z.object({id:nativeId,season:z.number().int(),status:z.string(),datetime:z.string().nullable().optional(),home_team_id:nativeId.optional(),visitor_team_id:nativeId.optional(),home_team:teamSchema.optional(),visitor_team:teamSchema.optional()});
const rowSchema = z.object({ id: nativeId, fg3a:stat, min: z.union([z.string(), z.number()]).nullable().optional(), pts: stat, reb: stat, ast: stat, fg3m: stat, player: z.object({ id: nativeId, first_name: z.string(), last_name: z.string() }), team: teamSchema, game: statGameSchema });
const pageSchema = z.object({ data: z.array(z.unknown()), meta: z.object({ next_cursor: z.number().int().nullable().optional() }).optional() });
export function parseMinutes(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 75 ? value : null;
  if (typeof value !== 'string' || !/^\d{1,2}(:[0-5]\d|\.\d+)?$/.test(value)) return null;
  const [m,s] = value.split(':').map(Number), n = m + (s === undefined ? 0 : s / 60);
  return n <= 75 ? n : null;
}
export function bdlEvent(raw: unknown): Event {
  const g = gameSchema.parse(raw);
  if (!g.datetime) throw new Error('Exact source start missing (date-only fixture quarantined)');
  return eventSchema.parse({ id: `bdl:nba:game:${g.id}`, league: 'NBA', season: String(g.season), homeId: `bdl:nba:team:${g.home_team.id}`, awayId: `bdl:nba:team:${g.visitor_team.id}`, home: g.home_team.full_name, away: g.visitor_team.full_name, startsAt: g.datetime });
}
export function normalizeBDLStats(raw: unknown, receipt: Receipt, fixtures: {body:unknown;receipt:Receipt}[] = []) {
  const page = pageSchema.parse(raw), logs: GameLog[] = [], exclusions: string[] = [];
  for (const input of page.data) {
    try {
      const r = rowSchema.parse(input);
      if (r.game.status !== 'Final') { exclusions.push(`stats:${r.id}:not_final`); continue; }
      const fixture=fixtures.find(f=>gameSchema.parse(f.body).id===r.game.id);
      const full=fixture?gameSchema.parse(fixture.body):r.game.home_team&&r.game.visitor_team?gameSchema.parse(r.game):null;
      if(!full)throw new Error('Exact fixture source with full teams/start required; date-only stat metadata cannot identify a game');
      if(full.season!==r.game.season||full.status!=='Final'||r.game.home_team_id!==undefined&&r.game.home_team_id!==full.home_team.id||r.game.visitor_team_id!==undefined&&r.game.visitor_team_id!==full.visitor_team.id)throw new Error('Stats/fixture identity or final-state conflict');
      const minutes = parseMinutes(r.min),supportingSources=fixture?[fixture.receipt]:[];
      const observedAt=[receipt.retrievedAt,...supportingSources.map(s=>s.retrievedAt)].sort((a,b)=>ms(a)-ms(b)).at(-1)!;
      logs.push(gameLogSchema.parse({ event: bdlEvent(full), playerId: `bdl:nba:player:${r.player.id}`, player: `${r.player.first_name} ${r.player.last_name}`, teamId: `bdl:nba:team:${r.team.id}`, completedAt: null,
        observedAt, supportingSources, research:{phase:full.season_type==='preseason'?'preseason':full.ist_stage?'cup':full.postseason===true?'playoffs':full.postseason===false?'regular':'unknown',overtimePeriods:full.period!==undefined&&full.period>=4?full.period-4:null,threeAttempts:r.fg3a??null,rosterOpportunityVerified:false}, final: true, minutes, participated: minutes !== null && minutes > 0 ? true : null,
        stats: { points: r.pts ?? null, rebounds: r.reb ?? null, assists: r.ast ?? null, threes: r.fg3m ?? null }, source: receipt }));
    } catch (e) { exclusions.push(e instanceof Error ? e.message : 'Invalid stat row'); }
  }
  return { logs, exclusions, nextCursor: page.meta?.next_cursor ?? null };
}
export class BDLProvider {
  constructor(private http: JsonHTTP, private store: Store, private config: Config) {}
  async games(startDate: string, endDate: string, cursor?: number) { return this.http.get('balldontlie', '/nba/v1/games', { start_date: startDate, end_date: endDate, per_page: '100', ...(cursor === undefined ? {} : { cursor: String(cursor) }) }, 900, 0); }
  async stats(playerNativeIds: string[], startDate: string, endDate: string, now: string) {
    if (this.config.providers.balldontlie.tier === 'free') throw new Error('BDL Free excludes player stats; upgrade not activated');
    const key = `ingest:${playerNativeIds.slice().sort().join(',')}:${startDate}:${endDate}`;
    let checkpoint = this.store.get<{ cursor: number | null; complete: boolean; at: string; fixtureCursor?:number; fixturesComplete?:boolean }>(key);
    if (checkpoint?.complete && (endDate<now.slice(0,10)||ms(now)-ms(checkpoint.at)<900000)) return { inserted: 0, complete: true, exclusions: [] };
    if (checkpoint?.complete) checkpoint=null;
    if(!checkpoint?.fixturesComplete){
      const page=await this.games(startDate,endDate,checkpoint?.fixtureCursor);
      const parsed=z.object({data:z.array(gameSchema),meta:z.object({next_cursor:z.number().nullable().optional()})}).parse(page.body);
      for(const game of parsed.data){try{bdlEvent(game);this.store.set(`bdl:fixture:${game.id}`,{body:game,receipt:page.receipt});}catch{/* Exact missing clocks stay unavailable. */}}
      const cursor=parsed.meta.next_cursor??undefined;
      if(cursor!==undefined&&cursor===checkpoint?.fixtureCursor)throw new Error('Repeated fixture pagination cursor');
      this.store.set(key,{cursor:null,complete:false,at:now,fixtureCursor:cursor,fixturesComplete:cursor===undefined});
      return{inserted:0,complete:false,exclusions:[],stage:'fixture-page'};
    }
    const page = await this.http.get('balldontlie', '/nba/v1/stats', { 'player_ids[]': playerNativeIds, start_date: startDate, end_date: endDate, per_page: '100', ...(checkpoint?.cursor === undefined || checkpoint.cursor === null ? {} : { cursor: String(checkpoint.cursor) }) }, 3600, 0);
    z.object({meta:z.object({next_cursor:z.number().nullable().optional()})}).parse(page.body);
    const rawPage=pageSchema.parse(page.body),ids=[...new Set(rawPage.data.map(r=>rowSchema.parse(r).game.id))];
    const fixtures=ids.map(id=>this.store.get<{body:unknown;receipt:Receipt}>(`bdl:fixture:${id}`)).filter((f):f is {body:unknown;receipt:Receipt}=>f!==null);
    const parsed = normalizeBDLStats(page.body, page.receipt,fixtures);
    if(parsed.nextCursor!==null&&parsed.nextCursor===checkpoint?.cursor)throw new Error('Repeated pagination cursor');
    const inserted = this.store.ingest(parsed.logs, page.receipt.retrievedAt);
    this.store.set(key, { cursor: parsed.nextCursor, complete: parsed.nextCursor === null, at: now, fixturesComplete:true });
    this.store.set('ingest:last', { at: page.receipt.retrievedAt, inserted, excluded: parsed.exclusions.length, complete: parsed.nextCursor === null });
    return { inserted, complete: parsed.nextCursor === null, exclusions: parsed.exclusions };
  }
  async injuries(playerNativeIds: string[]) {
    if (this.config.providers.balldontlie.tier === 'free') throw new Error('BDL Free excludes injuries');
    // Absence from this list MUST NOT become confirmed available.
    return this.http.get('balldontlie', '/nba/v1/player_injuries', { 'player_ids[]': playerNativeIds, per_page: '100' }, 900, 0);
  }
}
