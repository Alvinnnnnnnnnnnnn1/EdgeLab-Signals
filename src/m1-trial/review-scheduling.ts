import type{Store}from'../core/store';import type{EngineeringJournal}from'../model-engineering/journal';import type{TrialMarker}from'./contracts';
/** The finished original BAU window is immutable. Reuse its genuine report
 * only when every relevant input still predates it; never relabel its clock. */
export function cachedTrialReviewCurrent(s:Store,j:EngineeringJournal,m:TrialMarker,at:string){
 if(Date.parse(at)<Date.parse(m.activation.window.endExclusive))return false;
 const latest=j.db.prepare('SELECT id,at FROM m1_trial_reviews ORDER BY at DESC,id DESC LIMIT 1').get();if(!latest)return false;const body=j.db.prepare('SELECT body FROM m1_trial_reviews WHERE id=?').get(latest.id!)!,report=JSON.parse(String(body.body));if(report.protocolId!==m.protocol.id||report.activation.id!==m.activation.id)return false;
 const ids=m.activation.window.fixtures.map(e=>e.id);if(!ids.length)return false;const marks=ids.map(()=>'?').join(','),after=String(latest.at),queries:[Store['db'],string,unknown[]][]=[
 [s.db,`SELECT 1 FROM logs WHERE event_id IN (${marks}) AND observed_at>? LIMIT 1`,[...ids,after]],
 [j.db,`SELECT 1 FROM engineering_grades g JOIN engineering_predictions p ON p.id=g.prediction_id WHERE p.event_id IN (${marks}) AND g.at>? LIMIT 1`,[...ids,after]],
 [j.db,`SELECT 1 FROM engineering_checks g JOIN engineering_predictions p ON p.id=g.prediction_id WHERE p.event_id IN (${marks}) AND g.at>? LIMIT 1`,[...ids,after]],
 [s.db,`SELECT 1 FROM experimental_suggestions WHERE json_extract(body,'$.quote.event.id') IN (${marks}) AND at>? LIMIT 1`,[...ids,after]],
 [s.db,`SELECT 1 FROM experimental_candidates WHERE json_extract(body,'$.quote.event.id') IN (${marks}) AND at>? LIMIT 1`,[...ids,after]],
 [s.db,`SELECT 1 FROM experimental_grades g JOIN experimental_suggestions p ON p.id=g.signal_id WHERE json_extract(p.body,'$.quote.event.id') IN (${marks}) AND g.at>? LIMIT 1`,[...ids,after]],
 [s.db,"SELECT 1 FROM quota WHERE provider='odds' AND at>? LIMIT 1",[after]],
 [s.db,"SELECT 1 FROM confirmed_placement_receipts WHERE at>? LIMIT 1",[after]]];
 for(const[db,sql,args]of queries)if(db.prepare(sql).get(...args as any[]))return false;return{at:after,id:String(latest.id)};
}
export function reviewMayRun(s:Store,result:any,at:string){if(result?.state!=='COMPLETE')return false;return!s.db.prepare("SELECT id FROM recurring_market_jobs WHERE state IN ('queued','deferred','observed','requesting') AND deadline>? AND due_at<=? LIMIT 1").get(at,new Date(Date.parse(at)+30*60000).toISOString());}
