import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadConfig } from '../core/config';
import { nowISO, props, hash } from '../core/domain';
import { Store } from '../core/store';
import { auditDataset, createDataset, loadDataset, saveDataset, unknownMetadata } from './dataset';
import { readBDLExport } from './import';
import { certificate, monitor } from './monitoring';
import { runExperiment, type Experiment } from './experiment';
import { type ResearchArtifact } from './inference';
const [command = 'audit', ...args] = process.argv.slice(2);
function save(path: string, value: unknown) { mkdirSync('.local/research-runs', { recursive: true, mode: 0o700 }); writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); return path; }
async function main() {
  const config = loadConfig(), store = new Store(config.database), at = nowISO();
  try {
    const rows = store.logs().filter(l => !l.source.simulated).map(log => ({ log, metadata: log.research ?? unknownMetadata() }));
    if (command === 'audit') {
      const result = { at, genuine: auditDataset(rows), independentCredentialsConfigured: { stats: !!process.env.BALLDONTLIE_API_KEY, odds: !!process.env.ODDS_API_KEY }, networkEnabled: config.networkEnabled, deliveryEnabled: config.deliveryEnabled,
        modelsTrainedByThisAudit: 0, evaluation: rows.length ? 'Create a permitted versioned snapshot and run benchmark; no model promoted by audit.' : 'BLOCKED_NO_GENUINE_DATA', noSyntheticFallback: true };
      const path = save(`.local/research-runs/audit-${at.replaceAll(':', '-')}.json`, result); console.log(JSON.stringify({ ...result, path }, null, 2));
    } else if (command === 'import-bdl') {
      if (!args[0]) throw new Error('A captured-page export path is required. No request, purchase or trial is made.');
      const result = readBDLExport(args[0], store, at); console.log(JSON.stringify({ path: result.path, id: result.dataset.id, inserted: result.inserted, exclusions: result.exclusions, audit: result.audit }, null, 2));
    } else if (command === 'snapshot') {
      const licence = args.join(' '); if (licence.length < 8) throw new Error('Supply the permitted source/contract reference; do not invent a licence.');
      const dataset = createDataset(store, rows, [licence], at); console.log(JSON.stringify({ path: saveDataset(dataset), id: dataset.id, audit: auditDataset(dataset.rows) }, null, 2));
    } else if (command === 'benchmark') {
      if (!args[0]) throw new Error('Provide a genuine content-addressed dataset file; synthetic input is rejected.');
      const mode = args[1] ?? 'as-of'; if (mode !== 'as-of' && mode !== 'retrospective') throw new Error('Choose as-of or retrospective');
      const dataset = loadDataset(args[0]), reports = (['NBA', 'NBL'] as const).flatMap(league => props.map(prop => runExperiment(dataset, league, prop, at, mode)));
      const path = save(`.local/research-runs/${dataset.id}-${at.replaceAll(':', '-')}.json`, reports);
      console.log(JSON.stringify({ path, dataset: dataset.id, reports: reports.map(r => ({ league: r.league, prop: r.prop, state: r.state, selected: r.selected, promotion: r.promotion })) }, null, 2));
    } else if (command === 'certify') {
      if (!args[0]) throw new Error('Provide a frozen genuine benchmark report array');
      const reports = JSON.parse(readFileSync(args[0], 'utf8')) as Experiment[];
      const documents = reports.flatMap(report => { const validation = certificate(report, store, at); return validation ? [{ report, validation }] : []; });
      const path = save(`.local/research-runs/certificates-${at.replaceAll(':', '-')}.json`, documents);
      console.log(JSON.stringify({ path, entries: documents.map(d => ({ league: d.validation.league, prop: d.validation.prop, eligible: d.validation.eligible, artifactHash: d.validation.artifactHash })), note: 'An ineligible certificate may record diagnostics prospectively; it cannot issue a live signal. Configuration is unchanged.' }, null, 2));
    } else throw new Error('Use audit, import-bdl <file>, snapshot <licence>, benchmark <dataset> [as-of|retrospective], certify <reports>.');
  } finally { store.close(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Research failed'); process.exitCode = 1; });
