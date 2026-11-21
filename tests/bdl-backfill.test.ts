import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { main, parseArgs } from '../scripts/bdl-backfill.mjs';

const root = process.cwd();
const script = resolve(root, 'scripts/bdl-backfill.mjs');
const args = ['123,456', '2026-10-01', '2026-10-07'];
const now = () => new Date('2026-11-21T00:00:00.000Z');
const enabledConfig = () => ({
  networkEnabled: true, deliveryEnabled: false,
  providers: { balldontlie: { enabled: true, tier: 'all-star', dailyLimit: 8, minIntervalSeconds: 13 } },
});
function configFile(path = 'config/local.json', config = enabledConfig()) {
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
}
async function workspace(t: TestContext, body: (logs: string[]) => Promise<void>) {
  mkdirSync(join(root, '.local'), { recursive: true });
  const directory = mkdtempSync(join(root, '.local/backfill-test-'));
  const before = { ...process.env }, logs: string[] = [];
  t.mock.method(console, 'log', (value: unknown) => logs.push(String(value)));
  try {
    process.chdir(directory);
    delete process.env.EDGELAB_CONFIG;
    delete process.env.BALLDONTLIE_API_KEY;
    mkdirSync('config'); mkdirSync('src');
    writeFileSync('package.json', JSON.stringify({ name: 'edgelab-signals' }));
    writeFileSync('src/cli.ts', '// Test sentinel: never executed.');
    await body(logs);
  } finally {
    process.chdir(root);
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
    t.mock.restoreAll();
    rmSync(directory, { recursive: true, force: true });
  }
}
const response = (value: unknown) => ({ status: 0, stdout: JSON.stringify(value) });

test('backfill argument bounds reject ambiguous caps, invalid dates and oversized scopes', () => {
  assert.deepEqual(parseArgs(['123,123,456', '2026-10-01', '2026-10-31']).ids, ['123', '456']);
  assert.equal(parseArgs(args).maxPages, 2);
  for (const input of [
    ['0', ...args.slice(1)], ['01', ...args.slice(1)], ['9007199254740992', ...args.slice(1)],
    [Array.from({ length: 21 }, (_, i) => String(i + 1)).join(','), ...args.slice(1)],
    ['123', '2026-02-30', '2026-03-01'], ['123', '2026-10-07', '2026-10-01'],
    ['123', '2026-10-01', '2026-11-01'],
    [...args, '--max-pages', '0'], [...args, '--max-pages', '9'], [...args, '--max-pages', '1.5'],
    [...args, '--max-pages'], [...args, '--max-pages', '1', '--max-pages', '8'],
    [...args, '--execute', '--execute'], [...args, '--unknown'],
  ]) assert.throws(() => parseArgs(input), input.join(' '));
});

test('real dry-run CLI ignores private config/environment and creates no acquisition state', async t => {
  await workspace(t, async () => {
    writeFileSync('.env.local', 'EDGELAB_CONFIG=config/missing.json\nBALLDONTLIE_API_KEY=MOCK_ONLY_SECRET\n', { mode: 0o644 });
    writeFileSync('config/local.json', 'not valid JSON');
    const before = readFileSync('.env.local', 'utf8');
    const result = spawnSync(process.execPath, [script, ...args, '--max-pages', '2'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.mode, 'dry_run_no_network');
    assert.equal(plan.maximumProviderPages, 2);
    assert.ok(!result.stdout.includes('MOCK_ONLY_SECRET'));
    assert.equal(readFileSync('.env.local', 'utf8'), before);
    assert.equal(existsSync('.local'), false);
    assert.equal(existsSync('signals.sqlite'), false);
  });
});

test('execute resolves .env config once and pins the same config and credential environment for the child', async t => {
  await workspace(t, async logs => {
    configFile('config/local.json', { ...enabledConfig(), networkEnabled: false });
    configFile('config/dedicated.json');
    writeFileSync('.env.local', 'EDGELAB_CONFIG=config/dedicated.json\nBALLDONTLIE_API_KEY=MOCK_ONLY_KEY\n', { mode: 0o600 });
    let calls = 0;
    await main([...args, '--execute'], { now, spawn(command, childArgs, options) {
      calls++;
      assert.equal(command, process.execPath);
      assert.deepEqual(childArgs, ['--import', 'tsx', 'src/cli.ts', 'ingest', '123,456', args[1], args[2]]);
      assert.equal(options.env.EDGELAB_CONFIG, 'config/dedicated.json');
      assert.equal(options.env.BALLDONTLIE_API_KEY, 'MOCK_ONLY_KEY');
      assert.equal(options.timeout, 120000);
      return response({ inserted: 2, complete: true, exclusions: [] });
    } });
    assert.equal(calls, 1);
    assert.equal(JSON.parse(logs[0]).inserted, 2);
    assert.ok(!logs.join('').includes('MOCK_ONLY_KEY'));
  });
});

test('existing shell config selection has precedence over .env.local', async t => {
  await workspace(t, async () => {
    configFile('config/shell.json');
    writeFileSync('.env.local', 'EDGELAB_CONFIG=config/missing.json\n', { mode: 0o600 });
    process.env.EDGELAB_CONFIG = 'config/shell.json';
    await main([...args, '--execute'], { now, spawn(_command, _args, options) {
      assert.equal(options.env.EDGELAB_CONFIG, 'config/shell.json');
      return response({ inserted: 0, complete: true });
    } });
  });
});

test('mocked bounded execution observes cooldown, counts stages and stops at the page cap', async t => {
  await workspace(t, async logs => {
    configFile(); let calls = 0; const delays: number[] = [];
    await main([...args, '--max-pages', '2', '--execute'], {
      now, wait: async delay => { delays.push(delay); },
      spawn() { calls++; return response(calls === 1 ? { inserted: 0, complete: false, stage: 'fixture-page', exclusions: [] } : { inserted: 3, complete: false, exclusions: ['mock excluded row'] }); },
    });
    assert.equal(calls, 2); assert.deepEqual(delays, [15000]);
    const result = JSON.parse(logs[0]);
    assert.equal(result.inserted, 3); assert.equal(result.complete, false); assert.equal(result.pageCapReached, true);
    assert.deepEqual(result.pages.map((p: { stage: string }) => p.stage), ['fixture-page', 'stats']);
    assert.equal(result.pages[1].excluded, 1);
  });
});

test('completed/cached scopes stop immediately and do not wait for further pages', async t => {
  await workspace(t, async logs => {
    configFile(); let calls = 0;
    await main([...args, '--max-pages', '8', '--execute'], { now,
      wait: async () => { assert.fail('must not wait after completion'); },
      spawn() { calls++; return response({ inserted: 0, complete: true }); },
    });
    assert.equal(calls, 1); assert.equal(JSON.parse(logs[0]).pageCapReached, false);
  });
});

test('config, entitlement, permission and future-date failures start no ingestion process', async t => {
  await workspace(t, async () => {
    let calls = 0;
    const runtime = { now, spawn() { calls++; return response({ inserted: 0, complete: true }); } };
    await assert.rejects(main([...args, '--execute'], runtime), /Missing private/);
    for (const config of [
      { ...enabledConfig(), networkEnabled: false },
      { ...enabledConfig(), deliveryEnabled: true },
      { ...enabledConfig(), providers: { balldontlie: { ...enabledConfig().providers.balldontlie, tier: 'free' } } },
      { ...enabledConfig(), providers: { balldontlie: { ...enabledConfig().providers.balldontlie, dailyLimit: 0 } } },
    ]) { configFile('config/local.json', config); await assert.rejects(main([...args, '--execute'], runtime)); }
    configFile(); chmodSync('config/local.json', 0o644);
    await assert.rejects(main([...args, '--execute'], runtime), /owner-only/);
    chmodSync('config/local.json', 0o600);
    writeFileSync('.env.local', 'BALLDONTLIE_API_KEY=MOCK_ONLY_KEY\n', { mode: 0o644 });
    await assert.rejects(main([...args, '--execute'], runtime), /environment.*owner-only/);
    await assert.rejects(main(['123', '2026-11-22', '2026-11-23', '--execute'], runtime), /future/);
    assert.equal(calls, 0);
  });
});

test('page caps larger than the configured daily allowance fail before any child runs', async t => {
  await workspace(t, async () => {
    configFile('config/local.json', { ...enabledConfig(), providers: { balldontlie: { ...enabledConfig().providers.balldontlie, dailyLimit: 1 } } });
    await assert.rejects(main([...args, '--execute'], { now, spawn() { assert.fail('must not start'); } }), /Page cap exceeds/);
  });
});

test('provider/transport failure stops without retry or leaking child diagnostics', async t => {
  await workspace(t, async logs => {
    configFile(); let calls = 0;
    await assert.rejects(main([...args, '--max-pages', '8', '--execute'], {
      now, wait: async () => {}, spawn() {
        calls++;
        if (calls === 1) return response({ inserted: 0, complete: false, stage: 'fixture-page' });
        return { status: null, stdout: '', error: new Error('MOCK_SECRET_IN_TRANSPORT_URL') };
      },
    }), error => error instanceof Error && error.message.includes('step 2 failed') && !error.message.includes('MOCK_SECRET'));
    assert.equal(calls, 2); assert.equal(logs.length, 0);
  });
});

test('malformed or impossible ingestion results stop without additional pages', async t => {
  await workspace(t, async () => {
    configFile();
    for (const stdout of ['not-json', 'null', JSON.stringify({ inserted: -1, complete: true }), JSON.stringify({ inserted: 1.5, complete: true }), JSON.stringify({ inserted: 1, complete: 'yes' }), JSON.stringify({ inserted: 1, complete: false, exclusions: 'wrong' })]) {
      let calls = 0;
      await assert.rejects(main([...args, '--execute'], { now, spawn() { calls++; return { status: 0, stdout }; } }), /Unexpected ingestion/);
      assert.equal(calls, 1);
    }
  });
});

test('configuration changes while waiting stop the next page and preserve the original bounds', async t => {
  await workspace(t, async () => {
    configFile(); let calls = 0;
    await assert.rejects(main([...args, '--execute'], { now,
      wait: async () => { configFile('config/local.json', { ...enabledConfig(), providers: { balldontlie: { ...enabledConfig().providers.balldontlie, dailyLimit: 7 } } }); },
      spawn() { calls++; return response({ inserted: 1, complete: false }); },
    }), /Configuration changed/);
    assert.equal(calls, 1);
  });
});

test('importing the helper from a similarly named script does not run its CLI', async t => {
  await workspace(t, async () => {
    writeFileSync('check-bdl-backfill.mjs', `import ${JSON.stringify(new URL('../scripts/bdl-backfill.mjs', import.meta.url).href)}; console.log('IMPORTED_ONLY');\n`);
    const result = spawnSync(process.execPath, ['check-bdl-backfill.mjs', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), 'IMPORTED_ONLY');
    assert.equal(existsSync('.local'), false);
  });
});
