import { hash, ms } from '../core/domain';
import { validateRows, unknownMetadata } from '../research/dataset';
import { knownAt, type RetainedRow } from './data';
export function validateRetainedSnapshot(snapshot: { at: string; originHash: string; rows: RetainedRow[] }) {
  if (hash(snapshot.rows.map(r => r.ref)) !== snapshot.originHash) throw Error('DATASET_ORIGIN_CHANGED');
  validateRows(snapshot.rows, snapshot.at);
  for (const r of snapshot.rows) if (hash(r.log) !== r.ref.bodyHash || r.ref.id !== hash([r.log.event.id, r.log.playerId, r.log.source.hash]) || hash(r.metadata) !== hash(r.log.research ?? unknownMetadata()) || knownAt(r.log) > ms(snapshot.at)) throw Error('SNAPSHOT_BODY_OR_METADATA_CHANGED');
  return snapshot;
}
