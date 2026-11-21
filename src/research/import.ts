import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { receiptSchema, assertReceipt, stamp, hash, type GameLog,ms } from '../core/domain';
import { normalizeBDLStats } from '../providers/balldontlie';
import { Store } from '../core/store';
import { createDataset, saveDataset, unknownMetadata, auditDataset } from './dataset';
const captured = z.object({ receipt: receiptSchema, body: z.string() }).strict();
export const rawBDLExportSchema = z.object({
  format: z.literal('bdl-captured-pages/1'), licenseReference: z.string().min(8),
  permittedUse: z.literal('private-player-prop-research'), capturedAt: stamp,
  games: z.array(captured).min(1), stats: z.array(captured).min(1),
}).strict();
export function importBDLExport(raw: unknown, store: Store, at: string) {
  const input = rawBDLExportSchema.parse(raw);
  if(ms(input.capturedAt)>ms(at)||[...input.games,...input.stats].some(e=>ms(e.receipt.retrievedAt)>ms(input.capturedAt)))throw new Error('Invalid export capture chronology');
  const fixtures: { body: unknown; receipt: z.infer<typeof receiptSchema> }[] = [], logs: GameLog[] = [], exclusions: string[] = [];
  for (const entry of [...input.games, ...input.stats]) {
    assertReceipt(entry.receipt, at);
    const url = new URL(entry.receipt.endpoint);
    if (entry.receipt.provider !== 'balldontlie' || url.origin !== 'https://api.balldontlie.io' || url.username || url.password || [...url.searchParams.keys()].some(k=>/^(apikey|key|token|password)$/i.test(k))) throw new Error('Expected a credential-free original BDL receipt');
    if (hash(entry.body) !== entry.receipt.hash) throw new Error('Original raw-page hash mismatch');
    store.receipt(entry.receipt, entry.body);
  }
  for (const entry of input.games) {
    if (!/^\/(nba\/)?v1\/games$/.test(new URL(entry.receipt.endpoint).pathname)) throw new Error('Wrong captured game endpoint');
    const page = z.object({ data: z.array(z.unknown()), meta: z.object({ next_cursor: z.number().nullable().optional() }) }).parse(JSON.parse(entry.body));
    for (const game of page.data) fixtures.push({ body: game, receipt: entry.receipt });
  }
  for (const entry of input.stats) {
    if (!/^\/(nba\/)?v1\/stats$/.test(new URL(entry.receipt.endpoint).pathname)) throw new Error('Wrong captured stat endpoint');
    const normalized = normalizeBDLStats(JSON.parse(entry.body), entry.receipt, fixtures); logs.push(...normalized.logs); exclusions.push(...normalized.exclusions);
  }
  if (!logs.length) throw new Error('No genuine player-game rows passed exact raw fixture/stat joins');
  const dataset = createDataset(store, logs.map(log => ({ log, metadata: log.research ?? unknownMetadata() })), [input.licenseReference], at);
  const inserted=store.ingest(logs,at);
  return { inserted, dataset, exclusions, audit: auditDataset(dataset.rows) };
}
export function readBDLExport(path: string, store: Store, at: string) { const result = importBDLExport(JSON.parse(readFileSync(path, 'utf8')), store, at); return { ...result, path: saveDataset(result.dataset) }; }
