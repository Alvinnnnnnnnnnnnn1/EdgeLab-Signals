import {acquisitionEstimate} from './plan';
const [command,fixtures='1',days='30']=process.argv.slice(2);if(command!=='plan')throw new Error('Offline usage: node --import tsx src/multi-bookmaker/cli.ts plan FIXTURES_PER_DAY DAYS');console.log(JSON.stringify(acquisitionEstimate(Number(fixtures),Number(days)),null,2));
