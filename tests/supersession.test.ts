import test from 'node:test';
import assert from 'node:assert/strict';
import { backup } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from './support/suggestions-fixture';
import { hash, ms } from '../src/core/domain';
import { Store } from '../src/core/store';
import { seedRecurringJobs } from '../src/suggestions/recurring';
import { protectedCycleSafety } from '../src/production/deployment';
import { supersedeFutureJobs, supplementalProtection, type SupersessionAuthority } from '../src/production/supersession';
function setup() {
  const d = fixture('2026-11-24T10:00:00.000Z', 1440), s = d.store, priorAt = '2026-11-23T04:00:00.000Z';
  const finalSource = d.retain({ data: [{ game: { id: 9999, status: 'Final' } }] }, 'https://api.balldontlie.io/nba/v1/stats?game_ids[]=9999', priorAt);
  s.ingest([{ ...d.logs[0], event: { ...d.event, id: 'bdl:nba:game:9999', startsAt: '2026-11-23T00:00:00.000Z' }, observedAt: priorAt, source: finalSource }], d.at);
  s.set('reliable:final:bdl:nba:game:9999', { phase: 'fixture', lastCompleteAt: priorAt, reason: null });
  s.set('live:worker', { at: d.at, state: 'waiting' }); s.set('recurring:worker', { at: d.at, state: 'running' }); s.set('reliable:active', { at: d.at }); s.acquire('live-worker', d.at, 150);
  seedRecurringJobs(s, d.at);
  const jobs = s.db.prepare('SELECT * FROM recurring_market_jobs ORDER BY id').all(), body = { version: 'multi-bookmaker-protected-cycle/1.4.8' as const, capturedAt: d.at, protectedOperatingDate: '2026-11-24' as const, timezone: 'Australia/Melbourne' as const, earliestOperatingDate: '2026-11-25' as const, fixtureIds: ['bdl:nba:game:9999'], jobIds: jobs.map(j => String(j.id)), jobs: jobs.map(j => ({ id: j.id, eventId: j.event_id, stage: j.stage, state: j.state, dueAt: j.due_at, deadline: j.deadline, bodyHash: hash(String(j.body)) })) };
  const p = { ...body, hash: hash(body) }, ab = { version: 'future-market-supersession/1' as const, ownerApproved: true as const, recordedAt: d.at, approvalReference: 'TEST-ONLY isolated explicit owner authority', instructionHash: hash('TEST-ONLY'), protectionHash: p.hash, jobIds: p.jobIds, expiresAt: '2026-11-24T12:00:00.000Z', reason: 'TEST-ONLY future stage handoff retaining original evidence' }, authority: SupersessionAuthority = { ...ab, id: hash(ab) };
  return { ...d, p, authority, jobs, run: (opts = {}) => supersedeFutureJobs(s, p, p.hash, authority, d.at, opts) };
}
test('authorized handoff is atomic, idempotent, preserves originals/charges/forecasts and does not claim completion', () => {
  const d = setup(); try {
    const forecasts = hash(d.store.db.prepare('SELECT * FROM experimental_forecasts ORDER BY id').all());
    d.store.db.prepare('INSERT INTO quota VALUES (?,?,?,?,?)').run('TEST:already-charged', 'odds', '2026-11-23T01:00:00.000Z', 4, 'success');
    const before = hash(d.store.db.prepare('SELECT * FROM quota ORDER BY id').all()), result = d.run();
    assert.equal(result.jobs.length, 2); assert.equal(result.originalWorkCompleted, false); assert.equal(result.originalGuardSafe, false); assert.equal(result.supplementalGuardSafe, true);
    assert.equal(protectedCycleSafety(d.store, d.p, d.p.hash, d.at).safe, false); assert.equal(supplementalProtection(d.store, d.p, d.p.hash, d.at).safe, true);
    for (const original of d.jobs) { const current = d.store.db.prepare('SELECT * FROM recurring_market_jobs WHERE id=?').get(original.id!); assert.equal(current!.body, original.body); assert.equal(current!.state, 'superseded'); }
    assert.equal(hash(d.store.db.prepare('SELECT * FROM quota ORDER BY id').all()), before); assert.equal(hash(d.store.db.prepare('SELECT * FROM experimental_forecasts ORDER BY id').all()), forecasts);
    assert.ok(d.run().jobs.every(r => r.existing)); assert.equal(d.store.db.prepare('SELECT count(*) n FROM recurring_market_jobs').get()!.n, 4);
    assert.throws(() => d.store.db.prepare('DELETE FROM market_job_supersessions').run(), /immutable/);
  } finally { d.close(); }
});
test('legacy seeding and deadline expiry cannot revive, overwrite or delete superseded originals', () => {
  const d = setup(); try {
    d.run(); seedRecurringJobs(d.store, d.at); assert.equal(d.store.db.prepare('SELECT count(*) n FROM recurring_market_jobs').get()!.n, 4);
    d.store.db.prepare("UPDATE recurring_market_jobs SET state='expired',error='Missed original pregame deadline' WHERE deadline<=? AND state NOT IN ('complete','expired')").run('2026-11-26T00:00:00.000Z');
    assert.equal(d.store.db.prepare("SELECT count(*) n FROM recurring_market_jobs WHERE state='superseded'").get()!.n, 2); assert.equal(d.store.db.prepare("SELECT count(*) n FROM recurring_market_jobs WHERE state='expired'").get()!.n, 2);
    assert.throws(() => d.store.db.prepare("UPDATE recurring_market_jobs SET state='queued' WHERE id=?").run(d.jobs[0].id!), /CANNOT_EXECUTE/);
    assert.throws(() => d.store.db.prepare('DELETE FROM recurring_market_jobs WHERE id=?').run(d.jobs[0].id!), /RETAINED/);
    assert.equal(supplementalProtection(d.store, d.p, d.p.hash, d.at).safe, true);
  } finally { d.close(); }
});
test('request reservation, active owner, uncertain debit, source pagination and outbox all block cancellation', () => {
  for (const kind of ['owner', 'reservation', 'uncertain', 'source', 'outbox']) {
    const d = setup(); try {
      if (kind === 'owner') d.store.acquire('experimental-cycle', d.at, 150);
      if (kind === 'reservation') d.store.db.prepare('INSERT INTO quota VALUES (?,?,?,?,?)').run('TEST:reserved', 'odds', d.at, 4, 'reserved');
      if (kind === 'uncertain') d.store.set('recurring:uncertain-debit', { id: 'TEST:uncertain' });
      if (kind === 'source') d.store.set('live:source-progress:injuries', { cursor: 22 });
      if (kind === 'outbox') d.store.db.prepare("INSERT INTO experimental_outbox(id,at,body,binding,state,next_at) VALUES (?,?,?,?,'uncertain',?)").run('TEST:outbox', d.at, JSON.stringify({ ids: ['TEST:accepted-or-uncertain'] }), 'TEST:binding', d.at);
      assert.throws(() => d.run(), /NOT_IDLE/); assert.ok(d.store.db.prepare("SELECT id FROM recurring_market_jobs WHERE state='queued'").all().length === 2);
    } finally { d.close(); }
  }
});
test('started or paid stages and issued/grading dependencies cannot be superseded', () => {
  for (const kind of ['requesting', 'body', 'issued']) {
    const d = setup(); try {
      if (kind === 'requesting') d.store.db.prepare("UPDATE recurring_market_jobs SET state='requesting' WHERE id=?").run(d.jobs[0].id!);
      if (kind === 'body') d.store.db.prepare('UPDATE recurring_market_jobs SET body=? WHERE id=?').run(JSON.stringify({ event: d.event, requestStartedAt: d.at, reservationFloor: 1 }), d.jobs[0].id!);
      if (kind === 'issued') d.store.db.prepare('INSERT INTO experimental_suggestions VALUES (?,?,?,?)').run('TEST:issued', d.at, hash('TEST:family'), JSON.stringify({ quote: { event: d.event } }));
      assert.throws(() => d.run()); assert.equal(d.store.db.prepare("SELECT count(*) n FROM recurring_market_jobs WHERE state='superseded'").get()!.n, 0);
    } finally { d.close(); }
  }
});
test('crash after cancellation, replacement/evidence insertion or later job rolls all changes back', () => {
  for (const phase of ['after_original', 'after_evidence']) {
    const d = setup(); try {
      const rows = hash(d.store.db.prepare('SELECT * FROM recurring_market_jobs ORDER BY id').all()); let count = 0;
      assert.throws(() => d.run({ fault: (p: string) => { if (p === phase && ++count === 2) throw Error('TEST-ONLY CRASH'); } }), /CRASH/);
      assert.equal(hash(d.store.db.prepare('SELECT * FROM recurring_market_jobs ORDER BY id').all()), rows); assert.equal(d.run().jobs.length, 2);
    } finally { d.close(); }
  }
});
test('canonical replacement tampering and missing final collection remain deployment blockers', () => {
  const d = setup(); try {
    const result = d.run(), replacement = result.jobs[0].replacementId;
    assert.throws(() => d.store.db.prepare('UPDATE recurring_market_jobs SET event_id=? WHERE id=?').run('OTHER', replacement), /IMMUTABLE/);
    d.store.set('reliable:final:bdl:nba:game:9999', { phase: 'stats', reason: 'INCOMPLETE' }); assert.equal(supplementalProtection(d.store, d.p, d.p.hash, d.at).safe, false);
  } finally { d.close(); }
});
test('two SQLite owners: acquisition first prevents supersession; supersession first prevents original claim', async () => {
  const d = setup(), directory = mkdtempSync(join(tmpdir(), 'signals-supersession-')), path = join(directory, 'TEST-ONLY.sqlite'); let a: Store | undefined, b: Store | undefined;
  try {
    await backup(d.store.db, path); a = new Store(path); b = new Store(path);
    const token = a.acquire('experimental-cycle', d.at, 150)!; assert.throws(() => supersedeFutureJobs(b!, d.p, d.p.hash, d.authority, d.at), /NOT_IDLE/); a.release('experimental-cycle', token);
    supersedeFutureJobs(b, d.p, d.p.hash, d.authority, d.at);
    const changes = a.db.prepare("UPDATE recurring_market_jobs SET state='requesting' WHERE id=? AND state='queued'").run(d.jobs[0].id!).changes;
    assert.equal(Number(changes), 0); assert.equal(a.db.prepare("SELECT count(*) n FROM recurring_market_jobs WHERE state IN ('queued','requesting')").get()!.n, 2);
    a.db.exec('BEGIN IMMEDIATE'); assert.throws(() => b!.db.exec('BEGIN IMMEDIATE'), /locked|busy/i); a.db.exec('ROLLBACK');
  } finally { a?.close(); b?.close(); d.close(); rmSync(directory, { recursive: true, force: true }); }
});
