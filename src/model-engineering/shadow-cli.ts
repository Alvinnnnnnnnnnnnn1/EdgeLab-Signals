import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { EfficientStore } from '../research/reliability/store';
import { cachedShadowCycle } from './shadow';
import { engineeringCodeHash, engineeringRuntimeHash } from './code';
import type { M1Artifact } from './m1';
import { ms } from '../core/domain';
import { verifyServicePins } from './runtime';
import { assertFingerprints } from '../production/deployment';

const identity = z.object({ pid: z.number().int().positive(), identity: z.string().min(1) }).strict();
const planSchema = z.object({ enabled: z.boolean(), sourcePath: z.string(), artifactPath: z.string(), protectionPath: z.string(), reviewedProtectionHash: z.string().regex(/^[a-f0-9]{64}$/), pinnedSourceHash: z.string(), pinnedRuntimeHash: z.string(), protectedFingerprints: z.record(z.string(), z.string()), services: z.object({ research: identity, markets: identity, comparison: identity }).strict(), journalPath: z.string(), budgetMs: z.number().min(100).max(2000), maxRecords: z.number().int().min(1).max(4), effectiveAt: z.string(), expiresAt: z.string(), scope: z.literal('CACHED_RESEARCH_SHADOW_ONLY') }).strict();
globalThis.fetch = async () => { throw Error('SHADOW_NETWORK_FORBIDDEN'); };
const path = process.argv[2]; if (!path) throw Error('Usage: shadow-cli PRIVATE_REVIEWED_PLAN');
const plan = planSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
if (!plan.enabled) console.log(JSON.stringify({ state: 'DISABLED', networkRequests: 0, messages: 0 }));
else {
  const at = new Date().toISOString();
  if (ms(at) < ms(plan.effectiveAt) || ms(at) >= ms(plan.expiresAt) || plan.pinnedRuntimeHash !== engineeringRuntimeHash() || plan.pinnedSourceHash !== engineeringCodeHash()) throw Error('INACTIVE_OR_CHANGED_RESEARCH_RELEASE');
  verifyServicePins(plan.services); assertFingerprints(plan.protectedFingerprints);
  const model = JSON.parse(readFileSync(plan.artifactPath, 'utf8')) as M1Artifact, protection = JSON.parse(readFileSync(plan.protectionPath, 'utf8')), source = new EfficientStore(plan.sourcePath, true);
  try { console.log(JSON.stringify(cachedShadowCycle(source, { ...plan, model, protection }, engineeringCodeHash()), null, 2)); } finally { source.close(); }
}
