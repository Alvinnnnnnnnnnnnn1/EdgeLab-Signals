import {Store,type Outcome} from '../core/store';
import {grade} from '../core/settlement';
import {type GameLog,type Quote,type Terms} from '../core/domain';

export type SettlementState='pending_final_evidence'|'pending_processing'|'disputed'|'won'|'lost'|'push'|'void';
/** Diagnostic only: no grades, source clocks or issued records are changed. */
export function settlementReadiness(store:Store,issue:{id:string;at:string;quote:Quote;terms:Terms|null},previous:Outcome|undefined,at:string):{state:SettlementState;reason:string|null}{
 if(previous)return{state:previous.result,reason:null};
 const row=store.db.prepare('SELECT body FROM logs WHERE event_id=? AND player_id=? AND observed_at<=? ORDER BY observed_at DESC,rowid DESC LIMIT 1').get(issue.quote.event.id,issue.quote.playerId,at);
 if(!row)return{state:'pending_final_evidence',reason:'No retained final player statistics'};
 const final=JSON.parse(String(row.body)) as GameLog;
 if(!final.final||final.participated===null||final.participated===true&&final.stats[issue.quote.prop]===null)return{state:'pending_final_evidence',reason:'Finality, participation or required statistic is unresolved'};
 try{
  for(const receipt of [final.source,...(final.supportingSources??[])])if(!store.hasReceipt(receipt))throw Error('Final source bytes missing');
  const t=issue.terms,q=issue.quote;if(!t||t.id!==q.termsId||t.bookmaker!==q.bookmaker||t.prop!==q.prop||t.league!==q.event.league||!t.includesOvertime||!t.integerPush||!t.dnpVoid||!store.hasReceipt(t.source))throw Error('Original settlement terms unverified');
  grade({id:issue.id,issuedAt:issue.at,simulated:false,decision:{quote:q}},final,at);
  return{state:'pending_processing',reason:'Verified final evidence awaits the existing grading transaction'};
 }catch(e){return{state:'disputed',reason:(e as Error).message};}
}
