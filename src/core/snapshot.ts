import { existsSync } from 'node:fs';
import { loadConfig } from './config';
import { Store } from './store';
import { systemStatus } from './worker';
import { performance } from './settlement';
import { nowISO, quoteFresh } from './domain';
export function snapshot() {
  const config=loadConfig(),path=process.env.EDGELAB_DB||config.database,store=existsSync(path)?new Store(path,true):new Store(':memory:');
  try{
    const at=nowISO(),all=store.signals(),mode=all.length&&all.every(s=>s.simulated)?'simulated':'live';
    const selected=all.filter(s=>mode==='simulated'?s.simulated:!s.simulated),outcomes=store.outcomes(),delivery=store.outboxes();
    return{at,mode,signals:selected.map(s=>({id:s.id,issuedAt:s.issuedAt,simulated:s.simulated,supersedes:s.supersedes,quote:s.decision.quote,
      forecast:s.decision.forecast?{probability:s.decision.forecast.win,push:s.decision.forecast.push,lower:s.decision.forecast.lowerWin,n:s.decision.forecast.n,minutes:s.decision.forecast.expectedMinutes,minutesSD:s.decision.forecast.minutesSD,robustEV:s.decision.forecast.robustEV,limitations:s.decision.forecast.limitations,model:s.decision.forecast.model}:null,
      ev:s.decision.ev,breakEven:s.decision.breakEven,fairOdds:s.decision.fairOdds,active:quoteFresh(s.decision.quote,at,config.screen.maxQuoteAgeSeconds,config.scan.minBeforeStartSeconds),
      delivery:delivery.find(d=>d.signalId===s.id)?.state??'unknown',outcome:outcomes.find(o=>o.signalId===s.id)?.result??null})),
      performance:performance(selected,outcomes),status:systemStatus(config,store,at)};
  }finally{store.close();}
}
export type Snapshot=ReturnType<typeof snapshot>;
