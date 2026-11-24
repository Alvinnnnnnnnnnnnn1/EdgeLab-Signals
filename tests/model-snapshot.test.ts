import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/suggestions-fixture';
import { hash } from '../src/core/domain';
import { validateRetainedSnapshot } from '../src/model-engineering/snapshot';
test('snapshot body, revision identity and attempt metadata are bound to original normalized logs', () => {
  const d = fixture(); try {
    const rows = d.logs.map(log => ({ log, metadata: log.research!, ref: { id: hash([log.event.id, log.playerId, log.source.hash]), bodyHash: hash(log) } })), snapshot = { at: d.at, originHash: hash(rows.map(r => r.ref)), rows };
    validateRetainedSnapshot(snapshot);
    const changed = structuredClone(snapshot); changed.rows[0].log.stats.points = 100; assert.throws(() => validateRetainedSnapshot(changed), /SNAPSHOT_BODY/);
    const metadata = structuredClone(snapshot); metadata.rows[0].metadata.threeAttempts = 55; assert.throws(() => validateRetainedSnapshot(metadata), /SNAPSHOT_BODY/);
  } finally { d.close(); }
});
