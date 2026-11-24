import { hash, ms, nowISO, props, type Event, type Prop, type Receipt } from '../core/domain';
import type { Store } from '../core/store';
import { preparedFeatures } from '../research/features';
import { predict, modelSpec } from '../research/models';
import { artifactSchema } from '../research/inference';
import { calibrateCDF } from '../research/calibration';
import { researchModels } from '../research/shadow';
import { fixtureProof, rosterProof, upcomingFixtures } from '../suggestions/forecasts';
import { productionForecasts } from '../production/router';
import { deploymentSafety, protectedCycleSafety } from '../production/deployment';
import { knownAt, retainedRows } from './data';
import { pregameEvidence } from './evidence';
import { assessFreshness } from './freshness';
import { predictM1, assertArtifact, type M1Artifact } from './m1';
import { EngineeringJournal } from './journal';
import { exactNoVig } from './journal';
import { quoteSchema, type Quote } from '../core/domain';
import { shadowIdle } from './runtime';

export interface ShadowCyclePlan {
  enabled: boolean; model: M1Artifact; pinnedSourceHash: string;
  protection: unknown; reviewedProtectionHash: string;
  journalPath: string; budgetMs: number; maxRecords: number;
}
/** Called only by a separately pinned, guarded offline research invocation.
 * It neither installs a worker nor migrates or writes the source database. */
export function cachedShadowCycle(source: Store, plan: ShadowCyclePlan, loadedCodeHash: string, clock = nowISO) {
  if (!plan.enabled) return { state: 'DISABLED', networkRequests: 0, messages: 0 };
  const at = clock(), started = performance.now();
  if (loadedCodeHash !== plan.pinnedSourceHash || plan.model.sourceHash !== loadedCodeHash) throw Error('PINNED_RESEARCH_CODE_CHANGED');
  assertArtifact(plan.model);
  const protection = protectedCycleSafety(source, plan.protection, plan.reviewedProtectionHash, at), idle = shadowIdle(source, at);
  if (!protection.safe || !idle.safe) return { state: 'PROTECTED_GATE_BLOCKED', at, blocks: [...protection.blocks, ...idle.blocks], networkRequests: 0, messages: 0 };
  if (!Number.isInteger(plan.maxRecords) || plan.maxRecords < 1 || plan.maxRecords > 4 || plan.budgetMs < 100 || plan.budgetMs > 2000) throw Error('BOUNDED_SHADOW_CYCLE_REQUIRED');
  const journal = new EngineeringJournal(plan.journalPath, true, clock), holds: unknown[] = [];
  let inserted = 0, examined = 0;
  try {
    journal.publish(plan.model);
    const rows = retainedRows(source, at), get = preparedFeatures(rows, 'as-of'), stateAt = pregameEvidence(source), fixtures = upcomingFixtures(source, at), originals = researchModels(source);
    const inferenceStarted = performance.now();
    // One task is bounded and yields to source/paid/delivery stages. Repeated
    // invocations skip the exact unchanged evidence fingerprint and cover slate.
    for (const fixture of fixtures) {
      const players = source.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%' AND json_extract(value,'$.teamId') IN (?,?) ORDER BY key").all(fixture.event.homeId, fixture.event.awayId).map(r => JSON.parse(String(r.value)) as { playerId: string; teamId: string; observedAt: string; source: Receipt });
      const frozen = productionForecasts(source, at, [fixture.event.id]);
      for (const player of players) for (const prop of props) {
        const now = clock();
        if (performance.now() - inferenceStarted > plan.budgetMs || examined >= plan.maxRecords || !shadowIdle(source, now).safe) return { state: 'YIELDED', inserted, examined, holds, preparationMs: inferenceStarted - started, networkRequests: 0, messages: 0 };
        const target = { event: fixture.event, ...player };
        try {
          fixtureProof(source, fixture.event, fixture.source, now); rosterProof(source, player, now);
          const f = get(target, prop, now); if (!f) throw Error('INSUFFICIENT_CACHED_AS_OF_HISTORY'); f.cutoff = now;
          const state = stateAt(fixture.event, player.playerId, player.teamId, now), refs = [...new Map([...f.history, ...f.leagueHistory, ...f.opportunities].map(r => [hash([r.log.event.id, r.log.playerId, r.log.source.hash]), r])).entries()].map(([id, r]) => {
            const body = source.db.prepare('SELECT body FROM logs WHERE id=?').get(id); if (!body) throw Error('EXACT_INPUT_MISSING');
            return { id, bodyHash: hash(String(body.body)), knownAt: new Date(knownAt(r.log)).toISOString() };
          }).sort((a, b) => a.id.localeCompare(b.id));
          const featureHash = hash({ features: f.values, refs, state }), priorRow = journal.db.prepare('SELECT id,body FROM engineering_predictions WHERE event_id=? AND player_id=? AND prop=? AND model_id=? ORDER BY registered_at DESC,id DESC LIMIT 1').get(fixture.event.id, player.playerId, prop, plan.model.id), prior = priorRow ? JSON.parse(String(priorRow.body)) : null;
          const market = cachedMarketPair(source, fixture.event, player.playerId, prop, now);
          if (prior?.featureHash === featureHash) { if (market) journal.observeMarket(prior.id, market.over, market.under, source); continue; }
          examined++;
          const original = originals.find(m => m.prop === prop); if (!original) throw Error('ORIGINAL_CONTROL_MODEL_UNAVAILABLE');
          const a = artifactSchema.parse(original.artifact); if (original.artifactHash !== hash(a) || ms(a.generatedAt) > ms(now)) throw Error('ORIGINAL_CONTROL_ARTIFACT_CHANGED');
          const simple = prop === 'assists' || prop === 'threes', originalControl = calibrateCDF(predict(f, simple ? a.bestSimple : a.selected)!.pmf, simple ? { method: 'raw' } : a.calibration), m1 = predictM1(f, plan.model)!;
          const controls = Object.fromEntries(['last5', 'last10', 'ewa', 'season-shrunk', 'hierarchical-nb'].map(k => [k, predict(f, modelSpec(k as Parameters<typeof modelSpec>[0]))!.pmf]));
          const old = frozen.find(f => f.playerId === player.playerId && f.prop === prop && f.teamId === player.teamId && hash(f.event) === hash(fixture.event));
          const assessment = assessFreshness(prior?.state ?? (old ? stateAt(old.event, old.playerId, old.teamId, old.at) : state), state, prior?.registeredAt ?? old?.at ?? now, now);
          inserted += Number(journal.register({ asOf: now, state, artifact: plan.model, featureHash, featureRefs: refs, prop, distribution: m1.pmf, minutesDistribution: m1.minutesPMF,
            originalControl: { modelHash: original.artifactHash, distribution: originalControl }, frozenProduction: old ? { id: old.id, at: old.at, bodyHash: hash(old), distribution: old.distribution } : null,
            controls, freshness: assessment, previousRevisionId: prior?.id ?? null, market }, source).inserted);
        } catch (error) { const reason = (error as Error).message; holds.push({ eventId: fixture.event.id, playerId: player.playerId, prop, reason }); journal.hold({ eventId: fixture.event.id, playerId: player.playerId, prop }, reason); }
      }
    }
    return { state: 'COMPLETE', inserted, examined, holds, grading: journal.grade(source), networkRequests: 0, messages: 0 };
  } finally { journal.close(); }
}
export function cachedMarketPair(source: Store, event: Event, playerId: string, prop: Prop, at: string): { over: Quote; under: Quote } | null {
  const quotes = source.db.prepare("SELECT body FROM experimental_candidates WHERE json_extract(body,'$.quote.event.id')=? AND json_extract(body,'$.quote.playerId')=? AND json_extract(body,'$.quote.prop')=? AND at<=? AND at>=? ORDER BY at DESC,id").all(event.id, playerId, prop, at, new Date(ms(at) - 180000).toISOString()).flatMap(r => { const c = JSON.parse(String(r.body)), q = quoteSchema.safeParse(c.quote); return q.success ? [q.data] : []; });
  for (const over of quotes.filter(q => q.side === 'over')) for (const under of quotes.filter(q => q.side === 'under')) try { exactNoVig(over, under, at, r => source.hasReceipt(r)); return { over, under }; } catch { /* No mismatched or stale substitute. */ }
  return null;
}
