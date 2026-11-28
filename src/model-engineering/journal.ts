import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { hash, ms, nowISO, props, quoteSchema, type Prop, type GameLog, type Quote, type Receipt } from '../core/domain';
import type { Store } from '../core/store';
import { summary } from '../research/distributions';
import { scoreOne } from '../research/scoring';
import { thresholds } from '../research/experiment';
import { probabilities } from '../core/models';
import { comparableSides } from '../research/markets';
import { normalizeOdds } from '../providers/odds';
import { termsSchema, type Terms } from '../core/domain';
import { assertArtifact, type M1Artifact } from './m1';
import { assertState, type PregameState } from './freshness';

export const promotionRule = {
  version: 'independent-model-review/1', automaticPromotion: false,
  minimumIndependentDates: 30, rationale: 'One calendar month of independently frozen daily forecasts is a minimum review sample, not a power guarantee; clustered intervals and coverage still decide.',
  requirements: ['Paired date-cluster CRPS interval below zero versus original and strongest simple control per prop', 'No material NLL, interval coverage or high-risk role-group regression', 'Selected real-quote Brier/log loss and calibration evaluated on distinct prospective dates', 'No missingness/availability advantage or post-event registration', 'Economically plausible paired prices and uncertainty; no guaranteed ROI target', 'Separate immutable owner-authorised promotion decision and safe deployment'],
  noModelChangeOnCodeDeployment: true,
} as const;
export interface ShadowInput {
  asOf: string; state: PregameState; artifact: M1Artifact; featureHash: string;
  featureRefs: { id: string; bodyHash: string; knownAt: string }[];
  prop: Prop; distribution: number[]; minutesDistribution: number[];
  originalControl: { modelHash: string; distribution: number[] };
  frozenProduction: { id: string; at: string; bodyHash: string; distribution: number[] } | null;
  controls: Record<string, number[]>;
  freshness: unknown; previousRevisionId: string | null;
  market: { over: Quote; under: Quote } | null;
  featureAvailability?: 'COMPLETED_FINAL_RECEIPT_AS_OF_GENERATION';
}
export function exactNoVig(over: Quote, under: Quote, at: string, retained: (r: Receipt) => boolean) {
  over = quoteSchema.parse(over); under = quoteSchema.parse(under);
  if (over.teamId !== under.teamId || over.source.hash !== under.source.hash || over.quotedAt !== under.quotedAt || over.retrievedAt !== under.retrievedAt || ms(over.retrievedAt) > ms(at) || ms(over.expiresAt) <= ms(at) || !retained(over.source) || !retained(under.source)) throw Error('MATCHED_QUOTE_SOURCE_OR_CLOCK_REQUIRED');
  return comparableSides(over, under);
}
export function verifyCachedQuote(source: Store, quote: Quote, at: string) {
  const terms = source.get<{ terms: Terms[] }>('suggestions:terms')?.terms.find(t => t.id === quote.termsId);
  if (!terms) throw Error('EXACT_CACHED_TERMS_REQUIRED'); termsSchema.parse(terms);
  for (const receipt of [quote.source, quote.mappingProof.event.source, quote.mappingProof.player.source, ...(quote.mappingProof.event.canonicalFixtureSource ? [quote.mappingProof.event.canonicalFixtureSource] : []), terms.source]) if (receipt.simulated || ms(receipt.retrievedAt) > ms(at) || !source.hasReceipt(receipt)) throw Error('EXACT_CACHED_QUOTE_RECEIPTS_REQUIRED');
  const row = source.db.prepare('SELECT body FROM receipts WHERE hash=?').get(quote.source.hash);
  if (!row || !normalizeOdds(JSON.parse(String(row.body)), quote.source, { events: [quote.mappingProof.event], players: [quote.mappingProof.player] }, [terms], quote.bookmaker, quote.mappingProof.event.clockBridgePolicy === 'unique-team-pair-earliest-clock/1').quotes.some(q => hash(q) === hash(quote))) throw Error('QUOTE_DIFFERS_FROM_ORIGINAL_SOURCE');
}
export class EngineeringJournal {
  db: DatabaseSync;
  private immutableReadOnlyRefs=new WeakMap<Store,Map<string,{known:number;start:number;completed:number|null;final:boolean;eventId:string}>>();
  constructor(path: string, private enabled = false, private clock = nowISO) {
    if (!enabled) { this.db = new DatabaseSync(':memory:'); return; }
    if (path !== ':memory:') {
      if (!resolve(path).includes('/.local/') || !path.endsWith('/engineering-shadow.sqlite')) throw Error('PRIVATE_SEPARATE_ENGINEERING_JOURNAL_REQUIRED');
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      if (!realpathSync(dirname(path)).includes('/.local/')) throw Error('PRIVATE_REALPATH_REQUIRED');
    }
    this.db = new DatabaseSync(path); if (path !== ':memory:') chmodSync(path, 0o600);
    if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('logs','signals','challenger_predictions','experimental_suggestions')").get()) { this.db.close(); throw Error('EXISTING_PRODUCTION_OR_COMPARISON_DATABASE_FORBIDDEN'); }
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=100;
      CREATE TABLE IF NOT EXISTS engineering_models(id TEXT PRIMARY KEY,registered_at TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS engineering_manifests(id TEXT PRIMARY KEY,body BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS engineering_predictions(id TEXT PRIMARY KEY,model_id TEXT NOT NULL REFERENCES engineering_models(id),registered_at TEXT NOT NULL,event_id TEXT NOT NULL,player_id TEXT NOT NULL,prop TEXT NOT NULL,as_of TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(model_id,event_id,player_id,prop,as_of));
      CREATE INDEX IF NOT EXISTS engineering_grade_scan ON engineering_predictions(registered_at,id);
      CREATE TABLE IF NOT EXISTS engineering_grades(id TEXT PRIMARY KEY,prediction_id TEXT NOT NULL REFERENCES engineering_predictions(id),at TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS engineering_holds(id TEXT PRIMARY KEY,at TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS engineering_markets(id TEXT PRIMARY KEY,prediction_id TEXT NOT NULL REFERENCES engineering_predictions(id),at TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS engineering_market_grades(id TEXT PRIMARY KEY,observation_id TEXT NOT NULL REFERENCES engineering_markets(id),at TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS engineering_checks(id TEXT PRIMARY KEY,prediction_id TEXT NOT NULL REFERENCES engineering_predictions(id),at TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS engineering_runtime(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    for (const table of ['engineering_models', 'engineering_manifests', 'engineering_predictions', 'engineering_grades', 'engineering_holds', 'engineering_markets', 'engineering_market_grades', 'engineering_checks']) for (const op of ['UPDATE', 'DELETE']) this.db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${table}_${op} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Engineering evidence is immutable'); END;`);
  }
  private active() { if (!this.enabled) throw Error('ENGINEERING_SHADOW_DISABLED'); }
  publish(artifact: M1Artifact) {
    this.active(); assertArtifact(artifact); const at = this.clock();
    if (ms(artifact.trainedAt) > ms(at) || ms(artifact.trainingCutoff) >= ms(at)) throw Error('FUTURE_MODEL');
    const body = { artifact, registeredAt: at, lifecycle: 'CHALLENGER_SHADOW', promotionRule, productionEnabled: false };
    this.db.prepare('INSERT OR IGNORE INTO engineering_models VALUES (?,?,?)').run(artifact.id, at, JSON.stringify(body));
    return artifact.id;
  }
  register(input: ShadowInput, source: Store) {
    this.active(); const start = this.clock();
    const sourceFile = String(source.db.prepare('PRAGMA database_list').get()!.file), journalFile = String(this.db.prepare('PRAGMA database_list').get()!.file);
    if (sourceFile && journalFile && realpathSync(sourceFile) === realpathSync(journalFile)) throw Error('SOURCE_AND_JOURNAL_MUST_DIFFER');
    if (ms(input.asOf) > ms(start) || ms(start) - ms(input.asOf) > 10000 || ms(start) >= ms(input.state.event.startsAt) - 120000) throw Error('NO_BACKDATED_OR_LATE_SHADOW');
    assertArtifact(input.artifact); assertState(input.state, input.asOf, r => source.hasReceipt(r));
    if (!props.includes(input.prop) || !input.state.fixture || !input.state.roster || !input.featureRefs.length || ms(input.artifact.trainedAt) > ms(input.asOf)) throw Error('MODEL_OR_FEATURE_PROVENANCE_REQUIRED');
    const verifyRefs = () => { for (const ref of input.featureRefs) {
      const cachedMode=input.featureAvailability==='COMPLETED_FINAL_RECEIPT_AS_OF_GENERATION'&&(source as Store&{physicalReadOnly?:boolean}).physicalReadOnly===true;
      let cache=this.immutableReadOnlyRefs.get(source);if(cachedMode&&!cache){cache=new Map();this.immutableReadOnlyRefs.set(source,cache);}
      const key=hash([ref.id,ref.bodyHash]),cached=cachedMode?cache?.get(key):undefined;
      if(cached){if(cached.known>=ms(input.asOf)||ms(ref.knownAt)!==cached.known||cached.start>=ms(input.asOf)||cached.completed!==null&&cached.completed>=ms(input.asOf)||!cached.final||cached.eventId===input.state.event.id)throw Error('INVALID_AS_OF_SOURCE');continue;}
      const raw = source.db.prepare('SELECT body FROM logs WHERE id=?').get(ref.id);
      if (!raw || hash(String(raw.body)) !== ref.bodyHash || ms(ref.knownAt) >= ms(input.asOf)) throw Error('FEATURE_MANIFEST_CHANGED_OR_FUTURE');
      const l = JSON.parse(String(raw.body)) as GameLog;
      const invalidGame = input.featureAvailability === 'COMPLETED_FINAL_RECEIPT_AS_OF_GENERATION' ? !l.final || l.event.id === input.state.event.id || ms(l.event.startsAt)>=ms(input.asOf) || !!l.completedAt&&ms(l.completedAt)>=ms(input.asOf) : l.event.startsAt.slice(0,10)>=input.asOf.slice(0,10);
      if (l.source.simulated || invalidGame || ms(l.observedAt) >= ms(input.asOf) || [l.source, ...(l.supportingSources ?? [])].some(r => ms(r.retrievedAt) >= ms(input.asOf) || !source.hasReceipt(r))) throw Error('INVALID_AS_OF_SOURCE');
      if(cachedMode){const known=Math.max(ms(l.observedAt),...[l.source,...(l.supportingSources??[])].map(r=>ms(r.retrievedAt)));if(ms(ref.knownAt)!==known)throw Error('FEATURE_KNOWN_CLOCK_MISMATCH');cache!.set(key,{known,start:ms(l.event.startsAt),completed:l.completedAt?ms(l.completedAt):null,final:l.final,eventId:l.event.id});}
    } };
    const currentIdentity = () => {
      const fixture = source.get<{event: PregameState['event'];status: string}>(`live:fixture:${input.state.event.id.split(':').at(-1)}`), roster = source.get<{playerId: string;teamId: string}>(`live:roster:${input.state.playerId.split(':').at(-1)}`);
      if (!fixture || fixture.status !== 'scheduled' || hash(fixture.event) !== hash(input.state.event) || !roster || roster.playerId !== input.state.playerId || roster.teamId !== input.state.teamId) throw Error('CURRENT_IDENTITY_CHANGED');
    };
    currentIdentity();
    verifyRefs(); summary(input.distribution); summary(input.minutesDistribution); summary(input.originalControl.distribution); Object.values(input.controls).forEach(summary);
    if (input.minutesDistribution[0] !== 0) throw Error('DNP_MASS_FORBIDDEN');
    if (input.market) { verifyCachedQuote(source, input.market.over, input.asOf); verifyCachedQuote(source, input.market.under, input.asOf); }
    const market = input.market ? exactNoVig(input.market.over, input.market.under, input.asOf, r => source.hasReceipt(r)) : null;
    if (market && (hash(market.original.over.event) !== hash(input.state.event) || market.original.over.playerId !== input.state.playerId || market.original.over.teamId !== input.state.teamId || market.original.over.prop !== input.prop)) throw Error('MARKET_TARGET_MISMATCH');
    if (input.frozenProduction && (ms(input.frozenProduction.at) > ms(input.asOf) || !input.frozenProduction.id)) throw Error('FUTURE_PRODUCTION_PAIR');
    const model = this.db.prepare('SELECT registered_at FROM engineering_models WHERE id=?').get(input.artifact.id);
    if (!model || ms(String(model.registered_at)) > ms(input.asOf)) throw Error('PUBLISHED_MODEL_REQUIRED');
    this.db.exec('BEGIN IMMEDIATE'); try {
      const at = this.clock();
      if (ms(at) < ms(start) || ms(at) - ms(input.asOf) > 10000 || ms(at) >= ms(input.state.event.startsAt) - 120000) throw Error('REGISTRATION_CROSSED_DEADLINE');
      const manifest = JSON.stringify(input.featureRefs), manifestId = hash(manifest);
      this.db.prepare('INSERT OR IGNORE INTO engineering_manifests VALUES (?,?)').run(manifestId, gzipSync(manifest));
      const body = { version: 'engineering-shadow/1', ...input, artifact: { id: input.artifact.id, sourceHash: input.artifact.sourceHash }, featureRefs: { manifestId, count: input.featureRefs.length }, registeredAt: at, conditionalOnPlaying: true, participationProbability: null, lifecycle: 'CHALLENGER_SHADOW', market, productionEnabled: false, dispatchAllowed: false }, id = hash([input.artifact.id, input.state.event.id, input.state.playerId, input.prop, input.featureHash]);
      const previous = this.db.prepare('SELECT body FROM engineering_predictions WHERE id=?').get(id);
      if (previous) { this.db.exec('ROLLBACK'); return { inserted: false, record: JSON.parse(String(previous.body)) }; }
      verifyRefs(); currentIdentity(); const record = { ...body, id, bodyHash: hash(body) };
      this.db.prepare('INSERT INTO engineering_predictions VALUES (?,?,?,?,?,?,?,?)').run(id, input.artifact.id, at, input.state.event.id, input.state.playerId, input.prop, input.asOf, JSON.stringify(record));
      currentIdentity();
      if (ms(this.clock()) >= ms(input.state.event.startsAt) - 120000) throw Error('REGISTRATION_CROSSED_DEADLINE');
      this.db.exec('COMMIT'); return { inserted: true, record };
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  observeMarket(predictionId: string, over: Quote, under: Quote, source: Store) {
    this.active(); const at = this.clock(), raw = this.db.prepare('SELECT body FROM engineering_predictions WHERE id=?').get(predictionId);
    if (!raw) throw Error('FROZEN_PREDICTION_REQUIRED'); const p = JSON.parse(String(raw.body));
    verifyCachedQuote(source, over, at); verifyCachedQuote(source, under, at);
    const market = exactNoVig(over, under, at, s => source.hasReceipt(s));
    if (hash(over.event) !== hash(p.state.event) || over.playerId !== p.state.playerId || over.teamId !== p.state.teamId || over.prop !== p.prop || ms(p.registeredAt) > ms(over.retrievedAt) || ms(at) >= ms(over.event.startsAt) - 120000) throw Error('PREGAME_MATCHED_MARKET_REQUIRED');
    const body = { at, predictionId, market, forecastBodyHash: p.bodyHash }, id = hash([predictionId, over, under]);
    this.db.prepare('INSERT OR IGNORE INTO engineering_markets VALUES (?,?,?,?)').run(id, predictionId, at, JSON.stringify(body)); return id;
  }
  hold(target: unknown, reason: string) { this.active(); const body = { at: this.clock(), target, reason, dispatchAllowed: false }; this.db.prepare('INSERT OR IGNORE INTO engineering_holds VALUES (?,?,?)').run(hash(body), body.at, JSON.stringify(body)); }
  grade(source: Store, limit = 200) {
    this.active(); const at = this.clock(), results: unknown[] = [];
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Error('BOUNDED_GRADE_BATCH_REQUIRED');
    const cursorRow = this.db.prepare("SELECT value FROM engineering_runtime WHERE key='gradeCursor'").get(), cursor = cursorRow ? JSON.parse(String(cursorRow.value)) : { at: '', id: '' };
    let batch = this.db.prepare('SELECT id,registered_at FROM engineering_predictions WHERE (registered_at,id)>(?,?) ORDER BY registered_at,id LIMIT ?').all(cursor.at, cursor.id, limit);
    if (!batch.length) batch = this.db.prepare('SELECT id,registered_at FROM engineering_predictions ORDER BY registered_at,id LIMIT ?').all(limit);
    for (const r of batch) {
      this.db.prepare("INSERT INTO engineering_runtime VALUES ('gradeCursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({ at: r.registered_at, id: r.id }));
      const selected=this.db.prepare('SELECT body FROM engineering_predictions WHERE id=?').get(r.id!);if(!selected)throw Error('IMMUTABLE_GRADING_PREDICTION_MISSING');
      const p = JSON.parse(String(selected.body)), { id, bodyHash, ...body } = p;
      if (hash(body) !== bodyHash) throw Error('FROZEN_PREDICTION_CHANGED');
      if (ms(p.state.event.startsAt) >= ms(at)) continue;
      const raw = source.db.prepare('SELECT id,body FROM logs WHERE event_id=? AND player_id=? AND observed_at<=? ORDER BY observed_at DESC,rowid DESC LIMIT 1').get(p.state.event.id, p.state.playerId, at);
      const check = (state: 'HELD' | 'GRADED', reason: string | null) => { const body = { at, predictionId: id, state, reason, finalRef: raw ? { id: raw.id, bodyHash: hash(String(raw.body)) } : null }; this.db.prepare('INSERT OR IGNORE INTO engineering_checks VALUES (?,?,?,?)').run(hash([id, body.finalRef, state, reason]), id, at, JSON.stringify(body)); };
      if (!raw) { this.hold({ id }, 'MISSING_FINAL'); check('HELD', 'MISSING_FINAL'); continue; }
      const l = JSON.parse(String(raw.body)) as GameLog;
      if (!l.final || l.source.simulated || hash(l.event) !== hash(p.state.event) || l.teamId !== p.state.teamId || [l.source, ...(l.supportingSources ?? [])].some(s => ms(s.retrievedAt) > ms(at) || !source.hasReceipt(s))) { this.hold({ id }, 'EXACT_GENUINE_FINAL_REQUIRED'); check('HELD', 'EXACT_GENUINE_FINAL_REQUIRED'); continue; }
      if (l.participated !== true || l.minutes === null || l.minutes <= 0 || l.stats[p.prop as Prop] === null) { const reason = l.participated === false ? 'DNP_NO_CONDITIONAL_SCORE_BOOK_TERMS_REQUIRED' : 'UNKNOWN_PARTICIPATION_OR_STAT'; this.hold({ id }, reason); check('HELD', reason); continue; }
      const actual = l.stats[p.prop as Prop]!, market = p.market ? (() => { const q = p.market.original.over, o = probabilities(p.distribution, q.line, 'over'), push = actual === q.line; return { line: q.line, push, model: o.push < 1 ? o.win / (1 - o.push) : null, market: p.market.over, brier: push ? null : (o.win / (1 - o.push) - Number(actual > q.line)) ** 2, marketBrier: push ? null : (p.market.over - Number(actual > q.line)) ** 2 }; })() : null;
      const grade = { at, predictionId: id, finalRef: { id: raw.id, bodyHash: hash(String(raw.body)) }, actual, minutes: l.minutes, date: l.event.startsAt.slice(0, 10), fixture: l.event.id,
        scores: Object.fromEntries(Object.entries({ M1: p.distribution, originalControl: p.originalControl.distribution, ...(p.frozenProduction ? { frozenProduction: p.frozenProduction.distribution } : {}), ...p.controls }).map(([k, d]) => [k, scoreOne(d as number[], actual, thresholds.NBA[p.prop as Prop])])), market };
      // Revision key binds final body; identical polling appends nothing.
      const gradeId = hash([id, grade.finalRef]); this.db.prepare('INSERT OR IGNORE INTO engineering_grades VALUES (?,?,?,?)').run(gradeId, id, at, JSON.stringify(grade)); results.push(gradeId);
      check('GRADED', null);
      for (const row of this.db.prepare('SELECT id,body FROM engineering_markets WHERE prediction_id=?').all(id)) {
        const o = JSON.parse(String(row.body)), q = o.market.original.over, pOver = probabilities(p.distribution, q.line, 'over'), push = actual === q.line;
        const probability = pOver.push < 1 ? pOver.win / (1 - pOver.push) : null, body = { at, observationId: row.id, predictionId: id, finalRef: grade.finalRef, actual, push, probability, market: o.market.over, brier: push || probability === null ? null : (probability - Number(actual > q.line)) ** 2, marketBrier: push ? null : (o.market.over - Number(actual > q.line)) ** 2, fixture: l.event.id, date: l.event.startsAt.slice(0, 10) };
        this.db.prepare('INSERT OR IGNORE INTO engineering_market_grades VALUES (?,?,?,?)').run(hash([row.id, grade.finalRef]), String(row.id), at, JSON.stringify(body));
      }
    }
    return { examinedLimit: limit, graded: results.length, productionEnabled: false, networkRequests: 0, messages: 0 };
  }
  close() { this.db.close(); }
}
