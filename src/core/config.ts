import {exposureConfigSchema} from '../suggestions/exposure';
import {multiConfigSchema} from '../multi-bookmaker/contracts';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { z } from 'zod';
import { leagueSchema, stamp } from './domain';
const provider = z.object({ enabled: z.boolean().default(false), tier: z.enum(['free', 'all-star', 'goat']).default('free'), dailyLimit: z.number().int().min(0).max(10000).default(0), monthlyCredits: z.number().int().min(0).default(0), reserve: z.number().int().min(0).default(0), minIntervalSeconds: z.number().int().min(1).default(60) }).strict();
export const configSchema = z.object({
  recommendationExposure:exposureConfigSchema.prefault({}),
  multiBookmaker:multiConfigSchema.prefault({}),
  database: z.string().default('.local/signals.sqlite'), networkEnabled: z.boolean().default(false), deliveryEnabled: z.boolean().default(false),
  operatingMode:z.enum(['disabled','research','shadow','qualified']).default('disabled'),
  liveSuggestionsEnabled:z.boolean().default(false),
  suggestionsGrantFile:z.string().nullable().default(null),
  research:z.object({maxRequestsPerCycle:z.number().int().min(1).max(2).default(1),maxCandidatesPerFixture:z.number().int().min(1).max(100).default(30),historicalBackfill:z.boolean().default(true),fixtureHours:z.number().min(1).max(24).default(6),rosterHours:z.number().min(1).max(48).default(24),injuryHours:z.number().min(1).max(12).default(4)}).prefault({}),
  telegram:z.object({allowlist:z.array(z.string().regex(/^[1-9]\d*$/)).default([]),statusEnabled:z.boolean().default(false),qualifiedEnabled:z.boolean().default(false),digestHour:z.number().int().min(0).max(23).default(9)}).prefault({}),
  bookmaker: z.literal('sportsbet').default('sportsbet'), leagues: z.array(leagueSchema).default(['NBA', 'NBL']),
  providers: z.object({ balldontlie: provider.default(() => provider.parse({})), odds: provider.default(() => provider.parse({})) }).default(() => ({ balldontlie: provider.parse({}), odds: provider.parse({}) })),
  bluebubbles: z.object({ url: z.url().default('http://127.0.0.1:1234'), recipient: z.string().default(''), chatGuid: z.string().default(''), allowlist: z.array(z.string()).default([]), verifiedAt: stamp.nullable().default(null) }).default(() => ({ url: 'http://127.0.0.1:1234', recipient: '', chatGuid: '', allowlist: [], verifiedAt: null })),
  screen: z.object({ minGames: z.number().int().min(20).default(30), minEV: z.number().min(0).default(.06), minRobustEV: z.number().min(0).default(.01), maxProbabilityGap: z.number().min(0).max(.25).default(.12), maxQuoteAgeSeconds: z.number().int().min(10).max(300).default(180), maxEvidenceAgeSeconds: z.number().int().min(10).max(3600).default(1800), minMinutes: z.number().min(1).default(12), maxMinutesSD: z.number().min(0).max(10).default(6) }).default(() => ({ minGames: 30, minEV: .06, minRobustEV: .01, maxProbabilityGap: .12, maxQuoteAgeSeconds: 180, maxEvidenceAgeSeconds: 1800, minMinutes: 12, maxMinutesSD: 6 })),
  scan: z.object({ windowsMinutes: z.array(z.number().int().min(3).max(1440)).default([360, 120, 30, 10]), minBeforeStartSeconds: z.number().int().min(60).default(120), maxQuotesPerCycle: z.number().int().min(1).max(1000).default(300) }).default(() => ({ windowsMinutes: [360, 120, 30, 10], minBeforeStartSeconds: 120, maxQuotesPerCycle: 300 })),
  mappingFile: z.string().default('.local/mappings.json'), evidenceFile: z.string().default('.local/evidence.json'), validationFile: z.string().default('.local/validation.json'),
}).strict();
export type Config = z.infer<typeof configSchema>;
export function loadConfig(path = process.env.EDGELAB_CONFIG || 'config/local.json'): Config {
  if (!existsSync(/* turbopackIgnore: true */ path)) return configSchema.parse({});
  // Private config contains the destination and enables paid network access; require owner-only permissions.
  if ((statSync(/* turbopackIgnore: true */ path).mode & 0o077) !== 0) throw new Error('Private configuration must have mode 0600');
  return configSchema.parse(JSON.parse(readFileSync(/* turbopackIgnore: true */ path, 'utf8')));
}
