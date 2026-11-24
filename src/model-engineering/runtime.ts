import type { Store } from '../core/store';
import { deploymentSafety, serviceIdentity } from '../production/deployment';

export function shadowIdle(source: Store, at: string) {
  const result = deploymentSafety(source, at), blocks = [...result.blocks];
  if (source.db.prepare("SELECT name FROM leases WHERE name IN ('live-cycle','reliable-source-task','research-analytics') AND expires_at>? LIMIT 1").get(at)) blocks.push('SOURCE_OR_ANALYTICS_CHILD_OWNED');
  const runtime = source.get<{ sourceStartedAt?: string | null; analyticsStartedAt?: string | null }>('reliable:worker');
  if (runtime?.sourceStartedAt || runtime?.analyticsStartedAt) blocks.push('SOURCE_OR_ANALYTICS_CHILD_ACTIVE');
  if (source.db.prepare("SELECT key FROM meta WHERE key LIKE 'live:source-progress:%' AND value!='null' LIMIT 1").get()) blocks.push('SOURCE_COLLECTOR_PAGINATION_INCOMPLETE');
  return { ...result, safe: blocks.length === 0, blocks };
}
export function verifyServicePins(expected: Record<'research' | 'markets' | 'comparison', { pid: number; identity: string }>) {
  for (const name of ['research', 'markets', 'comparison'] as const) { const actual = serviceIdentity(name); if (actual.pid !== expected[name].pid || actual.identity !== expected[name].identity) throw Error('PINNED_SERVICE_IDENTITY_CHANGED:' + name); }
}
