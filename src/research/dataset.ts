import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gameLogSchema, hash, ms, stamp, type GameLog, type League, researchMetadataSchema } from '../core/domain';
import { Store } from '../core/store';
export const DATASET_VERSION = 'player-games/1.1.0';
export const metadataSchema = researchMetadataSchema;
export type Metadata = z.infer<typeof metadataSchema>;
export const unknownMetadata = (): Metadata => ({ phase: 'unknown', overtimePeriods: null, threeAttempts: null, rosterOpportunityVerified: false });
export interface ResearchRow { log: GameLog; metadata: Metadata; }
export const datasetSchema = z.object({
  version: z.literal(DATASET_VERSION), id: z.string().regex(/^[a-f0-9]{64}$/), createdAt: stamp,
  licenseReferences: z.array(z.string().min(8)),
  rows: z.array(z.object({ log: gameLogSchema, metadata: metadataSchema }).strict()),
  sourceReceipts: z.array(z.object({ receipt: z.unknown(), body: z.string() })),
}).strict();
export type Dataset = z.infer<typeof datasetSchema>;
export const utcDay = (at: string) => new Date(ms(at)).toISOString().slice(0, 10);
export const rowKey = (r: ResearchRow) => `${r.log.event.league}:${r.log.event.id}:${r.log.playerId}`;
function identity(r: ResearchRow) { return hash([r.log.event, r.log.playerId, r.log.teamId, r.log.player]); }
export function validateRows(rows: ResearchRow[], at: string, genuine = true): ResearchRow[] {
  const seen = new Map<string, ResearchRow>(), identities=new Map<string,string>();
  for (const input of rows) {
    const r = { log: gameLogSchema.parse(input.log), metadata: metadataSchema.parse(input.metadata) }, l = r.log;
    if (genuine && (l.source.simulated || /^(synthetic|demo|test)[:/-]/i.test(l.playerId) || (l.supportingSources ?? []).some(s => s.simulated))) throw new Error('Synthetic records cannot enter genuine modelling datasets');
    if (!l.final || ms(l.observedAt) > ms(at)) throw new Error('Only observed completed records belong in a modelling snapshot');
    if (r.metadata.threeAttempts !== null && l.stats.threes !== null && l.stats.threes > r.metadata.threeAttempts) throw new Error('Made threes exceed attempts');
    if (l.participated === false && (l.minutes !== 0 && l.minutes !== null || Object.values(l.stats).some(v => v !== null && v !== 0))) throw new Error('DNP conflicts with production/minutes');
    if (l.participated === true && l.minutes === 0) throw new Error('Participation requires positive known minutes');
    if (r.metadata.overtimePeriods !== null && l.minutes !== null && l.minutes > (l.event.league === 'NBA' ? 48 : 40) + 5 * r.metadata.overtimePeriods) throw new Error('Minutes exceed verified game duration');
    const key = rowKey(r) + ':' + l.observedAt;
    const previous = seen.get(key);
    if (previous && hash(previous) !== hash(r)) throw new Error('Conflicting player-game revision at the same observation timestamp');
    if(identities.has(rowKey(r))&&identities.get(rowKey(r))!==identity(r))throw new Error('Player-game identity changed across revisions');
    identities.set(rowKey(r),identity(r));
    seen.set(key, r);
  }
  return [...seen.values()].sort((a, b) => ms(a.log.event.startsAt) - ms(b.log.event.startsAt) || rowKey(a).localeCompare(rowKey(b)) || ms(a.log.observedAt) - ms(b.log.observedAt));
}
const content = (d: Omit<Dataset, 'id'>) => ({ version: d.version, createdAt: d.createdAt, licenseReferences: [...d.licenseReferences].sort(), rows: d.rows, sourceReceipts: d.sourceReceipts });
export function createDataset(store: Store, rows: ResearchRow[], licenses: string[], at: string): Dataset {
  if (!licenses.length) throw new Error('Documented permitted source/licence reference required');
  const validated = validateRows(rows, at), receipts = new Map<string, { receipt: unknown; body: string }>();
  for (const r of validated) for (const source of [r.log.source, ...(r.log.supportingSources ?? [])]) {
    if (!store.hasReceipt(source)) throw new Error('Exact retained source receipt missing');
    const raw = store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(source.hash) as { body: string };
    receipts.set(hash(source), { receipt: source, body: raw.body });
  }
  const base = { version: DATASET_VERSION as typeof DATASET_VERSION, createdAt: at, licenseReferences: [...licenses].sort(), rows: validated, sourceReceipts: [...receipts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r) };
  return datasetSchema.parse({ ...base, id: hash(content(base)) });
}
export function saveDataset(dataset: Dataset, directory = '.local/datasets') {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${dataset.id}.json`), text = JSON.stringify(dataset, null, 2);
  if (existsSync(path)) { if (readFileSync(path, 'utf8') !== text) throw new Error('Immutable dataset collision'); return path; }
  writeFileSync(path, text, { mode: 0o600, flag: 'wx' }); return path;
}
export function loadDataset(path: string): Dataset {
  const d = datasetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (hash(content(d)) !== d.id) throw new Error('Dataset version/hash mismatch');
  validateRows(d.rows, d.createdAt);
  const receipts = new Map(d.sourceReceipts.map(s => [hash(s.receipt), s]));
  for (const r of d.rows) for (const source of [r.log.source, ...(r.log.supportingSources ?? [])]) {
    const retained = receipts.get(hash(source));
    if (!retained || hash(retained.body) !== source.hash) throw new Error('Dataset source integrity mismatch');
  }
  return d;
}
export function auditDataset(rows: ResearchRow[]) {
  return (['NBA', 'NBL'] as League[]).map(league => {
    const revisions = rows.filter(r => r.log.event.league === league && !r.log.source.simulated), latest = new Map<string, ResearchRow>();
    for (const r of revisions.sort((a, b) => ms(a.log.observedAt) - ms(b.log.observedAt))) latest.set(rowKey(r), r);
    const data = [...latest.values()];
    return { league, playerGames: data.length, revisions: revisions.length, players: new Set(data.map(r => r.log.playerId)).size, fixtures: new Set(data.map(r => r.log.event.id)).size,
      teams: new Set(data.map(r => r.log.teamId)).size, dates: new Set(data.map(r => utcDay(r.log.event.startsAt))).size,
      missing: { minutes: data.filter(r => r.log.minutes === null).length, participation: data.filter(r => r.log.participated === null).length,
        phase: data.filter(r => r.metadata.phase === 'unknown').length, overtime: data.filter(r => r.metadata.overtimePeriods === null).length,
        threeAttempts: data.filter(r => r.metadata.threeAttempts === null).length,
        ...Object.fromEntries(['points', 'rebounds', 'assists', 'threes'].map(p => [p, data.filter(r => r.log.stats[p as keyof GameLog['stats']] === null).length])) },
      dnp: data.filter(r => r.log.participated === false).length, zeroProduction: data.filter(r => r.log.participated === true && r.log.stats.points === 0).length,
      seasons: [...new Set(data.map(r => r.log.event.season))].sort(), teamChanges: [...new Set(data.map(r => r.log.playerId))].filter(id => new Set(data.filter(r => r.log.playerId === id).map(r => r.log.teamId)).size > 1).length };
  });
}
