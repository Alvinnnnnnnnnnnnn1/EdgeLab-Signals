import { hash,ms } from '../core/domain';
import type { Store } from '../core/store';
import { EngineeringJournal,promotionRule } from '../model-engineering/journal';
import { engineeringReport } from '../model-engineering/report';
import { scoreOne } from '../research/scoring';
import { localDate,type TrialMarker } from './contracts';

/** Read-only source report. Quotes, selected recommendations and confirmed
 * placements remain distinct; no assumed purchases, inferred cash or final zeros. */
export function trialReview(s:Store,j:EngineeringJournal,m:TrialMarker,at:string){
  const p=m.protocol,w=m.activation.window,ids=w.fixtures.map(f=>f.id),inWindow=(id:string)=>ids.includes(id),parse=(r:any)=>JSON.parse(String(r.body));
  const predictions=j.db.prepare('SELECT body FROM engineering_predictions ORDER BY registered_at,id').all().map(parse).filter(r=>inWindow(r.state.event.id)),first=new Map<string,any>();
  for(const r of predictions){const key=hash([r.artifact.id,r.state.event.id,r.state.playerId,r.prop]);if(!first.has(key))first.set(key,r);}
  const issues=s.db.prepare('SELECT body FROM experimental_suggestions ORDER BY at,id').all().map(parse).filter(r=>inWindow(r.quote.event.id)&&ms(r.at)>=ms(m.activation.activatedAt));
  const candidates=s.db.prepare("SELECT body FROM experimental_candidates WHERE at>=? ORDER BY at,id").all(m.activation.activatedAt).map(parse).filter(r=>inWindow(r.quote.event.id));
  const grades=new Map(issues.map(r=>{const g=s.db.prepare('SELECT body FROM experimental_grades WHERE signal_id=? ORDER BY at DESC,rowid DESC LIMIT 1').get(r.id);return[r.id,g?parse(g):null];}));
  const quotes=candidates.map(r=>r.quote),by=(rows:any[],key:(r:any)=>string)=>Object.fromEntries([...new Set(rows.map(key))].map(k=>[k,rows.filter(r=>key(r)===k).length]));
  const placementTable=!!s.db.prepare("SELECT name FROM sqlite_master WHERE name='confirmed_placement_receipts'").get();
  const placements=placementTable?s.db.prepare('SELECT body FROM confirmed_placement_receipts ORDER BY at,id').all().map(parse).filter(r=>r.input.event?inWindow(r.input.event.id):issues.some(i=>i.id===r.input.suggestionId)):[];
  const outbox=s.db.prepare('SELECT id,state,error,body FROM experimental_outbox WHERE at>=? ORDER BY at,id').all(m.activation.activatedAt).filter(r=>JSON.parse(String(r.body)).ids?.some((id:string)=>issues.some(i=>i.id===id)));
  const ledger=s.db.prepare("SELECT q.id,q.at,q.credits,q.outcome,o.body FROM quota q LEFT JOIN odds_account_observations o ON o.quota_id=q.id WHERE q.provider='odds' AND q.at>=? ORDER BY q.at,q.id").all(m.activation.activatedAt).map(r=>({id:r.id,at:r.at,reserved:r.credits,outcome:r.outcome,observation:r.body?parse(r):null}));
  const minuteErrors=[...first.values()].flatMap(r=>{const check=j.db.prepare('SELECT body FROM engineering_checks WHERE prediction_id=? ORDER BY at DESC,rowid DESC LIMIT 1').get(r.id),g=j.db.prepare('SELECT body FROM engineering_grades WHERE prediction_id=? ORDER BY at DESC,rowid DESC LIMIT 1').get(r.id);if(!g||!check||parse(check).state!=='GRADED')return[];const grade=parse(g);return[{predictionId:r.id,eventId:r.state.event.id,playerId:r.state.playerId,prop:r.prop,actual:grade.actual,minutes:grade.minutes,minutesScores:scoreOne(r.minutesDistribution,Math.round(grade.minutes),[9.5,24.5,47.5])}];});
  const acceptedIds=new Set(outbox.filter(r=>r.state==='accepted').flatMap(r=>JSON.parse(String(r.body)).ids as string[]));
  const quality=engineeringReport(j.db,ids),accepted=issues.filter(r=>acceptedIds.has(r.id)),known=accepted.filter(r=>grades.get(r.id)),profit=known.reduce((sum,r)=>sum+Number(grades.get(r.id).units)*5,0);
  const report={version:'m1-bau-review/1',at,protocolId:p.id,activation:m.activation,status:ms(at)<ms(w.endExclusive)?'OBSERVING_FUTURE_OUTCOMES_PENDING':quality.pending?'WINDOW_ENDED_FINAL_EVIDENCE_PENDING':'WINDOW_ENDED_REVIEWABLE',frozenConfiguration:p,
    days:w.operatingDates.map(date=>{const es=w.fixtures.filter(e=>localDate(e.startsAt)===date),ps=[...first.values()].filter(r=>localDate(r.state.event.startsAt)===date);return{date,canonicalFixtures:es,reachedFixtures:[...new Set(ps.map(r=>r.state.event.id))],players:new Set(ps.map(r=>hash([r.state.event.id,r.state.playerId]))).size,forecasts:ps.length,byProp:by(ps,r=>r.prop),issued:issues.filter(r=>localDate(r.quote.event.startsAt)===date).length};}),
    populations:{allProspective:first.size,forecastRevisions:predictions.length,issued:issues.length,rejectedCandidates:candidates.filter(r=>r.trialQualification?.state==='REJECTED').length,matchedOriginalM1:first.size,confirmedPlacementReceipts:placements.length},quality,minuteErrors,candidateAssessments:candidates.map(r=>({id:r.id,forecastId:r.forecastId,at:r.at,qualification:r.trialQualification??null})),
    recommendations:issues.map(r=>({id:r.id,at:r.at,quote:r.quote,modelVersion:r.forecast.modelVersion,forecastAt:r.forecast.at,sourceClocks:r.forecast.inputs.sourceClocks??null,issueEvidence:r.issueEvidence??null,win:r.win,grade:grades.get(r.id),selectedBookmaker:r.quote.bookmaker})),
    exposure:{byFixture:by(issues,r=>r.quote.event.id),byPlayerFixture:by(issues,r=>hash([r.quote.event.id,r.quote.playerId])),policy:'UNCHANGED_OWNER_POLICY_NO_NEW_CAPS'},
    quotes:{observedSides:quotes.length,byBookmaker:by(quotes,r=>r.bookmaker),exactIdentities:quotes.map(q=>({eventId:q.event.id,playerId:q.playerId,prop:q.prop,side:q.side,line:q.line,bookmaker:q.bookmaker,decimalOdds:q.decimalOdds,termsId:q.termsId,quotedAt:q.quotedAt,retrievedAt:q.retrievedAt}))},
    hypotheticalFlat5:{classification:'GENUINE_ACCEPTED_RECOMMENDATION_QUOTES_ONLY_NOT_CASH',issued:issues.length,accepted:accepted.length,settled:known.length,profitAUD:known.length?profit:null,roi:known.length?profit/(known.length*5):null,unsettledExcluded:accepted.length-known.length,unacceptedExcluded:issues.length-accepted.length},
    confirmedCash:{receipts:placements,profitAUD:null,reason:'NO_STAKE_OR_CASH_SETTLEMENT_INFERRED_FROM_RECOMMENDATIONS_OR_CONFIRMATION'},
    quota:{trialLedger:ledger,unresolvedPaid:s.db.prepare("SELECT id,credits,outcome FROM quota WHERE provider='odds' AND outcome='reserved'").all(),uncertain:s.get('recurring:uncertain-debit'),budgetEvidence:s.get('suggestions:last-budget')??null,noNewGrant:true},
    delivery:{batches:outbox.map(({body,...r})=>r),research:s.get('live:worker'),markets:s.get('recurring:worker'),trialHeartbeat:j.db.prepare("SELECT value FROM engineering_runtime WHERE key='trial-heartbeat'").get()},
    sourceHolds:j.db.prepare('SELECT body FROM engineering_holds WHERE at>=? ORDER BY at,id').all(m.activation.activatedAt).map(parse),promotionRule,formalPromotion:false,limitations:['Two operating days cannot establish long-run profitability','Refreshes and final revisions are not independent observations','Unavailable bookmaker coverage and cash amounts stay unknown','Only exact genuine participating finals enter conditional model scores']};
  return{...report,id:hash(report)};
}
export function appendTrialReview(s:Store,j:EngineeringJournal,m:TrialMarker,at:string){const r=trialReview(s,j,m,at);j.db.prepare('INSERT OR IGNORE INTO m1_trial_reviews VALUES (?,?,?)').run(r.id,at,JSON.stringify(r));return r;}
