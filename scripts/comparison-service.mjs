import {runComparisonWorker,comparisonHealth} from '../src/production/supervisor.ts';
if(process.argv[2]==='health')console.log(JSON.stringify(comparisonHealth(process.argv[3]),null,2));
else if(process.argv[2]==='worker')await runComparisonWorker(process.argv[3]);
else throw new Error('COMPARISON_WORKER_OR_HEALTH_REQUIRED');
