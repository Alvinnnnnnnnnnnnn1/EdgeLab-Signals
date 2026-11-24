import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { hash } from '../core/domain';
import { validateRows } from '../research/dataset';
import { type RetainedRow, latestRows } from './data';
import { chronologicalProtocol, runChronological } from './experiment';

export const engineeringFiles = ['src/model-engineering/m1.ts', 'src/model-engineering/data.ts', 'src/model-engineering/experiment.ts', 'src/model-engineering/calibration.ts', 'src/model-engineering/freshness.ts', 'src/research/features.ts', 'src/research/models.ts', 'src/research/boost.ts', 'src/research/distributions.ts', 'src/research/scoring.ts', 'src/core/domain.ts', 'src/core/models.ts'];
export function engineeringCodeHash() { return hash(Object.fromEntries(engineeringFiles.map(p => [p, hash(readFileSync(p, 'utf8'))]))); }
globalThis.fetch = async () => { throw Error('MODEL_ENGINEERING_OFFLINE_ONLY'); };
const [command, input, destination, protocolFile] = process.argv.slice(2);
if (!input || !destination || !['protocol', 'evaluate'].includes(command)) throw Error('Usage: model-engineering protocol SNAPSHOT OUT | evaluate SNAPSHOT OUT PROTOCOL');
const file = readFileSync(input, 'utf8'), snapshot = JSON.parse(file) as { at: string; originHash: string; rows: RetainedRow[] };
if (hash(snapshot.rows.map(r => r.ref)) !== snapshot.originHash) throw Error('DATASET_ORIGIN_CHANGED');
validateRows(snapshot.rows, snapshot.at);
if (command === 'protocol') {
  const dates = latestRows(snapshot.rows, '9999-12-31T23:59:59.000Z', 'retrospective').filter(r => r.log.event.league === 'NBA' && r.log.participated === true).map(r => r.log.event.startsAt.slice(0, 10));
  const protocol = chronologicalProtocol(dates), body = { registeredAt: new Date().toISOString(), inputHash: hash(file), sourceHash: engineeringCodeHash(), protocol, status: 'PREDECLARED_BEFORE_NEW_SCORES' };
  writeFileSync(destination, JSON.stringify({ ...body, id: hash(body) }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ path: destination, ...body }));
} else {
  if (!protocolFile) throw Error('PREDECLARED_PROTOCOL_REQUIRED');
  const { id, ...registered } = JSON.parse(readFileSync(protocolFile, 'utf8'));
  if (hash(registered) !== id || registered.inputHash !== hash(file) || registered.sourceHash !== engineeringCodeHash()) throw Error('PROTOCOL_OR_CODE_CHANGED');
  const out = resolve(destination);
  if (!out.includes('/.local/') || existsSync(out)) throw Error('NEW_PRIVATE_RESULT_DIRECTORY_REQUIRED');
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const result = runChronological(snapshot.rows, snapshot.at, engineeringCodeHash(), registered.protocol), { predictions, ...report } = result;
  writeFileSync(join(out, 'predictions.json.gz'), gzipSync(JSON.stringify(predictions)), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, protocolRegistration: id, predictionFileHash: hash(readFileSync(join(out, 'predictions.json.gz'))) }, null, 2), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(out, 'artifact.json'), JSON.stringify(result.artifact), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ path: out, artifact: result.artifact.id, report: result.report, failures: result.failures.length, resources: result.resources }));
}
