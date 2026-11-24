import { z } from 'zod';
import { Store } from '../core/store';
import { hash, ms, stamp, eventSchema } from '../core/domain';
import { protectionSchema } from '../multi-bookmaker/contracts';
import { protectedCycleSafety, deploymentSafety } from './deployment';

export const supersessionAuthoritySchema = z.object({
  version: z.literal('future-market-supersession/1'), ownerApproved: z.literal(true), recordedAt: stamp,
  approvalReference: z.string().min(8), instructionHash: z.string().regex(/^[a-f0-9]{64}$/),
  protectionHash: z.string().regex(/^[a-f0-9]{64}$/), jobIds: z.array(z.string()).min(1).max(45),
  expiresAt: stamp, reason: z.string().min(8), id: z.string(),
}).strict();
export type SupersessionAuthority = z.infer<typeof supersessionAuthoritySchema>;
type Job = { id: string; event_id: string; stage: string; due_at: string; deadline: string; state: string; body: string; error: string | null };
const table = (s: Store, name: string) => !!s.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
export function validateSupersessionAuthority(raw: unknown, protectionHash: string, at: string) {
  const a = supersessionAuthoritySchema.parse(raw), { id, ...body } = a;
  if (hash(body) !== id || a.protectionHash !== protectionHash || ms(a.recordedAt) > ms(at) || ms(a.expiresAt) <= ms(at) || new Set(a.jobIds).size !== a.jobIds.length) throw Error('INVALID_SUPERSESSION_AUTHORITY');
  return a;
}
export function installSupersessionSchema(s: Store) {
  s.db.exec(`CREATE TABLE IF NOT EXISTS market_job_supersession_authorities(id TEXT PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS market_job_supersessions(id TEXT PRIMARY KEY,original_id TEXT NOT NULL UNIQUE REFERENCES recurring_market_jobs(id),replacement_id TEXT NOT NULL UNIQUE REFERENCES recurring_market_jobs(id),at TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS superseded_job_body BEFORE UPDATE OF id,event_id,stage,due_at,deadline,body ON recurring_market_jobs WHEN EXISTS(SELECT 1 FROM market_job_supersessions WHERE original_id=OLD.id) BEGIN SELECT RAISE(ABORT,'SUPERSEDED_ORIGINAL_IDENTITY_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS superseded_job_retained BEFORE DELETE ON recurring_market_jobs WHEN EXISTS(SELECT 1 FROM market_job_supersessions WHERE original_id=OLD.id OR replacement_id=OLD.id) BEGIN SELECT RAISE(ABORT,'SUPERSESSION_JOBS_RETAINED'); END;
    CREATE TRIGGER IF NOT EXISTS superseded_job_terminal BEFORE UPDATE OF state ON recurring_market_jobs WHEN OLD.state='superseded' AND EXISTS(SELECT 1 FROM market_job_supersessions WHERE original_id=OLD.id) BEGIN
      SELECT CASE WHEN NEW.state NOT IN ('superseded','expired') THEN RAISE(ABORT,'SUPERSEDED_ORIGINAL_CANNOT_EXECUTE') END;
      SELECT RAISE(IGNORE);
    END;
    CREATE TRIGGER IF NOT EXISTS replacement_job_identity BEFORE UPDATE OF id,event_id,stage,due_at,deadline ON recurring_market_jobs WHEN EXISTS(SELECT 1 FROM market_job_supersessions WHERE replacement_id=OLD.id) BEGIN SELECT RAISE(ABORT,'SUPERSESSION_REPLACEMENT_IDENTITY_IMMUTABLE'); END;
    CREATE TRIGGER IF NOT EXISTS replacement_job_fence BEFORE UPDATE OF state ON recurring_market_jobs WHEN NEW.state IN ('queued','deferred','observed','requesting') AND EXISTS(SELECT 1 FROM market_job_supersessions r JOIN recurring_market_jobs o ON o.id=r.original_id WHERE r.replacement_id=OLD.id AND o.state!='superseded') BEGIN SELECT RAISE(ABORT,'ORIGINAL_REPLACEMENT_BOTH_ELIGIBLE'); END;`);
  for (const name of ['market_job_supersessions', 'market_job_supersession_authorities']) for (const op of ['UPDATE', 'DELETE']) s.db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${name}_${op} BEFORE ${op} ON ${name} BEGIN SELECT RAISE(ABORT,'Supersession evidence is immutable'); END;`);
}
export function supersessionIdle(s: Store, at: string) {
  const ordinary = deploymentSafety(s, at), blocks = [...ordinary.blocks];
  if (s.db.prepare("SELECT name FROM leases WHERE name IN ('live-cycle','reliable-source-task','research-analytics','multi-slate-research') AND expires_at>? LIMIT 1").get(at)) blocks.push('SOURCE_OR_MARKET_CHILD_ACTIVE');
  if (s.db.prepare("SELECT id FROM experimental_outbox WHERE state IN ('pending','retryable_failed','sending','uncertain') LIMIT 1").get()) blocks.push('OUTBOX_TRANSMISSION_UNRESOLVED');
  if (s.db.prepare("SELECT key FROM meta WHERE key LIKE 'live:source-progress:%' AND value!='null' LIMIT 1").get()) blocks.push('SOURCE_PAGINATION_INCOMPLETE');
  const runtime = s.get<{ sourceStartedAt?: string | null; analyticsStartedAt?: string | null }>('reliable:worker');
  if (runtime?.sourceStartedAt || runtime?.analyticsStartedAt) blocks.push('SOURCE_CHILD_FINGERPRINT_ACTIVE');
  return { at, safe: blocks.length === 0, blocks };
}
export function inspectUntouchedJob(s: Store, job: Job, captured: Record<string, unknown>, at: string) {
  if (job.id !== captured.id || job.event_id !== captured.eventId || job.stage !== captured.stage || job.due_at !== captured.dueAt || job.deadline !== captured.deadline || hash(job.body) !== captured.bodyHash) throw Error('CAPTURED_UNTOUCHED_JOB_CHANGED:' + job.id);
  if (job.state !== 'queued' || job.error !== null || ms(job.due_at) <= ms(at) + 600000) throw Error('JOB_STARTED_OR_IMMINENT:' + job.id);
  const body = JSON.parse(job.body), event = eventSchema.parse(body.event), minutes = job.stage === 'T-90' ? 90 : job.stage === 'T-20' ? 20 : null;
  if (!minutes || Object.keys(body).length !== 1 || event.id !== job.event_id || hash([hash(event), minutes]) !== job.id) throw Error('JOB_TRANSPORT_OR_NONCANONICAL_BODY:' + job.id);
  const current = s.get<{ event: unknown; status: string; source: any }>('live:fixture:' + event.id.split(':').at(-1));
  if (!current || current.status !== 'scheduled' || hash(current.event) !== hash(event) || current.source.simulated || ms(current.source.retrievedAt) > ms(at) || !s.hasReceipt(current.source)) throw Error('CANONICAL_FUTURE_FIXTURE_REQUIRED:' + job.id);
  const quotes = Number(s.db.prepare("SELECT count(*) n FROM experimental_candidates WHERE json_extract(body,'$.quote.event.id')=?").get(event.id)!.n), issued = Number(s.db.prepare("SELECT count(*) n FROM experimental_suggestions WHERE json_extract(body,'$.quote.event.id')=?").get(event.id)!.n);
  if (quotes || issued || table(s, 'multi_bookmaker_stages') && s.db.prepare('SELECT job_id FROM multi_bookmaker_stages WHERE job_id=?').get(job.id) || s.get('recurring:uncertain-debit')) throw Error('JOB_PRICE_DELIVERY_OR_SETTLEMENT_DEPENDENCY:' + job.id);
  const forecasts = s.db.prepare('SELECT id,body FROM experimental_forecasts WHERE event_id=? ORDER BY id').all(event.id);
  return { event, bodyHash: hash(job.body), quotes, issued, originalStageNeverStarted: true, reservationsReleased: 0, priorChargesChanged: 0,
    independentForecasts: { rows: forecasts.length, hash: hash(forecasts), treatment: 'PREEXISTING_INDEPENDENT_FORECASTS_RETAINED_NOT_REPLACED' },
    executionOwner: 'recurring-market-worker', sourceAndSettlementOwner: 'unchanged independent research worker',
    proof: 'Captured initial event-only body and queued/null-error state; executor persists discovery/requesting/reservationFloor before transport. No quote/issue dependency, no active acquisition/delivery lease.' };
}
/** All originals, replacement rows and durable authority/evidence commit in one
 * writer transaction. A crash or a racing acquisition rolls the entire set back. */
export function supersedeFutureJobs(s: Store, rawProtection: unknown, expectedHash: string, rawAuthority: unknown, at: string, options: { assertRuntime?: () => void; fault?: (phase: string) => void } = {}) {
  const p = protectionSchema.parse(rawProtection), a = validateSupersessionAuthority(rawAuthority, expectedHash, at);
  if (p.hash !== expectedHash || a.jobIds.some(id => !p.jobIds.includes(id))) throw Error('SUPERSESSION_SCOPE_MISMATCH');
  return s.transaction(() => {
    const idle = supersessionIdle(s, at); if (!idle.safe) throw Error('SUPERSESSION_NOT_IDLE:' + idle.blocks.join(',')); options.assertRuntime?.();
    const original = protectedCycleSafety(s, p, expectedHash, at);
    const expectedBlocks = new Set(a.jobIds.map(id => 'CAPTURED_JOB_NOT_TERMINAL:' + id));
    if (original.blocks.some(b => !expectedBlocks.has(b))) throw Error('OTHER_PROTECTED_REQUIREMENT_FAILED');
    installSupersessionSchema(s);
    const existing = s.db.prepare('SELECT body FROM market_job_supersession_authorities WHERE id=?').get(a.id);
    if (existing && String(existing.body) !== JSON.stringify(a)) throw Error('AUTHORITY_COLLISION');
    s.db.prepare('INSERT OR IGNORE INTO market_job_supersession_authorities VALUES (?,?)').run(a.id, JSON.stringify(a));
    const result: { originalId: string; replacementId: string; evidenceId: string; existing: boolean }[] = [];
    for (const id of a.jobIds) {
      const saved = s.db.prepare('SELECT body FROM market_job_supersessions WHERE original_id=?').get(id);
      if (saved) { const r = JSON.parse(String(saved.body)); if (r.authorityId !== a.id || r.protectionHash !== p.hash) throw Error('SUPERSESSION_AUTHORITY_CHANGED'); result.push({ originalId: id, replacementId: r.replacement.id, evidenceId: r.id, existing: true }); continue; }
      const job = s.db.prepare('SELECT * FROM recurring_market_jobs WHERE id=?').get(id) as unknown as Job | undefined, captured = p.jobs.find((j: any) => j.id === id) as Record<string, unknown>;
      if (!job || !captured) throw Error('CAPTURED_JOB_MISSING'); const proof = inspectUntouchedJob(s, job, captured, at);
      const replacementId = hash(['authorized-future-replacement/1', a.id, id, p.hash]), replacement = { ...job, id: replacementId, body: JSON.stringify({ event: proof.event, supersedesJobId: id, supersessionAuthority: a.id }), error: null };
      const changed = s.db.prepare("UPDATE recurring_market_jobs SET state='superseded',error=? WHERE id=? AND state='queued' AND body=? AND error IS NULL").run('OWNER_AUTHORISED_FUTURE_SUPERSESSION:' + a.id, id, job.body).changes;
      if (Number(changed) !== 1) throw Error('JOB_CLAIMED_DURING_SUPERSESSION'); options.fault?.('after_original');
      s.db.prepare('INSERT INTO recurring_market_jobs VALUES (?,?,?,?,?,?,?,?)').run(replacement.id, replacement.event_id, replacement.stage, replacement.due_at, replacement.deadline, replacement.state, replacement.body, replacement.error);
      const body = { version: 'market-job-supersession/1', at, authorityId: a.id, approvalReference: a.approvalReference, protectionHash: p.hash, original: job, captured, replacement, proof, reason: a.reason, originalWorkCompleted: false, settlementCoverageRetained: true }, evidenceId = hash(body);
      s.db.prepare('INSERT INTO market_job_supersessions VALUES (?,?,?,?,?)').run(evidenceId, id, replacementId, at, JSON.stringify({ ...body, id: evidenceId })); options.fault?.('after_evidence');
      result.push({ originalId: id, replacementId, evidenceId, existing: false });
    }
    options.assertRuntime?.();
    const supplemented = supplementalProtection(s, p, expectedHash, at); if (!supplemented.safe) throw Error('SUPERSESSION_PROOF_INCOMPLETE:' + supplemented.blocks.join(','));
    return { at, authorityId: a.id, jobs: result, originalManifestChanged: false, originalWorkCompleted: false, originalGuardSafe: supplemented.original.safe, supplementalGuardSafe: supplemented.safe, reservationsReleased: 0, requests: 0, messages: 0 };
  });
}
/** The unchanged original proof remains visible and false for superseded jobs.
 * Only its exact nonterminal blocks can be satisfied by complete scoped proof. */
export function supplementalProtection(s: Store, raw: unknown, expectedHash: string, at: string) {
  const original = protectedCycleSafety(s, raw, expectedHash, at), p = protectionSchema.parse(raw), blocks: string[] = [], accepted = new Set<string>(), records: unknown[] = [];
  if (table(s, 'market_job_supersessions')) for (const row of s.db.prepare('SELECT body FROM market_job_supersessions ORDER BY original_id').all()) {
    const r = JSON.parse(String(row.body)), { id, ...body } = r; if (r.protectionHash !== expectedHash || !p.jobIds.includes(r.original.id)) continue;
    try {
      if (hash(body) !== id) throw Error('EVIDENCE_HASH'); const authorityRow = s.db.prepare('SELECT body FROM market_job_supersession_authorities WHERE id=?').get(r.authorityId); if (!authorityRow) throw Error('AUTHORITY_MISSING');
      // Expiry limits the transition, not the lifetime of its immutable proof.
      const a = validateSupersessionAuthority(JSON.parse(String(authorityRow.body)), expectedHash, r.at); if (!a.jobIds.includes(r.original.id) || a.id !== r.authorityId) throw Error('AUTHORITY_SCOPE');
      const captured = p.jobs.find((j: any) => j.id === r.original.id); if (hash(captured) !== hash(r.captured)) throw Error('CAPTURE_CHANGED');
      const o = s.db.prepare('SELECT * FROM recurring_market_jobs WHERE id=?').get(r.original.id) as unknown as Job, n = s.db.prepare('SELECT * FROM recurring_market_jobs WHERE id=?').get(r.replacement.id) as unknown as Job;
      if (!o || o.state !== 'superseded' || o.event_id !== r.original.event_id || o.stage !== r.original.stage || o.due_at !== r.original.due_at || o.deadline !== r.original.deadline || o.body !== r.original.body || r.original.state !== 'queued' || r.original.error !== null) throw Error('ORIGINAL_CHANGED');
      if (!n || n.event_id !== o.event_id || n.stage !== o.stage || n.due_at !== o.due_at || n.deadline !== o.deadline || !['queued','deferred','observed','requesting','complete','blocked','expired'].includes(n.state)) throw Error('REPLACEMENT_IDENTITY_OR_STATE');
      const nb = JSON.parse(n.body); if (hash(nb.event) !== hash(r.proof.event) || nb.supersedesJobId !== o.id || nb.supersessionAuthority !== a.id || !r.settlementCoverageRetained || r.originalWorkCompleted !== false || r.proof.reservationsReleased !== 0) throw Error('REPLACEMENT_PROOF');
      const other = s.db.prepare("SELECT id FROM recurring_market_jobs WHERE event_id=? AND stage=? AND due_at=? AND deadline=? AND state IN ('queued','deferred','observed','requesting') AND id!=?").get(n.event_id,n.stage,n.due_at,n.deadline,n.id); if (other) throw Error('DOUBLE_ELIGIBILITY');
      accepted.add(o.id); records.push({ originalId: o.id, replacementId: n.id, state: n.state, evidenceId: id, classification: 'AUTHORIZED_HANDOFF_NOT_ORIGINAL_COMPLETION' });
    } catch (error) { blocks.push('INVALID_SUPERSESSION:' + r.original.id + ':' + (error as Error).message); }
  }
  for (const b of original.blocks) if (!b.startsWith('CAPTURED_JOB_NOT_TERMINAL:') || !accepted.has(b.slice('CAPTURED_JOB_NOT_TERMINAL:'.length))) blocks.push(b);
  return { at, safe: blocks.length === 0, blocks, original, supersessions: records, protectionHash: p.hash };
}
