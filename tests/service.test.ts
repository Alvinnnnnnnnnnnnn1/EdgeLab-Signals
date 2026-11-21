import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../src/core/store';

test('the absolute-path service wrapper starts and stops safely with disabled config in an isolated workspace',()=>{
  const directory=mkdtempSync(join(tmpdir(),'edgelab-service-')),database=join(directory,'worker.sqlite'),config=join(directory,'config.json');
  try{writeFileSync(config,JSON.stringify({database,networkEnabled:false,operatingMode:'disabled'}),{mode:0o600});
    const result=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/research-service.mjs'),'worker'],{cwd:directory,env:{...process.env,EDGELAB_CONFIG:config},encoding:'utf8',timeout:30000});assert.equal(result.status,0);const store=new Store(database);try{assert.equal(store.get<{state:string}>('live:worker')!.state,'stopped');assert.equal(store.usage().length,0);assert.equal(store.signals().length,0);}finally{store.close();}
  }finally{rmSync(directory,{recursive:true,force:true});}
});
