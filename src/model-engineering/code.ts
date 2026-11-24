import { readFileSync } from 'node:fs';
import { hash } from '../core/domain';
export const engineeringFiles = ['src/model-engineering/m1.ts', 'src/model-engineering/data.ts', 'src/model-engineering/experiment.ts', 'src/model-engineering/calibration.ts', 'src/model-engineering/freshness.ts', 'src/research/features.ts', 'src/research/models.ts', 'src/research/boost.ts', 'src/research/distributions.ts', 'src/research/scoring.ts', 'src/core/domain.ts', 'src/core/models.ts'];
export function engineeringCodeHash() { return hash(Object.fromEntries(engineeringFiles.map(p => [p, hash(readFileSync(p, 'utf8'))]))); }
export function engineeringRuntimeHash() { return hash(Object.fromEntries([...engineeringFiles, 'src/model-engineering/code.ts', 'src/model-engineering/shadow.ts', 'src/model-engineering/shadow-cli.ts', 'src/model-engineering/journal.ts', 'src/model-engineering/evidence.ts', 'src/model-engineering/runtime.ts'].map(p => [p, hash(readFileSync(p, 'utf8'))]))); }
