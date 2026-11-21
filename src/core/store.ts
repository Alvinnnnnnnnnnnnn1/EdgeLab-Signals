import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, exactKey, familyKey, ms, type Decision, type GameLog, gameLogSchema, type Receipt, assertReceipt, quoteFresh } from './domain';
import type { Config } from './config';

export interface Signal { id: string; issuedAt: string; simulated: boolean; supersedes: string | null; decision: Decision; units: 1; }
export interface Outbox { id: string; signalId: string; state: string; attempts: number; guid: string | null; nextAt: string; lastError: string | null; }
export interface RequestAllowance {id:string;binding:string;expiresAt:string;maxRequests:number;maxCredits:number;}
export class Store {
  db: DatabaseSync;
  constructor(path: string, readOnly = false) {
    if(readOnly){this.db=new DatabaseSync(path,{readOnly:true});this.db.exec('PRAGMA busy_timeout=5000');return;}
    if (path !== ':memory:') { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(hash TEXT PRIMARY KEY, receipt TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_receipts(id TEXT PRIMARY KEY, hash TEXT NOT NULL REFERENCES receipts(hash), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, receipt TEXT NOT NULL, body TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS logs(id TEXT PRIMARY KEY, event_id TEXT NOT NULL, player_id TEXT NOT NULL, observed_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS screenings(id TEXT PRIMARY KEY, at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prospective_forecasts(id TEXT PRIMARY KEY, at TEXT NOT NULL, event_id TEXT NOT NULL, player_id TEXT NOT NULL, prop TEXT NOT NULL, artifact_hash TEXT NOT NULL, body TEXT NOT NULL,
        UNIQUE(event_id,player_id,prop,artifact_hash));
      CREATE TABLE IF NOT EXISTS shadow_forecasts(id TEXT PRIMARY KEY, at TEXT NOT NULL, event_id TEXT NOT NULL, player_id TEXT NOT NULL, prop TEXT NOT NULL, artifact_hash TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(event_id,player_id,prop,artifact_hash));
      CREATE TABLE IF NOT EXISTS research_jobs(id TEXT PRIMARY KEY, kind TEXT NOT NULL, next_at TEXT NOT NULL, deadline TEXT, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS research_runs(id TEXT PRIMARY KEY, at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_models(id TEXT PRIMARY KEY, at TEXT NOT NULL, prop TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_grades(id TEXT PRIMARY KEY, at TEXT NOT NULL, classification TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS telegram_outbox(id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, binding TEXT NOT NULL, body TEXT NOT NULL, message_id TEXT, error TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY, exact_key TEXT NOT NULL, family_key TEXT NOT NULL, issued_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS signal_exact ON signals(exact_key, issued_at);
      CREATE INDEX IF NOT EXISTS signal_family ON signals(family_key, issued_at);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, signal_id TEXT NOT NULL UNIQUE REFERENCES signals(id), state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, guid TEXT, next_at TEXT NOT NULL, last_error TEXT);
      CREATE TABLE IF NOT EXISTS deliveries(id INTEGER PRIMARY KEY, outbox_id TEXT NOT NULL REFERENCES outbox(id), at TEXT NOT NULL, state TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outcomes(id TEXT PRIMARY KEY, signal_id TEXT NOT NULL UNIQUE REFERENCES signals(id), at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outcome_revisions(id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES signals(id), at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quota(id TEXT PRIMARY KEY, provider TEXT NOT NULL, at TEXT NOT NULL, credits INTEGER NOT NULL, outcome TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS quota_time ON quota(provider, at);
      CREATE TABLE IF NOT EXISTS leases(name TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_screenings_update BEFORE UPDATE ON screenings BEGIN SELECT RAISE(ABORT,'Screenings are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_screenings_delete BEFORE DELETE ON screenings BEGIN SELECT RAISE(ABORT,'Screenings cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_prospective_update BEFORE UPDATE ON prospective_forecasts BEGIN SELECT RAISE(ABORT,'Prospective forecasts are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_prospective_delete BEFORE DELETE ON prospective_forecasts BEGIN SELECT RAISE(ABORT,'Prospective forecasts cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_shadow_update BEFORE UPDATE ON shadow_forecasts BEGIN SELECT RAISE(ABORT,'Shadow forecasts are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_shadow_delete BEFORE DELETE ON shadow_forecasts BEGIN SELECT RAISE(ABORT,'Shadow forecasts cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_research_run_update BEFORE UPDATE ON research_runs BEGIN SELECT RAISE(ABORT,'Research journals are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_research_run_delete BEFORE DELETE ON research_runs BEGIN SELECT RAISE(ABORT,'Research journals cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_research_model_update BEFORE UPDATE ON research_models BEGIN SELECT RAISE(ABORT,'Research models are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_research_model_delete BEFORE DELETE ON research_models BEGIN SELECT RAISE(ABORT,'Research models cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_research_grade_update BEFORE UPDATE ON research_grades BEGIN SELECT RAISE(ABORT,'Research grading revisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_research_grade_delete BEFORE DELETE ON research_grades BEGIN SELECT RAISE(ABORT,'Research grading revisions cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_telegram_body BEFORE UPDATE OF body,kind,binding,created_at ON telegram_outbox BEGIN SELECT RAISE(ABORT,'Notification content is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_signals_update BEFORE UPDATE ON signals BEGIN SELECT RAISE(ABORT,'Signals are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_signals_delete BEFORE DELETE ON signals BEGIN SELECT RAISE(ABORT,'Signals cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_outcomes_update BEFORE UPDATE ON outcomes BEGIN SELECT RAISE(ABORT,'Outcomes are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_outcomes_delete BEFORE DELETE ON outcomes BEGIN SELECT RAISE(ABORT,'Outcomes cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_outcome_revisions_update BEFORE UPDATE ON outcome_revisions BEGIN SELECT RAISE(ABORT,'Outcome revisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_outcome_revisions_delete BEFORE DELETE ON outcome_revisions BEGIN SELECT RAISE(ABORT,'Outcome revisions cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_logs_update BEFORE UPDATE ON logs BEGIN SELECT RAISE(ABORT,'Log revisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_logs_delete BEFORE DELETE ON logs BEGIN SELECT RAISE(ABORT,'Log revisions cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_source_receipts_update BEFORE UPDATE ON source_receipts BEGIN SELECT RAISE(ABORT,'Source receipts are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_source_receipts_delete BEFORE DELETE ON source_receipts BEGIN SELECT RAISE(ABORT,'Source receipts cannot be removed'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_receipts_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT,'Receipts are immutable'); END;
    `);
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  get<T>(key: string): T | null { const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined; return row ? JSON.parse(row.value) as T : null; }
  set(key: string, value: unknown) { this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  receipt(source: Receipt, body: string) {
    if (hash(body) !== source.hash) throw new Error('Source body integrity mismatch');
    // Same bytes can have multiple retrieval receipts; immutable body is keyed by content, facts retain their own clock.
    this.db.prepare('INSERT OR IGNORE INTO receipts VALUES (?,?,?)').run(source.hash, JSON.stringify(source), body);
    this.db.prepare('INSERT OR IGNORE INTO source_receipts VALUES (?,?,?)').run(hash(source),source.hash,JSON.stringify(source));
  }
  hasReceipt(r: Receipt) { const row = this.db.prepare('SELECT body FROM receipts WHERE hash=?').get(r.hash) as { body: string } | undefined; return !!row && hash(row.body) === r.hash && !!this.db.prepare('SELECT id FROM source_receipts WHERE id=?').get(hash(r)); }
  cacheGet(key: string, now: string) {
    const row = this.db.prepare('SELECT * FROM cache WHERE key=?').get(key) as { receipt: string; body: string; expires_at: string } | undefined;
    if (!row || ms(row.expires_at) <= ms(now)) return null;
    const receipt = JSON.parse(row.receipt) as Receipt;
    if (hash(row.body) !== receipt.hash) throw new Error('Cache integrity mismatch');
    return { receipt, body: JSON.parse(row.body) as unknown };
  }
  cachePut(key: string, receipt: Receipt, body: string, ttlSeconds: number) {
    this.receipt(receipt, body);
    this.db.prepare('INSERT INTO cache VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET receipt=excluded.receipt,body=excluded.body,expires_at=excluded.expires_at').run(key, JSON.stringify(receipt), body, new Date(ms(receipt.retrievedAt) + ttlSeconds * 1000).toISOString());
  }
  ingest(logs: GameLog[], now: string, simulated = false) {
    return this.transaction(() => {
      let inserted = 0;
      for (const raw of logs) {
        const r = gameLogSchema.parse(raw); assertReceipt(r.source, now, simulated);
        for(const source of [r.source,...(r.supportingSources??[])]){assertReceipt(source,now,simulated);if (!this.hasReceipt(source)) throw new Error('Retained source body missing');}
        if (ms(r.observedAt) > ms(now)) throw new Error('Future observation');
        // Duplicate page/retry never doubles training observations; corrections retain original revisions.
        const key = hash([r.event.id, r.playerId, r.source.hash]);
        inserted += Number(this.db.prepare('INSERT OR IGNORE INTO logs VALUES (?,?,?,?,?)').run(key, r.event.id, r.playerId, r.observedAt, JSON.stringify(r)).changes);
      }
      return inserted;
    });
  }
  logs(): GameLog[] {
    const rows = this.db.prepare('SELECT body FROM logs ORDER BY observed_at').all() as { body: string }[];
    return rows.map(r => JSON.parse(r.body) as GameLog);
  }
  recordScreened(decision:Decision,at:string,simulated=false){
    assertReceipt(decision.quote.source,at,simulated);
    if(!this.hasReceipt(decision.quote.source))throw new Error('Screened quote source missing');
    const key=hash([exactKey(decision.quote),decision.quote.source,decision.forecast?.artifactHash??decision.forecast?.version,decision.forecast?.inputHash??null]);
    return !!this.db.prepare('INSERT OR IGNORE INTO screenings VALUES (?,?,?)').run(key,at,JSON.stringify({id:key,at,simulated,decision}));
  }
  screenings():{id:string;at:string;simulated:boolean;decision:Decision}[]{return (this.db.prepare('SELECT body FROM screenings ORDER BY at,id').all() as {body:string}[]).map(r=>JSON.parse(r.body));}
  signals(): Signal[] { return (this.db.prepare('SELECT body FROM signals ORDER BY issued_at DESC,id').all() as { body: string }[]).map(r => JSON.parse(r.body) as Signal); }
  issue(decision: Decision, now: string, simulated = false): Signal | null {
    if (!decision.qualified || !decision.forecast) throw new Error('Only qualified recommendations can be issued');
    assertReceipt(decision.quote.source, now, simulated);
    if (!quoteFresh(decision.quote, now) || ms(decision.forecast.at) > ms(now) || ms(now)-ms(decision.forecast.at)>30000 || decision.forecast.inputHash !== hash(decision.forecast.inputs) || hash(decision.forecast.inputs.quote)!==hash(decision.quote)) throw new Error('Signal commit freshness/integrity invalid');
    for (const r of [decision.quote.mappingProof.event.source,decision.quote.mappingProof.player.source,...(decision.evidence.terms?[decision.evidence.terms.source]:[]),decision.forecast.inputs.context.source, ...(decision.forecast.inputs.research?.leagueLogs??[]).flatMap(l=>[l.source,...(l.supportingSources??[])]),...(decision.forecast.inputs.research?.participationLogs??[]).flatMap(l=>[l.source,...(l.supportingSources??[])]),...decision.forecast.inputs.logs.flatMap(l=>[l.source,...(l.supportingSources??[])])]) { assertReceipt(r,now,simulated); if (!this.hasReceipt(r)) throw new Error('Forecast source bytes missing'); }
    if (!this.hasReceipt(decision.quote.source)) throw new Error('Quote source body missing');
    return this.transaction(() => {
      const q = decision.quote, key = exactKey(q), family = familyKey(q);
      const priorRow = this.db.prepare('SELECT body FROM signals WHERE family_key=? ORDER BY issued_at DESC LIMIT 1').get(family) as { body: string } | undefined;
      const prior = priorRow ? JSON.parse(priorRow.body) as Signal : null;
      if (prior) {
        const old = prior.decision.quote;
        const significant = old.side === q.side && (Math.abs(q.line - old.line) >= 1 || Math.abs(q.decimalOdds - old.decimalOdds) >= .10);
        if (!significant || ms(now) - ms(prior.issuedAt) < 15 * 60_000 || ms(q.quotedAt) <= ms(old.quotedAt)) return null;
      }
      const signal: Signal = { id: hash([key, q.source.hash, q.quotedAt, decision.forecast!.inputHash]), issuedAt: now, simulated, supersedes: prior?.id ?? null, decision, units: 1 };
      const changed = this.db.prepare('INSERT OR IGNORE INTO signals VALUES (?,?,?,?,?)').run(signal.id, key, family, now, JSON.stringify(signal)).changes;
      if (!changed) return null;
      this.db.prepare('INSERT INTO outbox(id,signal_id,state,next_at) VALUES (?,?,?,?)').run(signal.id, signal.id, 'pending', now);
      return signal;
    });
  }
  outboxes(): Outbox[] {
    return (this.db.prepare('SELECT * FROM outbox').all() as Record<string, unknown>[]).map(r => ({ id: r.id as string, signalId: r.signal_id as string, state: r.state as string, attempts: r.attempts as number, guid: r.guid as string | null, nextAt: r.next_at as string, lastError: r.last_error as string | null }));
  }
  transition(id: string, state: string, now: string, detail: string, guid: string | null = null, delaySeconds = 0) {
    this.transaction(() => {
      this.db.prepare('UPDATE outbox SET state=?,guid=COALESCE(?,guid),last_error=?,next_at=?,attempts=attempts+? WHERE id=?').run(state, guid, ['failed','uncertain'].includes(state) ? detail : null, new Date(ms(now) + delaySeconds * 1000).toISOString(), state === 'sending' ? 1 : 0, id);
      this.db.prepare('INSERT INTO deliveries(outbox_id,at,state,detail) VALUES (?,?,?,?)').run(id, now, state, detail);
    });
  }
  claimDelivery(id: string, now: string) {
    return this.transaction(() => {
      const result = this.db.prepare("UPDATE outbox SET state='sending',attempts=attempts+1,next_at=? WHERE id=? AND state IN ('pending','failed') AND next_at<=? AND attempts<3").run(now, id, now);
      if (result.changes) this.db.prepare('INSERT INTO deliveries(outbox_id,at,state,detail) VALUES (?,?,?,?)').run(id, now, 'sending', 'Claim committed before transport');
      return !!result.changes;
    });
  }
  reserve(provider: keyof Config['providers'], config: Config['providers'][keyof Config['providers']], credits: number, now: string, allowance?:RequestAllowance) {
    return this.transaction(() => {
      if (!config.enabled || config.dailyLimit <= 0) throw new Error(`${provider}: disabled or zero allowance`);
      const day = now.slice(0, 10), month = now.slice(0, 7);
      const totals = this.db.prepare('SELECT COUNT(*) calls,COALESCE(SUM(credits),0) credits,MAX(at) last FROM quota WHERE provider=? AND at LIKE ?').get(provider, `${day}%`) as { calls: number; credits: number; last: string | null };
      const monthly = this.db.prepare('SELECT COALESCE(SUM(credits),0) credits FROM quota WHERE provider=? AND at LIKE ?').get(provider, `${month}%`) as { credits: number };
      if (totals.calls >= config.dailyLimit || monthly.credits + credits > config.monthlyCredits - config.reserve) throw new Error(`${provider}: quota ceiling or reserve`);
      if (totals.last && ms(now) - ms(totals.last) < config.minIntervalSeconds * 1000) throw new Error(`${provider}: cooldown`);
      const header = this.get<{ remaining: number; at: string }>(`quota:${provider}`);
      if (header && header.at.slice(0, 7) === month && header.remaining - credits < config.reserve) throw new Error(`${provider}: provider remaining credits below reserve`);
      if(allowance){
        if(ms(now)>=ms(allowance.expiresAt))throw new Error('Shared allowance expired');
        const key=`request-allowance:${provider}:${allowance.id}`;
        const previous=this.get<{binding:string;requests:number;credits:number}>(key);
        if(previous&&previous.binding!==allowance.binding)throw new Error('Shared allowance binding changed');
        const state=previous??{binding:allowance.binding,requests:0,credits:0};
        if(state.requests+1>allowance.maxRequests||state.credits+credits>allowance.maxCredits)throw new Error('Shared allowance exhausted');
        this.set(key,{...state,requests:state.requests+1,credits:state.credits+credits});
      }
      const token = randomUUID();
      this.db.prepare('INSERT INTO quota VALUES (?,?,?,?,?)').run(token, provider, now, credits, 'reserved');
      // Debit the last observed account allowance locally until a new response updates it.
      if (header && header.at.slice(0, 7) === month) this.set(`quota:${provider}`, { ...header, remaining: header.remaining - credits });
      return token;
    });
  }
  finishReservation(id: string, outcome: string) { this.db.prepare('UPDATE quota SET outcome=? WHERE id=?').run(outcome, id); }
  acquire(name: string, now: string, ttlSeconds: number): string | null {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT expires_at FROM leases WHERE name=?').get(name) as { expires_at: string } | undefined;
      if (row && ms(row.expires_at) > ms(now)) return null;
      const token = randomUUID();
      this.db.prepare('INSERT INTO leases VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at').run(name, token, new Date(ms(now) + ttlSeconds * 1000).toISOString());
      return token;
    });
  }
  leaseValid(name: string, token: string, now: string) { const r = this.db.prepare('SELECT token,expires_at FROM leases WHERE name=?').get(name) as { token: string; expires_at: string } | undefined; return !!r && r.token === token && ms(r.expires_at) > ms(now); }
  renew(name:string,token:string,now:string,ttlSeconds:number){return !!this.db.prepare('UPDATE leases SET expires_at=? WHERE name=? AND token=? AND expires_at>?').run(new Date(ms(now)+ttlSeconds*1000).toISOString(),name,token,now).changes;}
  release(name: string, token: string) { this.db.prepare('DELETE FROM leases WHERE name=? AND token=?').run(name, token); }
  outcomeHistory(): Outcome[] { return (this.db.prepare('SELECT body FROM outcomes UNION ALL SELECT body FROM outcome_revisions ORDER BY 1').all() as {body:string}[]).map(r=>JSON.parse(r.body) as Outcome).sort((a,b)=>ms(a.evidence.observedAt)-ms(b.evidence.observedAt)||ms(a.at)-ms(b.at)); }
  outcomes(): Outcome[] { const latest=new Map<string,Outcome>();for(const r of this.outcomeHistory())latest.set(r.signalId,r);return [...latest.values()]; }
  recordOutcome(outcome: Outcome) { return this.transaction(()=>{
    const previous=this.outcomes().find(o=>o.signalId===outcome.signalId);
    if(previous&&previous.result===outcome.result&&previous.value===outcome.value)return false;
    if(previous&&ms(outcome.evidence.observedAt)<=ms(previous.evidence.observedAt))throw new Error('Stale or ambiguous result correction');
    const next=previous?{...outcome,corrects:previous.id,reason:'Newer verified final statistic correction'}:outcome;
    const table=previous?'outcome_revisions':'outcomes';
    return !!this.db.prepare(`INSERT OR IGNORE INTO ${table} VALUES (?,?,?,?)`).run(next.id,next.signalId,next.at,JSON.stringify(next)).changes;
  }); }
  usage() { return this.db.prepare('SELECT provider,substr(at,1,7) month,COUNT(*) requests,SUM(credits) reservedCredits FROM quota GROUP BY provider,month').all(); }
}
export interface Outcome { id: string; signalId: string; at: string; result: 'won' | 'lost' | 'push' | 'void'; value: number | null; units: number; evidence: GameLog; corrects?:string; reason?:string; }
