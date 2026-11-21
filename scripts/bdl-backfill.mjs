/**
 * EdgeLab Signals — bounded historical BDL ingestion.
 * DRY RUN by default. This wrapper delegates each explicitly approved page to
 * the existing BDLProvider / JsonHTTP / SQLite quota journal via `src/cli.ts`.
 * It neither changes source configuration nor enables notifications.
 * Node 24 required by EdgeLab Signals.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

function fail(message) { throw new Error(message); }
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Use YYYY-MM-DD dates');
  const d = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail('Invalid calendar date');
  return d.getTime();
}
function parseArgs(argv) {
  if (argv.length < 3) fail('Usage: node scripts/bdl-backfill.mjs NATIVE_ID[,ID...] FROM_DATE TO_DATE [--max-pages N] [--execute]');
  const [idText, from, to, ...options] = argv;
  if (!/^\d+(,\d+)*$/.test(idText)) fail('Supply native positive numeric BDL player IDs, comma-separated');
  const ids = [...new Set(idText.split(','))];
  if (ids.some(s => !/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s))) || ids.length > 20) fail('Require 1–20 positive safe-integer player IDs');
  const f = day(from), t = day(to), days = Math.round((t - f) / 86400000) + 1;
  if (days < 1 || days > 31) fail('Backfill one historical window of 1–31 days at a time');
  let maxPages = 2, execute = false, pageCapSpecified = false;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === '--execute' && !execute) execute = true;
    else if (options[i] === '--max-pages' && !pageCapSpecified && i + 1 < options.length) {
      pageCapSpecified = true;
      const raw = options[++i];
      if (!/^[1-8]$/.test(raw)) fail('Maximum page count must be an integer from 1 to 8');
      maxPages = Number(raw);
    } else fail(`Unrecognised or duplicate argument: ${options[i]}`);
  }
  return { ids, from, to, days, maxPages, execute };
}
function readPrivateConfig(path) {
  if (!existsSync(path)) fail('Missing private configuration; prepare credentials and limits first');
  if ((statSync(path).mode & 0o077) !== 0) fail('Private config must be owner-only (chmod 600)');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (config.networkEnabled !== true || config.deliveryEnabled !== false) fail('Require network enabled but real notification delivery disabled for backfill');
  const p = config.providers?.balldontlie;
  if (p?.enabled !== true || !['all-star', 'goat'].includes(p?.tier) || !Number.isSafeInteger(p?.dailyLimit) || p.dailyLimit < 1 || !Number.isSafeInteger(p?.minIntervalSeconds) || p.minIntervalSeconds < 1) {
    fail('Independent permitted BDL ALL-STAR/GOAT access and a finite positive daily limit/minimum interval must be configured');
  }
  return config;
}

/**
 * Optional process/clock functions are a local test seam, not CLI flags.
 * @param {string[]} argv
 * @param {{spawn?: (command:string,args:string[],options:any)=>{error?:unknown,status:number|null,stdout:string}, wait?:(milliseconds:number)=>Promise<void>, now?:()=>Date}} runtime
 */
export async function main(argv = process.argv.slice(2), runtime = {}) {
  const plan = parseArgs(argv);
  const preview = { mode: plan.execute ? 'explicit_bounded_execution' : 'dry_run_no_network',
    provider: 'balldontlie', endpointFamilies: ['/nba/v1/games', '/nba/v1/stats'],
    playerIds: plan.ids, from: plan.from, to: plan.to, maximumProviderPages: plan.maxPages,
    note: 'Each step reuses the existing provider allowance, request cooldown, original receipts and resumable checkpoints; page count is a ceiling, not a promised complete dataset.' };
  if (!plan.execute) { console.log(JSON.stringify(preview, null, 2)); return; }
  const clock = runtime.now ?? (() => new Date());
  if (plan.to > clock().toISOString().slice(0, 10)) fail('Cannot backfill future games');
  if (!existsSync('src/cli.ts') || !existsSync('package.json') || JSON.parse(readFileSync('package.json', 'utf8')).name !== 'edgelab-signals') fail('Run from the EdgeLab-Signals repository root');
  // Resolve the same private environment as normal Signals commands, only for
  // execution. Dry runs never read credentials or private configuration.
  if (existsSync('.env.local')) {
    if ((statSync('.env.local').mode & 0o077) !== 0) fail('Private environment must be owner-only (chmod 600)');
    loadEnvFile('.env.local');
  }
  const configPath = process.env.EDGELAB_CONFIG || 'config/local.json';
  const config = readPrivateConfig(configPath);
  if (plan.maxPages > config.providers.balldontlie.dailyLimit) fail('Page cap exceeds configured daily request limit');
  const childEnv = { ...process.env, EDGELAB_CONFIG: configPath };
  const runChild = runtime.spawn ?? spawnSync, wait = runtime.wait ?? sleep;
  // The existing BDLProvider enforces actual quota state per request; this cap
  // is an additional per-run safety bound, not a replacement for that ledger.
  const pages = [];
  for (let n = 0; n < plan.maxPages; n++) {
    if (n !== 0) await wait(Math.max(15000, (config.providers.balldontlie.minIntervalSeconds + 2) * 1000));
    if (JSON.stringify(readPrivateConfig(configPath)) !== JSON.stringify(config)) fail('Configuration changed during backfill; stop and review before resuming');
    const child = runChild(process.execPath, [
      '--import', 'tsx', 'src/cli.ts',
      'ingest', plan.ids.join(','), plan.from, plan.to,
    ], { env: childEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.error || child.status !== 0) fail(`BDL ingest step ${n + 1} failed; no automatic retry. Review the local provider/config/quota state (exit ${child.status ?? 'unknown'}).`);
    let result;
    try { result = JSON.parse(child.stdout.trim()); } catch { fail('Unexpected ingestion output; no automatic retry'); }
    if (!result || !Number.isSafeInteger(result.inserted) || result.inserted < 0 || typeof result.complete !== 'boolean'
      || result.exclusions !== undefined && !Array.isArray(result.exclusions)
      || result.stage !== undefined && result.stage !== 'fixture-page') fail('Unexpected ingestion result schema');
    pages.push({ page: n + 1, stage: result.stage ?? 'stats', inserted: result.inserted, excluded: result.exclusions?.length ?? 0, complete: result.complete });
    if (result.complete) break;
  }
  console.log(JSON.stringify({ ...preview, pages, inserted: pages.reduce((s, p) => s + p.inserted, 0), complete: pages.at(-1)?.complete ?? false,
    pageCapReached: pages.length === plan.maxPages && pages.at(-1)?.complete !== true,
    next: pages.at(-1)?.complete ? 'Review genuine completeness, then create a versioned snapshot and run retrospective evaluation.' : 'Run a further explicitly bounded invocation after checking quota/time; successful original pages remain checkpointed.' }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Backfill stopped safely. No automatic retry; check arguments, provider entitlement and quota.'); process.exitCode = 1; });
}

export { parseArgs };
