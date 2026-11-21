import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { loadConfig } from './core/config';
import { Store } from './core/store';
import { nowISO, props, type League } from './core/domain';
import { runDemo } from './demo';
import { runWorker, scanOnce, systemStatus } from './core/worker';
import { importBundle, completeness } from './providers/import';
import { evaluate } from './core/evaluation';
import { BlueBubbles } from './core/messaging';
import { JsonHTTP } from './providers/http';
import { BDLProvider } from './providers/balldontlie';
import { OddsProvider } from './providers/odds';
import { settle } from './core/settlement';
const [command='help',...args]=process.argv.slice(2);
async function main(){
  if(command==='demo'){console.log(JSON.stringify(await runDemo(args[0]),null,2));return;}
  if(command==='help'){console.log(`EdgeLab Signals (Node 24)\n\n  demo [isolated-db]        Offline synthetic end-to-end pipeline\n  audit                    Local capabilities and readiness; no network\n  scan                     One independent research cycle\n  worker                   Headless 60-second tick; configured windows/quotas\n  import <bundle.json>     Import permitted normalized records + source bytes\n  ingest <ids> <from> <to>  One resumable BDL stats page; configured entitlement\n  discover <NBA|NBL>       Read-only event catalogue under configured allowance\n  markets <league> <id>    Read-only exact event market coverage (1-credit ceiling)\n  evaluate [as-of|retrospective]  Chronological reports; retrospective cannot activate\n  settle                   Grade existing issued recommendations from retained finals\n  verify-relay             Read-only ping + exact allowlisted DM verification; NO SEND\n\nPrivate config: EDGELAB_CONFIG or config/local.json (0600). Network/delivery disabled by default.`);return;}
  const config=loadConfig(),store=new Store(config.database);
  try{
    if(command==='audit'){console.log(JSON.stringify({status:systemStatus(config,store,nowISO()),credentials:{balldontlie:!!process.env.BALLDONTLIE_API_KEY,odds:!!process.env.ODDS_API_KEY,bluebubbles:!!process.env.BLUEBUBBLES_PASSWORD},report:'docs/source-capabilities.md'},null,2));}
    else if(command==='scan')console.log(JSON.stringify(await scanOnce(config,store),null,2));
    else if(command==='worker'){
      const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
      await runWorker(config,store,controller.signal);
    }
    else if(command==='import'){
      if(!args[0])throw new Error('Import path required');
      const result=importBundle(JSON.parse(readFileSync(args[0],'utf8')),store,nowISO());
      console.log(JSON.stringify({inserted:result.inserted,completeness:completeness(store.logs())},null,2));
    }
    else if(command==='evaluate'){
      const mode=args[0]??'as-of';if(!['as-of','retrospective'].includes(mode))throw new Error('Choose as-of or retrospective');
      const reports=(['NBA','NBL'] as const).flatMap(league=>props.map(prop=>evaluate(store.logs(),league,prop,nowISO(),mode as 'as-of'|'retrospective')));
      mkdirSync('.local/evaluations',{recursive:true,mode:0o700});
      const path=`.local/evaluations/${nowISO().replaceAll(':','-')}.json`;
      writeFileSync(path,JSON.stringify(reports,null,2),{mode:0o600});console.log(JSON.stringify({path,validations:reports.map(r=>r.validation)},null,2));
    }
    else if(command==='settle')console.log(JSON.stringify(settle(store,store.logs(),nowISO()),null,2));
    else if(command==='verify-relay')console.log(JSON.stringify(await new BlueBubbles(config,store).verify(),null,2));
    else if(command==='ingest'){
      if(!args[0]||!args[1]||!args[2]||!/^\d+(,\d+)*$/.test(args[0])||![args[1],args[2]].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)))throw new Error('Use numeric player IDs and ISO dates');
      console.log(JSON.stringify(await new BDLProvider(new JsonHTTP(store,config),store,config).stats(args[0].split(','),args[1],args[2],nowISO()),null,2));
    }
    else if(command==='discover'||command==='markets'){
      if(!['NBA','NBL'].includes(args[0]))throw new Error('Specify NBA or NBL');
      const provider=new OddsProvider(new JsonHTTP(store,config));
      console.log(JSON.stringify(command==='discover'?await provider.events(args[0] as League):await provider.markets(args[0] as League,args[1]||''),null,2));
    }
    else throw new Error('Unknown command; use npm run signals -- help');
  }finally{store.close();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Operation failed');process.exitCode=1;});
