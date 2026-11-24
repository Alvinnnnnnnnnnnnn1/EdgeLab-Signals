import { hash, ms, type Event, type Prop } from '../core/domain';
import { promotionRule } from '../model-engineering/journal';

export const TRIAL_VERSION = 'owner-m1-production-trial/1';
export const trialRouting = { points: 'M1_RAW', rebounds: 'M1_RAW', assists: 'M1_RAW', threes: 'EXISTING_PRODUCTION_UNCHANGED' } as const;
export const trialFreshness = { fixtureHours: 6, rosterHours: 24, injuryHours: 4, quoteSeconds: 180, preTipSeconds: 120, history: 'COMPLETED_FINAL_RECEIPT_AS_OF_GENERATION', materialNews: 'REFRESH_OR_HOLD', starterUnknown: null } as const;
export interface TrialProtocol {
  version: typeof TRIAL_VERSION; id: string; ownerReference: string; instructionHash: string; createdAt: string;
  modelId: string; statisticalSourceHash: string; codeHash: string; release: string; commit: string;
  routing: typeof trialRouting; originalArtifacts: Record<Prop, string>; hybridArtifactId: string; hybridArtifactHash: string;
  calibration: 'RAW_FROZEN'; freshness: typeof trialFreshness; qualificationHash: string; configurationHashes: Record<string,string>;
  classification: 'OWNER_AUTHORISED_PROSPECTIVE_NOT_INDEPENDENTLY_VALIDATED'; minimumIndependentDates: 30;
  rollback: { marketPlist: string; originalRouterHash: string }; additionalPaidAcquisition: false;
}
export interface TrialActivation { protocolId: string; activatedAt: string; id: string; window: ReturnType<typeof reviewWindow>; frozen: true; marketPID: number; researchPID: number; comparisonPID: number; }
export interface TrialMarker { enabled: true; protocol: TrialProtocol; activation: TrialActivation; journalPath: string; }
export function assertProtocol(p: TrialProtocol) {
  const { id, ...body } = p;
  if (hash(body) !== id || p.version !== TRIAL_VERSION || hash(p.routing) !== hash(trialRouting) || hash(p.freshness) !== hash(trialFreshness) || p.calibration !== 'RAW_FROZEN' || p.minimumIndependentDates !== promotionRule.minimumIndependentDates || p.additionalPaidAcquisition !== false || p.classification !== 'OWNER_AUTHORISED_PROSPECTIVE_NOT_INDEPENDENTLY_VALIDATED') throw Error('TRIAL_PROTOCOL_CHANGED');
}
export const localDate = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
// Compute midnight from timezone offsets, including the DST transition. No host timezone.
export function melbourneMidnight(day: string) {
  const nominal = Date.parse(day + 'T00:00:00Z'); let guess = nominal;
  for (let i=0;i<3;i++) { const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)); const v=Object.fromEntries(parts.map(p=>[p.type,p.value])); const local=Date.parse(`${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}:${v.second}Z`); guess += nominal-local; }
  return new Date(guess).toISOString();
}
export function reviewWindow(activatedAt: string, events: Event[]) {
  const days = new Map<string, Event[]>();
  for (const e of events.filter(e=>e.league==='NBA')) { const d=localDate(e.startsAt); days.set(d,[...(days.get(d)??[]),e]); }
  const partial = [...days].filter(([,es])=>es.some(e=>ms(e.startsAt)<=ms(activatedAt))&&es.some(e=>ms(e.startsAt)>ms(activatedAt))).map(([d])=>d).sort();
  const complete = [...days].filter(([,es])=>es.every(e=>ms(e.startsAt)>ms(activatedAt))).map(([d])=>d).sort().slice(0,2);
  if (complete.length !== 2) throw Error('TWO_CANONICAL_COMPLETE_NBA_DAYS_REQUIRED');
  const next = new Date(Date.parse(complete[1]+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  return { timezone:'Australia/Melbourne', operatingDates:complete, partialDates:partial, start:melbourneMidnight(complete[0]), endExclusive:melbourneMidnight(next), outcomeReview:'AFTER_FINALS_AND_PARTICIPATION_ARE_VERIFIED', fixtures:events.filter(e=>complete.includes(localDate(e.startsAt))).map(e=>({id:e.id,startsAt:e.startsAt})).sort((a,b)=>a.startsAt.localeCompare(b.startsAt)), scheduleAtActivationOnly:true };
}
