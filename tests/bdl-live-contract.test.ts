import test from 'node:test';
import assert from 'node:assert/strict';
import { configSchema } from '../src/core/config';
import { Store } from '../src/core/store';
import { BDLProvider } from '../src/providers/balldontlie';
import { JsonHTTP } from '../src/providers/http';

// Mocked shape of the authenticated November 2026 response. No live data or
// credentials are embedded, and this test writes only to an in-memory store.
test('BDL observed schema resumes fixture/stat cursors and preserves traded-team identity and unknowns', async () => {
  const store = new Store(':memory:');
  const config = configSchema.parse({ networkEnabled: true, providers: {
    balldontlie: { enabled: true, tier: 'all-star', dailyLimit: 10, minIntervalSeconds: 1 },
  } });
  const home = { id: 1, full_name: 'TEST-ONLY Home' };
  const away = { id: 2, full_name: 'TEST-ONLY Away' };
  const traded = { id: 3, full_name: 'TEST-ONLY Traded Team' };
  const first = { id: 101, date: '2025-01-01', datetime: '2025-01-02T00:00:00.000Z',
    season: 2024, status: 'Final', status_state: 'final', period: 4, time: 'Final',
    postseason: false, postponed: false, ist_stage: null, home_team: home, visitor_team: away };
  const second = { ...first, id: 102, date: '2025-02-21', datetime: '2025-02-22T03:30:00.000Z',
    period: 5, visitor_team: traded };
  const flat = (game: typeof first) => ({ ...game, home_team: undefined, visitor_team: undefined,
    home_team_id: game.home_team.id, visitor_team_id: game.visitor_team.id });
  const player = { id: 70, first_name: 'TEST-ONLY', last_name: 'Player', team_id: 2 };
  const rows = [
    { id: 201, min: '15', pts: 4, reb: 2, ast: 1, fg3m: 0, fg3a: 4, player, team: away, game: flat(first) },
    { id: 202, min: null, pts: null, reb: 0, ast: null, fg3m: 0, fg3a: 0, player, team: traded, game: flat(second) },
  ];
  const paths: URL[] = [];
  let at = '2026-11-21T01:00:00.000Z';
  const previousKey = process.env.BALLDONTLIE_API_KEY;
  process.env.BALLDONTLIE_API_KEY = 'TEST-ONLY-mocked-key';
  const http = new JsonHTTP(store, config, async input => {
    const url = new URL(input); paths.push(url);
    const cursor = url.searchParams.get('cursor');
    if (url.pathname.endsWith('/games')) return Response.json(cursor === null
      ? { data: [first], meta: { next_cursor: 101, per_page: 100 } }
      : { data: [second], meta: { per_page: 100 } });
    return Response.json(cursor === null
      ? { data: [rows[0]], meta: { next_cursor: 201, per_page: 100 } }
      : { data: [rows[1]], meta: { per_page: 100 } });
  }, () => at);
  try {
    for (let i = 0; i < 4; i++) {
      // Recreate the adapter to exercise durable checkpoints, rather than local state.
      const result = await new BDLProvider(http, store, config).stats(['70'], '2025-01-01', '2025-02-28', at);
      assert.deepEqual(result.exclusions, []);
      assert.equal(result.complete, i === 3);
      assert.equal(result.inserted, i < 2 ? 0 : 1);
      at = new Date(Date.parse(at) + 2000).toISOString();
    }
    assert.deepEqual(paths.map(p => [p.pathname, p.searchParams.get('cursor')]), [
      ['/nba/v1/games', null], ['/nba/v1/games', '101'],
      ['/nba/v1/stats', null], ['/nba/v1/stats', '201'],
    ]);
    const logs = store.logs();
    assert.equal(logs[0].event.startsAt, first.datetime);
    assert.equal(logs[0].minutes, 15);
    assert.equal(logs[0].stats.threes, 0);
    assert.equal(logs[0].research?.phase, 'regular');
    assert.equal(logs[1].research?.overtimePeriods, 1);
    assert.equal(logs[1].teamId, 'bdl:nba:team:3'); // Box-score team, not current player profile.
    assert.equal(logs[1].minutes, null);
    assert.equal(logs[1].participated, null);
    assert.equal(logs[1].stats.points, null);
    assert.equal(logs[1].stats.rebounds, 0);
    for (const log of logs) {
      assert.equal(log.completedAt, null);
      assert.equal(log.research?.rosterOpportunityVerified, false);
      assert.ok(store.hasReceipt(log.source));
      assert.ok(store.hasReceipt(log.supportingSources![0]));
      assert.ok(log.observedAt.startsWith('2026-11-21'));
    }
    const replay = await new BDLProvider(http, store, config).stats(['70'], '2025-01-01', '2025-02-28', at);
    assert.equal(replay.inserted, 0);
    assert.equal(replay.complete, true);
    assert.equal(paths.length, 4);
    assert.equal(store.logs().length, 2);
  } finally {
    if (previousKey === undefined) delete process.env.BALLDONTLIE_API_KEY;
    else process.env.BALLDONTLIE_API_KEY = previousKey;
    store.close();
  }
});
