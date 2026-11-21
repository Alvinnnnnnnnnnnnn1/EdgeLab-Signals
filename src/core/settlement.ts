import { assertReceipt, gameLogSchema, hash, ms, type GameLog } from './domain';
import { Store, type Outcome, type Signal } from './store';
export function grade(signal:Signal,raw:GameLog,at:string):Outcome {
  const r=gameLogSchema.parse(raw),q=signal.decision.quote;
  assertReceipt(r.source,at,signal.simulated);for(const s of r.supportingSources??[])assertReceipt(s,at,signal.simulated);
  if(r.source.simulated!==signal.simulated)throw new Error('Simulation/live settlement mismatch');
  if(!r.final||r.event.id!==q.event.id||r.event.league!==q.event.league||r.event.season!==q.event.season||r.playerId!==q.playerId||r.teamId!==q.teamId||r.event.homeId!==q.event.homeId||r.event.awayId!==q.event.awayId)throw new Error('Exact final player/event identity mismatch');
  if(ms(signal.issuedAt)>=ms(q.event.startsAt)||ms(r.observedAt)<=ms(q.event.startsAt)||ms(r.observedAt)>ms(at)||ms(r.source.retrievedAt)<=ms(signal.issuedAt)||r.source.hash===q.source.hash)throw new Error('Settlement clocks/evidence invalid');
  // Revised source starts cannot move the frozen pre-event deadline; large metadata changes require review.
  if(Math.abs(ms(r.event.startsAt)-ms(q.event.startsAt))>5*60_000)throw new Error('Event timing changed materially; hold reconciliation');
  let result:Outcome['result'],value:number|null=r.stats[q.prop];
  if(r.participated===false){result='void';value=null;}
  else{
    if(r.participated!==true||value===null)throw new Error('Missing final statistic or participation; not zero/void');
    result=value===q.line?'push':(q.side==='over'?value>q.line:value<q.line)?'won':'lost';
  }
  return{id:hash([signal.id,r.source.hash,result,value]),signalId:signal.id,at,result,value,units:result==='won'?q.decimalOdds-1:result==='lost'?-1:0,evidence:r};
}
export function settle(store:Store,logs:GameLog[],at:string) {
  let count=0;const held:string[]=[];
  for(const s of store.signals()){
    const rows=logs.filter(r=>r.event.id===s.decision.quote.event.id&&r.playerId===s.decision.quote.playerId).sort((a,b)=>ms(b.observedAt)-ms(a.observedAt));
    if(!rows.length)continue;
    try{
      if(![rows[0].source,...(rows[0].supportingSources??[])].every(s=>store.hasReceipt(s)))throw new Error('Final source bytes missing');
      const outcome=grade(s,rows[0],at);if(store.recordOutcome(outcome))count++;
    }catch(e){held.push(`${s.id.slice(0,10)}: ${(e as Error).message}`);}
  }
  return{settled:count,held};
}
export function performance(signals:Signal[],outcomes:Outcome[]) {
  const ids=new Set(signals.map(s=>s.id)),grades=outcomes.filter(o=>ids.has(o.signalId)),sById=new Map(signals.map(s=>[s.id,s]));
  const won=grades.filter(o=>o.result==='won').length,lost=grades.filter(o=>o.result==='lost').length;
  const scored=grades.filter(o=>o.result==='won'||o.result==='lost').map(o=>({p:sById.get(o.signalId)!.decision.forecast!.win/(1-sById.get(o.signalId)!.decision.forecast!.push-(sById.get(o.signalId)!.decision.forecast!.voidProbability??0)),y:Number(o.result==='won')}));
  const metrics=scored.length?{brier:scored.reduce((n,s)=>n+(s.p-s.y)**2,0)/scored.length,logLoss:scored.reduce((n,s)=>n-s.y*Math.log(Math.max(1e-9,s.p))-(1-s.y)*Math.log(Math.max(1e-9,1-s.p)),0)/scored.length}:null;
  const groups=(key:'league'|'prop')=>[...new Set(signals.map(s=>key==='league'?s.decision.quote.event.league:s.decision.quote.prop))].map(name=>{const group=signals.filter(s=>(key==='league'?s.decision.quote.event.league:s.decision.quote.prop)===name),set=new Set(group.map(s=>s.id)),g=grades.filter(o=>set.has(o.signalId));return{name,issued:group.length,settled:g.length,units:g.reduce((n,o)=>n+o.units,0)};});
  return{issued:signals.length,settled:grades.length,pending:signals.length-grades.length,won,lost,push:grades.filter(o=>o.result==='push').length,void:grades.filter(o=>o.result==='void').length,
    hitRate:won+lost?won/(won+lost):null,units:grades.reduce((n,o)=>n+o.units,0),averageOdds:signals.length?signals.reduce((n,s)=>n+s.decision.quote.decimalOdds,0)/signals.length:null,
    averageEV:signals.length?signals.reduce((n,s)=>n+s.decision.ev!,0)/signals.length:null,metrics,byLeague:groups('league'),byProp:groups('prop'),
    calibration:Array.from({length:5},(_,i)=>{const g=scored.filter(s=>s.p>=i/5&&s.p<(i+1)/5);return{from:i/5,to:(i+1)/5,n:g.length,predicted:g.length?g.reduce((n,s)=>n+s.p,0)/g.length:null,observed:g.length?g.reduce((n,s)=>n+s.y,0)/g.length:null};}),
    independentEventClusters:new Set(signals.map(s=>s.decision.quote.event.id)).size,updates:signals.filter(s=>s.supersedes).length};
}
