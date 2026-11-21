import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadConfig } from '../core/config';
import { nowISO, props, hash,ms } from '../core/domain';
import { Store } from '../core/store';
import { auditDataset, createDataset, loadDataset, saveDataset, unknownMetadata } from './dataset';
import { readBDLExport } from './import';
import { certificate, monitor } from './monitoring';
import { runExperiment, type Experiment } from './experiment';
import { artifactSchema } from './inference';
import { collectionPlan,collectBatch,pendingCollectionWindows,type CollectionWindow } from './collection';
import { coverageReport } from './coverage';
import { recordProspective,scoreProspective } from './prospective';
import { loadEvidence } from '../providers/import';
import { oddsCoveragePlan,testOddsCoverage } from './odds-coverage';
import { researchRows,metadataDiff } from './metadata';
import { benchmarkRun } from './benchmark-run';
import { livePlan,liveStatus,liveOnce,liveWorker } from './live';
import { registerResearchModels } from './shadow';
import { configureMode,prepareLaunchAgent } from './operations';
import { evaluateMinutes } from './minutes';
const [command = 'audit', ...args] = process.argv.slice(2);
function save(path: string, value: unknown) { mkdirSync('.local/research-runs', { recursive: true, mode: 0o700 }); writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); return path; }
async function main() {
  if(command==='help'){console.log(`EdgeLab NBA research\n  live-plan | live-status\n  live-once --dry-run | --execute\n  activate research|shadow --confirm | deactivate --confirm\n  prepare-launchagent | worker\n  collection-plan | coverage\n  collect-plan MAX_REQUESTS [--execute]\n  collect SEASON FROM TO MAX_REQUESTS [--execute]\n  snapshot SOURCE_REFERENCE\n  benchmark DATASET as-of|retrospective [--target-season YYYY] [--prop points|rebounds|assists|threes] [--resume]\n  models-register FROZEN_REPORTS | minutes FROZEN_REPORTS\n  prospective FROZEN_REPORTS | prospective-score\n  odds-plan | odds-coverage PRIVATE_GRANT --execute\nNetwork is quota-gated. Research, SHADOW, status delivery and qualified alerts are separate.`);return;}
  const config = loadConfig(), store = new Store(config.database), at = nowISO();
  try {
    const rows = ['audit','snapshot'].includes(command)?researchRows(store):[];
    if(command==='minutes'){
      if(args.length!==1)throw new Error('Use minutes FROZEN_BENCHMARK_REPORTS');const reports=JSON.parse(readFileSync(args[0],'utf8')) as Experiment[],report=reports.find(r=>r.league==='NBA'&&r.prop==='points'&&r.state==='evaluated');if(!report)throw new Error('Evaluated NBA benchmark required');const artifact=artifactSchema.parse(report.artifact),dataset=loadDataset(`.local/datasets/${artifact.datasetId}.json`),result=evaluateMinutes(dataset,report);console.log(JSON.stringify({...result,path:save(`.local/research-runs/minutes-${at.replaceAll(':','-')}.json`,result)},null,2));
    }else if(command==='activate'){
      if(!['research','shadow'].includes(args[0])||args[1]!=='--confirm'||args.length!==2)throw new Error('Use activate research|shadow --confirm; qualified alerts cannot be activated here');console.log(JSON.stringify(configureMode(store,args[0] as 'research'|'shadow',true),null,2));
    }else if(command==='deactivate'){
      if(args.length!==1||args[0]!=='--confirm')throw new Error('Use deactivate --confirm');console.log(JSON.stringify(configureMode(store,'disabled',true),null,2));
    }else if(command==='prepare-launchagent')console.log(JSON.stringify(prepareLaunchAgent(),null,2));
    else if(command==='live-plan')console.log(JSON.stringify(livePlan(store,config,at),null,2));
    else if(command==='live-status')console.log(JSON.stringify(liveStatus(store,config,at),null,2));
    else if(command==='live-once'){
      if(args.length!==1||!['--dry-run','--execute'].includes(args[0]))throw new Error('Use live-once --dry-run or live-once --execute');
      console.log(JSON.stringify(await liveOnce(store,config,{dryRun:args[0]==='--dry-run',manual:true}),null,2));
    }else if(command==='worker'){
      const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());await liveWorker(store,loadConfig,controller.signal);
    }else if(command==='models-register'){
      if(args.length!==1)throw new Error('Use models-register FROZEN_REPORT_ARRAY');console.log(JSON.stringify(registerResearchModels(store,JSON.parse(readFileSync(args[0],'utf8')),at),null,2));
    }else if(command==='prospective-score'){
      const result={at,verifiedAvailability:scoreProspective(store,at),conditionalShadow:scoreProspective(store,at,'conditional-shadow')};console.log(JSON.stringify({...result,path:save(`.local/research-runs/prospective-score-${at.replaceAll(':','-')}.json`,result)},null,2));
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
      const result=recordProspective(store,artifacts,evidence.registry.events.map(e=>({event:e.event,source:e.source})),evidence.contexts,at,nowISO);
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
        windows=[...current.windows.slice().reverse(),...planned.seasons.slice(0,-1).slice().reverse().flatMap(s=>s.windows)].map(({season,from,to})=>({season,from,to}));
        windows=pendingCollectionWindows(store,windows,at);
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
      const dataset = createDataset(store, rows, [licence], at); console.log(JSON.stringify({ path: saveDataset(dataset), id: dataset.id, audit: auditDataset(dataset.rows),derivedMetadata:metadataDiff(rows) }, null, 2));
    } else if (command === 'benchmark') {
      if (!args[0]) throw new Error('Provide a genuine content-addressed dataset file; synthetic input is rejected.');
      const mode = args[1] ?? 'as-of'; if (mode !== 'as-of' && mode !== 'retrospective') throw new Error('Choose as-of or retrospective');
      let targetSeasons:string[]|undefined,prop:typeof props[number]|undefined,resume=false;
      for(let i=2;i<args.length;i++){if(args[i]==='--target-season'&&!targetSeasons&&/^\d{4}$/.test(args[i+1]??''))targetSeasons=[args[++i]];else if(args[i]==='--prop'&&!prop&&props.includes(args[i+1] as typeof props[number]))prop=args[++i] as typeof props[number];else if(args[i]==='--resume'&&!resume)resume=true;else throw new Error('Use --target-season YYYY, --prop points|rebounds|assists|threes, --resume');}
      const result=benchmarkRun(store,loadDataset(args[0]),{mode,targetSeasons,prop,resume,progress:v=>console.error(JSON.stringify(v))});
      console.log(JSON.stringify(result,null,2));if(result.state==='failed')process.exitCode=1;
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
