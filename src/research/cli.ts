import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadConfig } from '../core/config';
import { nowISO, props, hash,ms } from '../core/domain';
import { Store } from '../core/store';
import { auditDataset, createDataset, loadDataset, saveDataset, unknownMetadata } from './dataset';
import { readBDLExport } from './import';
import { certificate, monitor } from './monitoring';
import { runExperiment, type Experiment } from './experiment';
import { artifactSchema } from './inference';
import { collectionPlan,collectBatch,type CollectionWindow } from './collection';
import { coverageReport } from './coverage';
import { recordProspective,scoreProspective } from './prospective';
import { loadEvidence } from '../providers/import';
import { oddsCoveragePlan,testOddsCoverage } from './odds-coverage';
const [command = 'audit', ...args] = process.argv.slice(2);
function save(path: string, value: unknown) { mkdirSync('.local/research-runs', { recursive: true, mode: 0o700 }); writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); return path; }
async function main() {
  const config = loadConfig(), store = new Store(config.database), at = nowISO();
  try {
    const rows = store.logs().filter(l => !l.source.simulated).map(log => ({ log, metadata: log.research ?? unknownMetadata() }));
    if(command==='prospective-score'){
      const result=scoreProspective(store,at);console.log(JSON.stringify({...result,path:save(`.local/research-runs/prospective-score-${at.replaceAll(':','-')}.json`,result)},null,2));
    }else if(command==='odds-plan')console.log(JSON.stringify(oddsCoveragePlan(),null,2));
    else if(command==='odds-coverage'){
      if(args.length!==2||args[1]!=='--execute')throw new Error('Use odds-plan first; then odds-coverage PRIVATE_SHARED_GRANT --execute');
      const result=await testOddsCoverage(store,config,args[0],{progress:v=>console.error(JSON.stringify(v))});
      console.log(JSON.stringify({...result,path:save(`.local/research-runs/odds-coverage-${at.replaceAll(':','-')}.json`,result)},null,2));
    }else if(command==='prospective'){
      if(!args[0])throw new Error('Provide a frozen genuine benchmark report array');
      const reports=JSON.parse(readFileSync(args[0],'utf8')) as Experiment[],evidence=loadEvidence(config.evidenceFile,store,at);
      const artifacts=reports.flatMap(r=>{
        if(r.league!=='NBA'||r.state!=='evaluated')return[];
        const artifact=artifactSchema.parse(r.artifact);
        if(r.genuine!==true||r.datasetId!==artifact.datasetId||hash(artifact)!==r.artifactHash)throw new Error('Genuine frozen report/artifact identity mismatch');
        return[{prop:r.prop,artifact,artifactHash:r.artifactHash}];
      });
      if(!artifacts.length)throw new Error('No frozen NBA model artifacts');
      // The original genuine training snapshot must still pass source integrity;
      // a self-labelled artifact is not sufficient provenance for forward research.
      for(const id of new Set(artifacts.map(a=>a.artifact.datasetId))){const d=loadDataset(`.local/datasets/${id}.json`);if(d.id!==id||ms(d.createdAt)>Math.min(...artifacts.filter(a=>a.artifact.datasetId===id).map(a=>ms(a.artifact.generatedAt))))throw new Error('Prospective training snapshot identity or clock mismatch');}
      const result=recordProspective(store,artifacts,evidence.registry.events.map(e=>({event:e.event,source:e.source})),evidence.contexts,at);
      console.log(JSON.stringify({...result,path:save(`.local/research-runs/prospective-${at.replaceAll(':','-')}.json`,result)},null,2));
    }else if(command==='coverage'){
      const result=coverageReport(store,at),path=save(`.local/research-runs/coverage-${at.replaceAll(':','-')}.json`,result);
      console.log(JSON.stringify({path,summary:result.summary,bySeason:result.bySeason,players:result.byPlayer.length,fixtures:result.byFixture.length,discoveredFixtures:result.discoveredFixtures,finalFixturesWithoutLogs:result.finalFixturesWithoutLogs.length,missingExactReceipts:result.missingExactReceipts.length,quarantinePages:result.quarantinePages},null,2));
    }else if(command==='collection-plan'){
      const result=collectionPlan(store,config,at),path=save(`.local/research-runs/collection-plan-${at.replaceAll(':','-')}.json`,result);
      console.log(JSON.stringify({...result,path},null,2));
    }else if(command==='collect'||command==='collect-plan'){
      const planned=collectionPlan(store,config,at);
      let windows:CollectionWindow[],cap:number,execute:boolean;
      if(command==='collect-plan'){
        cap=Number(args[0]);execute=args[1]==='--execute';
        if(args.length>2||args[1]!==undefined&&!execute)throw new Error('Use collect-plan MAX_REQUESTS [--execute]');
        // Prioritize the latest current-season window for prospective readiness.
        const current=planned.seasons.at(-1)!;
        windows=[...current.windows.slice().reverse(),...planned.seasons.slice(0,-1).flatMap(s=>s.windows)].map(({season,from,to})=>({season,from,to}));
        windows=windows.filter(w=>store.get<{complete:boolean}>(`ingest:league:${w.season}:${w.from}:${w.to}`)?.complete!==true||w.to===at.slice(0,10));
      }else{
        if(args.length<4||args.length>5||args[4]!==undefined&&args[4]!=='--execute')throw new Error('Use collect SEASON FROM TO MAX_REQUESTS [--execute]');
        windows=[{season:Number(args[0]),from:args[1],to:args[2]}];cap=Number(args[3]);execute=args[4]==='--execute';
      }
      if(!Number.isInteger(cap)||cap<1||cap>25)throw new Error('Maximum requests must be 1–25');
      if(!execute){console.log(JSON.stringify({mode:'dry_run_no_network',windows,maximumRequests:cap,quota:planned.quota,configChanged:false},null,2));return;}
      if(!windows.length){console.log(JSON.stringify({complete:true,requestsUsed:0}));return;}
      const result=await collectBatch(store,config,windows,cap,{checkConfig:loadConfig,progress:v=>console.error(JSON.stringify(v))});
      const path=save(`.local/research-runs/collection-${at.replaceAll(':','-')}.json`,result);console.log(JSON.stringify({...result,path},null,2));
    }else if (command === 'audit') {
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
      if(args.length>4||args[2]!==undefined&&args[2]!=='--target-season'||args[2]!==undefined&&!/^\d{4}$/.test(args[3]??''))throw new Error('Optional benchmark cohort: --target-season YYYY');
      const targetSeasons=args[2]?[args[3]]:undefined;
      const dataset = loadDataset(args[0]), reports:Experiment[]=[];
      for(const league of ['NBA','NBL'] as const)for(const prop of props){
        console.error(JSON.stringify({phase:'benchmark_start',league,prop,at:nowISO()}));
        const started=performance.now(),report=runExperiment(dataset,league,prop,at,mode,targetSeasons);reports.push(report);
        console.error(JSON.stringify({phase:'benchmark_complete',league,prop,state:report.state,elapsedSeconds:(performance.now()-started)/1000}));
      }
      const path = save(`.local/research-runs/${dataset.id}-${at.replaceAll(':', '-')}.json`, reports);
      console.log(JSON.stringify({ path, dataset: dataset.id, reports: reports.map(r => ({ league: r.league, prop: r.prop, state: r.state, selected: r.selected, promotion: r.promotion })) }, null, 2));
    } else if (command === 'certify') {
      if (!args[0]) throw new Error('Provide a frozen genuine benchmark report array');
      const reports = JSON.parse(readFileSync(args[0], 'utf8')) as Experiment[];
      const documents = reports.flatMap(report => { const validation = certificate(report, store, at); return validation ? [{ report, validation }] : []; });
      const path = save(`.local/research-runs/certificates-${at.replaceAll(':', '-')}.json`, documents);
      console.log(JSON.stringify({ path, entries: documents.map(d => ({ league: d.validation.league, prop: d.validation.prop, eligible: d.validation.eligible, artifactHash: d.validation.artifactHash })), note: 'An ineligible certificate may record diagnostics prospectively; it cannot issue a live signal. Configuration is unchanged.' }, null, 2));
    } else throw new Error('Use audit, coverage, collection-plan, collect-plan MAX_REQUESTS [--execute], collect SEASON FROM TO MAX_REQUESTS [--execute], odds-plan, odds-coverage PRIVATE_GRANT --execute, prospective FROZEN_REPORTS, import-bdl <file>, snapshot <licence>, benchmark <dataset> [as-of|retrospective], certify <reports>.');
  } finally { store.close(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Research failed'); process.exitCode = 1; });
