import { hash, ms, type Event, type Prop, type Receipt } from '../core/domain';
import { probabilities } from '../core/models';
import { summary } from '../research/distributions';

export type Availability = 'Available' | 'Probable' | 'Questionable' | 'Out' | 'LateScratch' | 'Unknown';
export interface SourceFact<T> { value: T; observedAt: string; source: Receipt }
export interface PregameState {
  event: Event; playerId: string; teamId: string;
  fixture: SourceFact<Event> | null;
  roster: SourceFact<{ playerId: string; teamId: string }> | null;
  injury: SourceFact<Availability> | null;
  teammates: { playerId: string; status: SourceFact<Availability> }[];
  starter: SourceFact<boolean> | null;
}
export interface FreshnessPolicy { version: string; rationale: string; sourceTTLMinutes: number | null; criticalRole: boolean }
export const defaultFreshnessPolicy: FreshnessPolicy = { version: 'pregame-evidence/1', rationale: 'Unknown critical role and changed participation require review; no incident-fitted TTL.', sourceTTLMinutes: null, criticalRole: false };
export const freshnessBuckets = [0, 20, 90, 360, 720, Infinity] as const;
export function ageBucket(minutes: number | null) { if (minutes === null) return 'UNKNOWN'; return freshnessBuckets.slice(1).findIndex((v, i) => minutes >= freshnessBuckets[i] && minutes < v); }
export function assertState(state: PregameState, at: string, retained: (r: Receipt) => boolean) {
  if (![state.event.homeId, state.event.awayId].includes(state.teamId)) throw Error('TEAM_OUTSIDE_FIXTURE');
  for (const f of [state.fixture, state.roster, state.injury, state.starter, ...state.teammates.map(t => t.status)]) {
    if (!f) continue;
    if (f.source.simulated || ms(f.observedAt) > ms(at) || ms(f.source.retrievedAt) > ms(f.observedAt) || f.source.publishedAt !== null && ms(f.source.publishedAt) > ms(f.source.retrievedAt) || !retained(f.source)) throw Error('UNAVAILABLE_AS_OF_EVIDENCE');
  }
  if (state.fixture && hash(state.fixture.value) !== hash(state.event)) throw Error('CANONICAL_FIXTURE_CHANGED');
  if (state.roster && (state.roster.value.playerId !== state.playerId || state.roster.value.teamId !== state.teamId)) throw Error('ROSTER_IDENTITY_CHANGED');
  if (new Set(state.teammates.map(t => t.playerId)).size !== state.teammates.length || state.teammates.some(t => t.playerId === state.playerId)) throw Error('AMBIGUOUS_TEAMMATE_IDENTITY');
}
const semantic = (s: PregameState) => ({ event: s.event, playerId: s.playerId, teamId: s.teamId, roster: s.roster?.value ?? null, injury: s.injury?.value ?? null, teammates: s.teammates.map(t => [t.playerId, t.status.value]).sort(), starter: s.starter?.value ?? null });
export function assessFreshness(old: PregameState, current: PregameState, builtAt: string, at: string, policy = defaultFreshnessPolicy) {
  if (!policy.version || !policy.rationale || policy.sourceTTLMinutes !== null && (!Number.isFinite(policy.sourceTTLMinutes) || policy.sourceTTLMinutes <= 0)) throw Error('VERSIONED_FRESHNESS_POLICY_REQUIRED');
  if (ms(builtAt) > ms(at) || old.event.id !== current.event.id || old.playerId !== current.playerId) throw Error('INVALID_REFRESH_IDENTITY_OR_CLOCK');
  const sources = { injury: current.injury, roster: current.roster, fixture: current.fixture, starter: current.starter };
  const ages = Object.fromEntries(Object.entries(sources).map(([k, f]) => [k, f ? (ms(at) - ms(f.observedAt)) / 60000 : null])) as Record<keyof typeof sources, number | null>;
  const flags: string[] = [];
  const changed = hash(semantic(old)) !== hash(semantic(current));
  if (changed) flags.push('PREGAME_STATE_CHANGED');
  if (!current.injury || current.injury.value === 'Unknown') flags.push('INJURY_UNKNOWN');
  if (current.injury && !['Available', 'Probable'].includes(current.injury.value)) flags.push('PARTICIPATION_UNCONFIRMED');
  if (current.injury && ['Out', 'LateScratch'].includes(current.injury.value)) flags.push('PLAYER_UNAVAILABLE');
  if (current.teammates.some(t => ['Questionable', 'Unknown'].includes(t.status.value))) flags.push('TEAMMATE_UNCERTAIN');
  if (!current.starter) flags.push('ROLE_UNVERIFIED');
  if (!current.roster || !current.fixture || policy.sourceTTLMinutes !== null && Object.values(ages).some(v => v !== null && v > policy.sourceTTLMinutes!)) flags.push('CONTEXT_STALE');
  const review = changed || flags.some(f => ['CONTEXT_STALE', 'INJURY_UNKNOWN', 'PARTICIPATION_UNCONFIRMED', 'TEAMMATE_UNCERTAIN'].includes(f)) || policy.criticalRole && !current.starter;
  const oldClocks = [old.fixture, old.roster, old.injury, old.starter, ...old.teammates.map(t => t.status)].filter(f => f !== null).map(f => ms(f.observedAt));
  const currentClocks = [current.fixture, current.roster, current.injury, current.starter, ...current.teammates.map(t => t.status)].filter(f => f !== null).map(f => ms(f.observedAt));
  return { policy, flags, state: review ? 'REVIEW_SHADOW' as const : 'AUDITABLE' as const, materiallyChanged: changed,
    newerEvidence: currentClocks.some(t => t > Math.max(...oldClocks, -Infinity)), informationChanged: changed,
    forecastAgeMinutes: (ms(at) - ms(builtAt)) / 60000, sourceAgeMinutes: ages,
    sourceAgeBuckets: Object.fromEntries(Object.entries(ages).map(([k, v]) => [k, ageBucket(v)])) };
}
export interface FrozenForecast { id: string; at: string; asOf: string; modelHash: string; featureHash: string; event: Event; playerId: string; teamId: string; prop: Prop; distribution: number[]; state: PregameState }
/** Pure cached calculation. Persist the returned body to an independent
 * append-only journal; no provider, frozen-body update or dispatch is possible. */
export function refreshBeforeIssue(original: FrozenForecast, request: { enabled: boolean; at: string; state: PregameState; featureHash: string; featureCutoffs: string[]; quoteLastUpdate: string | null; modelHash: string; policy?: FreshnessPolicy }, recalculate: () => number[], retained: (r: Receipt) => boolean) {
  if (!request.enabled) return { kind: 'DISABLED' as const, originalId: original.id };
  const at = request.at;
  if (ms(at) >= ms(original.event.startsAt) - 120000 || request.state.teamId !== original.teamId || hash(request.state.event) !== hash(original.event)) throw Error('REFRESH_DEADLINE_OR_IDENTITY_CHANGED');
  if (ms(original.asOf) > ms(original.at) || request.featureCutoffs.some(c => ms(c) > ms(at)) || request.quoteLastUpdate !== null && ms(request.quoteLastUpdate) > ms(at)) throw Error('FUTURE_FEATURE_OR_QUOTE');
  assertState(original.state, original.at, retained); assertState(request.state, at, retained);
  const assessment = assessFreshness(original.state, request.state, original.at, at, request.policy), distribution = recalculate(); summary(distribution);
  const body = { kind: 'CACHED_REFRESH_SHADOW', at, asOf: at, originalId: original.id, originalBodyHash: hash(original), event: original.event, playerId: original.playerId, teamId: original.teamId, prop: original.prop,
    modelHash: request.modelHash, featureHash: request.featureHash, featureCutoffs: request.featureCutoffs, quoteLastUpdate: request.quoteLastUpdate, state: request.state, assessment, distribution,
    informationalImprovementEstablished: false, sameInputs: request.featureHash === original.featureHash && !assessment.informationChanged,
    conditionalOnPlaying: true, participationProbability: null, productionEnabled: false };
  return { kind: 'REVISION' as const, record: { ...body, id: hash(body) } };
}
export function refreshedLine(record: Extract<ReturnType<typeof refreshBeforeIssue>, { kind: 'REVISION' }>['record'], line: number, side: 'over' | 'under') {
  return { forecastId: record.id, modelHash: record.modelHash, featureHash: record.featureHash, ...probabilities(record.distribution, line, side) };
}
