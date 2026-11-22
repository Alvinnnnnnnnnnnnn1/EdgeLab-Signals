import {z} from 'zod';
import {eventSchema,gameLogSchema,receiptSchema,hash,ms,stamp,type GameLog,type Receipt,type Event} from '../core/domain';
import {artifactSchema,type ResearchArtifact} from '../research/inference';

export const INTELLIGENCE_VERSION='research-intelligence/1.4.4';
export const rawFields=['fgm','fga','fg3a','ftm','fta','oreb','dreb','turnover','plus_minus','usage'] as const;
export type RawFields=Record<typeof rawFields[number],number|null>;
export interface EnrichedGame {log:GameLog;raw:RawFields;rawRowId:string|null;rawSource:Receipt|null;issues:string[];}
export interface FixtureEvidence {event:Event;source:Receipt;status:string;}
export interface AvailabilityEvidence {fixtureId:string|null;playerId:string;teamId:string|null;status:'out'|'doubtful'|'questionable'|'probable'|'available'|'projected-starter'|'confirmed-starter';minutesLimit:number|null;observedAt:string;sourceUpdatedAt?:string|null;validUntil:string;source:Receipt;}
export interface InjuryObservation {playerId:string;teamId:string|null;status:string;description:string|null;returnDate:string|null;source:Receipt;observedAt:string;publishedAt:null;}
export interface IntelligenceSnapshot {version:typeof INTELLIGENCE_VERSION;id:string;capturedAt:string;sourceReference:string;rows:EnrichedGame[];fixtures:FixtureEvidence[];roster?:{playerId:string;teamId:string;source:Receipt}[];availability:AvailabilityEvidence[];injuries?:InjuryObservation[];exclusions?:string[];models:{prop:string;artifact:ResearchArtifact;artifactHash:string;registeredAt:string}[];checkpoints:{key:string;value:unknown}[];sourceManifest:{receipt:Receipt;bodyHashVerified:true}[];}
export const knownAt=(log:GameLog,extra?:Receipt|null)=>Math.max(ms(log.observedAt),...[log.source,...(log.supportingSources??[]),...(extra?[extra]:[])].flatMap(s=>[ms(s.retrievedAt),...(s.publishedAt?[ms(s.publishedAt)]:[])]));
export const receiptKnownAt=(source:Receipt)=>Math.max(ms(source.retrievedAt),source.publishedAt?ms(source.publishedAt):0);
export function snapshotID(snapshot:Omit<IntelligenceSnapshot,'id'>|IntelligenceSnapshot){const {id:ignored,...body}=snapshot as IntelligenceSnapshot;void ignored;return hash(body);}
export function validateSnapshot(value:unknown):IntelligenceSnapshot {
  const s=value as IntelligenceSnapshot;
  if(!s||s.version!==INTELLIGENCE_VERSION||!Array.isArray(s.rows)||!Array.isArray(s.fixtures)||!Array.isArray(s.models)||!Array.isArray(s.availability)||snapshotID(s)!==s.id)throw new Error('RESEARCH_SNAPSHOT_INTEGRITY');
  stamp.parse(s.capturedAt);const manifest=new Set(s.sourceManifest.map(r=>{receiptSchema.parse(r.receipt);if(!r.bodyHashVerified||r.receipt.simulated)throw new Error('NON_GENUINE_RESEARCH_SOURCE');return hash(r.receipt);}));
  for(const r of s.rows){gameLogSchema.parse(r.log);if(r.log.source.simulated||knownAt(r.log,r.rawSource)>ms(s.capturedAt))throw new Error('RESEARCH_SOURCE_CLOCK');for(const source of [r.log.source,...(r.log.supportingSources??[]),...(r.rawSource?[r.rawSource]:[])])if(!manifest.has(hash(source)))throw new Error('MISSING_RESEARCH_PROVENANCE');for(const key of rawFields)if(r.raw[key]!==null&&(!Number.isFinite(r.raw[key])||key!=='plus_minus'&&r.raw[key]!<0))throw new Error('INVALID_RAW_FEATURE');}
  for(const f of s.fixtures){eventSchema.parse(f.event);if(!manifest.has(hash(f.source))||receiptKnownAt(f.source)>ms(s.capturedAt))throw new Error('FIXTURE_PROVENANCE');}
  for(const r of s.roster??[])if(!manifest.has(hash(r.source))||receiptKnownAt(r.source)>ms(s.capturedAt))throw new Error('ROSTER_PROVENANCE');
  for(const a of s.availability){z.enum(['out','doubtful','questionable','probable','available','projected-starter','confirmed-starter']).parse(a.status);stamp.parse(a.observedAt);stamp.parse(a.validUntil);if(a.sourceUpdatedAt)stamp.parse(a.sourceUpdatedAt);if(!manifest.has(hash(a.source))||ms(a.observedAt)>ms(s.capturedAt)||receiptKnownAt(a.source)>ms(a.observedAt)||a.sourceUpdatedAt&&ms(a.sourceUpdatedAt)>ms(a.observedAt)||a.minutesLimit!==null&&(!Number.isFinite(a.minutesLimit)||a.minutesLimit<0))throw new Error('AVAILABILITY_PROVENANCE');}
  for(const a of s.injuries??[])if(!manifest.has(hash(a.source))||ms(a.observedAt)>ms(s.capturedAt))throw new Error('INJURY_PROVENANCE');
  for(const m of s.models){artifactSchema.parse(m.artifact);if(hash(m.artifact)!==m.artifactHash)throw new Error('FROZEN_ARTIFACT_INTEGRITY');}
  return s;
}
export const optionalNumber=z.number().finite().nullable();
