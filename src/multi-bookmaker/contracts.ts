import {z} from 'zod';
import {propSchema,stamp} from '../core/domain';
export const BOOKMAKERS=['sportsbet','tab','neds','ladbrokes_au'] as const;
export type Bookmaker=typeof BOOKMAKERS[number];
export const bookSchema=z.enum(BOOKMAKERS);
export const BOOK_NAMES:Record<Bookmaker,string>={sportsbet:'Sportsbet',tab:'TAB',neds:'Neds',ladbrokes_au:'Ladbrokes Australia'};
export const STATES=['AVAILABLE_VERIFIED','NOT_OBSERVED','STALE','IDENTITY_AMBIGUOUS','MARKET_MISMATCH','SOURCE_ERROR','QUOTA_BLOCKED'] as const;
export type Availability=typeof STATES[number];
export const multiConfigSchema=z.object({codeEnabled:z.boolean().default(false),paidAcquisitionEnabled:z.boolean().default(false),comparisonEnabled:z.boolean().default(false),telegramEnabled:z.boolean().default(false),protectionFile:z.string().nullable().default(null),activationFile:z.string().nullable().default(null),grantFile:z.string().nullable().default(null),enabledMarkets:z.object({sportsbet:z.array(propSchema).default([]),tab:z.array(propSchema).default([]),neds:z.array(propSchema).default([]),ladbrokes_au:z.array(propSchema).default([])}).prefault({})}).strict();
export type MultiConfig=z.infer<typeof multiConfigSchema>;
export const VERSION='four-bookmaker/1.4.8';
export const protectionSchema=z.object({version:z.literal('multi-bookmaker-protected-cycle/1.4.8'),capturedAt:stamp,protectedOperatingDate:z.literal('2026-11-24'),timezone:z.literal('Australia/Melbourne'),earliestOperatingDate:z.literal('2026-11-25'),fixtureIds:z.array(z.string()).min(1),jobIds:z.array(z.string()).min(1),jobs:z.array(z.unknown()),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const activationSchema=z.object({version:z.literal(VERSION),id:z.string().uuid(),ownerApproved:z.literal(true),approvedAt:stamp,effectiveAt:stamp,protectionHash:z.string().regex(/^[a-f0-9]{64}$/),codeCommit:z.string().regex(/^[a-f0-9]{40}$/)}).strict();
export const grantSchema=z.object({version:z.literal(VERSION),id:z.string().uuid(),ownerApproved:z.literal(true),approvedAt:stamp,expiresAt:stamp,activationId:z.string().uuid(),protectionHash:z.string().regex(/^[a-f0-9]{64}$/),policyId:z.string().uuid(),policyBinding:z.string().regex(/^[a-f0-9]{64}$/),apiKeyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),eventIds:z.array(z.string()).min(1).max(5),maxRequests:z.number().int().min(1).max(40),maxCredits:z.number().int().min(1).max(120)}).strict();
export interface CycleJob {id:string;event_id:string;stage:string;due_at:string;deadline:string;state:string;body:string;}
