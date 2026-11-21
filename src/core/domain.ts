import { createHash } from 'node:crypto';
import { z } from 'zod';

export const stamp = z.iso.datetime({ offset: true });
export const id = z.string().min(1).max(240);
export const hash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const nowISO = () => new Date().toISOString();
export const ms = (value: string) => { const n = Date.parse(stamp.parse(value)); if (!Number.isFinite(n)) throw new Error('Invalid timestamp'); return n; };
export const leagueSchema = z.enum(['NBA', 'NBL']);
export type League = z.infer<typeof leagueSchema>;
export const propSchema = z.enum(['points', 'rebounds', 'assists', 'threes']);
export type Prop = z.infer<typeof propSchema>;
export const props: Prop[] = ['points', 'rebounds', 'assists', 'threes'];
export const statsSchema = z.object({ points: z.number().int().min(0).max(150).nullable(), rebounds: z.number().int().min(0).max(70).nullable(), assists: z.number().int().min(0).max(50).nullable(), threes: z.number().int().min(0).max(35).nullable() }).strict();
export const receiptSchema = z.object({
  provider: id, endpoint: z.string().min(1), retrievedAt: stamp, publishedAt: stamp.nullable(),
  hash: z.string().regex(/^[a-f0-9]{64}$/), simulated: z.boolean(),
}).strict();
export type Receipt = z.infer<typeof receiptSchema>;
export const eventSchema = z.object({ id, league: leagueSchema, season: id, homeId: id, awayId: id, home: id, away: id, startsAt: stamp }).strict().refine(e => e.homeId !== e.awayId, 'Distinct teams required');
export type Event = z.infer<typeof eventSchema>;
export const researchMetadataSchema=z.object({phase:z.enum(['regular','playoffs','preseason','cup','unknown']),overtimePeriods:z.number().int().min(0).max(10).nullable(),threeAttempts:z.number().int().min(0).max(60).nullable(),rosterOpportunityVerified:z.boolean()}).strict();
export const gameLogSchema = z.object({
  event: eventSchema, playerId: id, teamId: id, player: id,
  completedAt: stamp.nullable(), observedAt: stamp, minutes: z.number().min(0).max(75).nullable(),
  participated: z.boolean().nullable(), stats: statsSchema, final: z.boolean(), source: receiptSchema, supportingSources: z.array(receiptSchema).optional(), research:researchMetadataSchema.optional(),
}).strict().superRefine((r, c) => {
  if(r.participated===false&&(r.minutes!==null&&r.minutes!==0||Object.values(r.stats).some(v=>v!==null&&v!==0)))c.addIssue({code:'custom',message:'DNP conflicts with production/minutes'});
  if(r.research?.threeAttempts!==null&&r.research?.threeAttempts!==undefined&&r.stats.threes!==null&&r.stats.threes>r.research.threeAttempts)c.addIssue({code:'custom',message:'Made threes exceed attempts'});
  if(r.research?.overtimePeriods!==null&&r.research?.overtimePeriods!==undefined&&r.minutes!==null&&r.minutes>(r.event.league==='NBA'?48:40)+5*r.research.overtimePeriods)c.addIssue({code:'custom',message:'Minutes exceed verified game duration'});
  if (![r.event.homeId, r.event.awayId].includes(r.teamId)) c.addIssue({ code: 'custom', message: 'Player team outside fixture' });
  if (r.completedAt && (ms(r.completedAt) <= ms(r.event.startsAt) || ms(r.observedAt) < ms(r.completedAt)) || ms(r.source.retrievedAt) > ms(r.observedAt) || (r.supportingSources??[]).some(s=>ms(s.retrievedAt)>ms(r.observedAt)) || ms(r.observedAt) <= ms(r.event.startsAt)) c.addIssue({ code: 'custom', message: 'Invalid log chronology' });
});
export type GameLog = z.infer<typeof gameLogSchema>;
export const termsSchema = z.object({
  id, bookmaker: id, prop: propSchema, league: leagueSchema, includesOvertime: z.literal(true),
  integerPush: z.literal(true), dnpVoid: z.literal(true), source: receiptSchema,
}).strict();
export type Terms = z.infer<typeof termsSchema>;
export const eventMappingSchema=z.object({oddsId:id,event:eventSchema,verifiedAt:stamp,source:receiptSchema}).strict();
export const playerMappingSchema=z.object({eventId:id,description:id,playerId:id,player:id,teamId:id,verifiedAt:stamp,source:receiptSchema}).strict();
export const mappingProofSchema=z.object({event:eventMappingSchema,player:playerMappingSchema}).strict();
export const quoteSchema = z.object({
  event: eventSchema, playerId: id, player: id, teamId: id, prop: propSchema,
  side: z.enum(['over', 'under']), line: z.number().min(0).max(150).refine(v => Number.isInteger(v * 2), 'Only integer/half lines supported'),
  decimalOdds: z.number().gt(1).max(100), bookmaker: id,
  quotedAt: stamp, retrievedAt: stamp, expiresAt: stamp, source: receiptSchema,
  termsId: id.nullable(), mappingProof:mappingProofSchema, mappingHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((q, c) => {
  if(hash(q.mappingProof)!==q.mappingHash||hash(q.mappingProof.event.event)!==hash(q.event)||q.mappingProof.player.eventId!==q.event.id||q.mappingProof.player.playerId!==q.playerId||q.mappingProof.player.teamId!==q.teamId) c.addIssue({code:'custom',message:'Immutable mapping proof mismatch'});
  if (![q.event.homeId, q.event.awayId].includes(q.teamId)) c.addIssue({ code: 'custom', message: 'Quote team outside event' });
  if (ms(q.quotedAt) > ms(q.retrievedAt) || ms(q.retrievedAt) !== ms(q.source.retrievedAt) || ms(q.expiresAt) > ms(q.event.startsAt)) c.addIssue({ code: 'custom', message: 'Invalid quote chronology' });
});
export type Quote = z.infer<typeof quoteSchema>;
export const contextSchema = z.object({
  eventId: id, playerId: id, teamId: id, status: z.enum(['available', 'out', 'questionable', 'unknown']),
  expectedMinutes: z.number().min(0).max(60).nullable(), minutesSD: z.number().min(0).max(30).nullable(),
  observedAt: stamp, source: receiptSchema, rosterVerified: z.boolean(),
  // Optional effects must be measured and versioned; absent is not a zero effect.
  opponentRateFactor: z.number().min(0.7).max(1.3).nullable(), homeRateFactor: z.number().min(0.8).max(1.2).nullable(),
  roleNote: z.string().nullable(),
}).strict();
export type Context = z.infer<typeof contextSchema>;
export interface Forecast {
  model: string; version: string; league: League; prop: Prop; at: string; cutoff: string; inputHash: string;
  n: number; expectedMinutes: number; minutesSD: number; mean: number;
  win: number; push: number; loss: number; empiricalWin: number; gammaWin: number; lowerWin: number; robustEV: number;
  distribution?:number[]; benchmarkDistribution?:number[]; artifactHash?:string; voidProbability?:number;
  limitations: string[]; inputs: { logs: GameLog[]; context: Context; quote: Quote; research?:{artifactHash:string;features:number[];featureNames:string[];leagueLogs:GameLog[];participationLogs:GameLog[]} };
}
export interface Decision { quote: Quote; forecast: Forecast | null; qualified: boolean; reasons: string[]; ev: number | null; fairOdds: number | null; breakEven: number; evidence:{terms:Terms|null;validation:unknown}; }
export const exactKey = (q: Quote) => hash([q.event.league, q.event.id, q.playerId, q.prop, q.line, q.side, q.bookmaker]);
export const familyKey = (q: Quote) => hash([q.event.league, q.event.id, q.playerId, q.prop, q.bookmaker]);
export const ev = (win: number, push: number, odds: number) => {
  if (![win, push, odds].every(Number.isFinite) || win < 0 || push < 0 || win + push > 1 + 1e-10 || odds <= 1) throw new Error('Invalid EV inputs');
  return win * odds + push - 1;
};
export function assertReceipt(r: Receipt, now: string, allowSimulated = false) {
  receiptSchema.parse(r);
  if (r.simulated && !allowSimulated) throw new Error('Simulated evidence cannot enter live processing');
  if (ms(r.retrievedAt) > ms(now) || r.publishedAt && ms(r.publishedAt) > ms(r.retrievedAt)) throw new Error('Future source evidence');
}
export function quoteFresh(q: Quote, now: string, maxAge = 180, beforeStart = 120) {
  quoteSchema.parse(q);
  const age = ms(now) - ms(q.quotedAt), retrievedAge = ms(now) - ms(q.retrievedAt);
  return age >= 0 && age <= maxAge * 1000 && retrievedAge >= 0 && retrievedAge <= maxAge * 1000 && ms(now) < ms(q.expiresAt) && ms(now) < ms(q.event.startsAt) - beforeStart * 1000;
}
