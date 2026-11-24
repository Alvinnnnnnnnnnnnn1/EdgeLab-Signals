import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { summary } from '../research/distributions';
import { hash } from '../core/domain';

export async function fileDigest(path: string) {
  const digest = createHash('sha256'); for await (const chunk of createReadStream(path)) digest.update(chunk); return digest.digest('hex');
}
/** Stream byte hashes and gzip validation: JSON.stringify(Buffer) can exceed
 * V8's string/heap limit for genuine full-PMF archives. No rerun of scoring. */
export async function finalizeArchive(directory: string) {
  const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')), counts = new Map<string, number>();
  const input = createReadStream(join(directory, 'predictions.jsonl.gz')), gunzip = createGunzip();
  input.on('error', error => gunzip.destroy(error)); input.pipe(gunzip);
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity });
  let predictions = 0;
  for await (const line of lines) { const r = JSON.parse(line); summary(r.prediction.pmf); const key = `${r.prop}:${r.model}`; counts.set(key, (counts.get(key) ?? 0) + 1); predictions++; }
  for (const prop of report.report) for (const [model, m] of Object.entries(prop.models) as [string, { scores: { playerGames: number } | null }][]) if ((counts.get(`${prop.prop}:${model}`) ?? 0) !== (m.scores?.playerGames ?? 0)) throw Error('PREDICTION_ARCHIVE_INCOMPLETE');
  const artifactText = readFileSync(join(directory, 'artifact.json'), 'utf8'), { id, ...body } = JSON.parse(artifactText);
  if (hash(body) !== id || id !== report.artifact.id) throw Error('ARTIFACT_CHANGED');
  const evidence = { completedAt: new Date().toISOString(), protocolRegistration: report.protocolRegistration, predictionFileHash: await fileDigest(join(directory, 'predictions.jsonl.gz')), reportHash: await fileDigest(join(directory, 'report.json')), artifactHash: id, predictions, counts: Object.fromEntries(counts), gzipAndPMFIntegrity: true };
  writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600, flag: 'wx' }); return evidence;
}
