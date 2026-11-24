import {Store} from '../core/store';
import type {Config} from '../core/config';
import {hash,ms,quoteFresh,type Quote} from '../core/domain';
import {grantAuthority,privateJSON} from './policy';
import {notificationWindow} from '../research/schedule';
import {comparableSides} from '../research/markets';
export interface MultiEvidence {decisionId:string;comparisonAt:string;selectedQuoteHash:string;opposite:Quote;alternatives:Quote[];jobId:string;cycleId:string;activationId:string;}
export function assertMultiDelivery(store:Store,config:Config,e:MultiEvidence,q:Quote,at:string,forecast?:{id:string;artifactHash:string;inputHash:string}){
 const m=config.multiBookmaker;if(!m.codeEnabled||!m.comparisonEnabled||!m.telegramEnabled)throw new Error('MULTI_TELEGRAM_NOT_ACTIVATED');
 if(!m.enabledMarkets[q.bookmaker as keyof typeof m.enabledMarkets]?.includes(q.prop)||hash(q)!==e.selectedQuoteHash||ms(e.comparisonAt)>ms(at)||!quoteFresh(q,at,180,120)||!quoteFresh(e.opposite,at,180,120)||notificationWindow(at,q.expiresAt).state!=='ready')throw new Error('MULTI_DELIVERY_EXPIRED_OR_DISABLED');
 const row=store.db.prepare('SELECT body FROM multi_bookmaker_decisions WHERE id=?').get(e.decisionId);if(!row)throw new Error('MULTI_IMMUTABLE_DECISION_REQUIRED');const audit=JSON.parse(String(row.body)),{id,...body}=audit;if(hash(body)!==id||audit.cycleId!==e.cycleId||audit.activationId!==e.activationId||audit.jobId!==e.jobId||!audit.decision.selected.some((s:{quote:Quote})=>hash(s.quote)===hash(q)))throw new Error('MULTI_DECISION_IDENTITY_CHANGED');const selected=audit.decision.selected.find((s:{quote:Quote})=>hash(s.quote)===hash(q));if(e.comparisonAt!==audit.decision.at||hash(selected.opposite)!==hash(e.opposite)||hash(audit.decision.alternatives[hash(q)].map((o:{quote:Quote})=>o.quote))!==hash(e.alternatives)||forecast&&(selected.forecastId!==forecast.id||selected.artifactHash!==forecast.artifactHash||!audit.decision.forecastRefs.some((f:any)=>f.id===forecast.id&&f.inputHash===forecast.inputHash)))throw new Error('MULTI_FROZEN_EVIDENCE_CHANGED');
 const job=store.db.prepare('SELECT * FROM recurring_market_jobs WHERE id=?').get(e.jobId);if(!job)throw new Error('MULTI_JOB_MISSING');const active=store.get<{path:string}>('recurring:active-policy');if(!active)throw new Error('MULTI_SHARED_POLICY_MISSING');const policy=privateJSON(active.path),authority=grantAuthority(store,m,job as any,q.event,at,policy,hash(policy),true);if(authority.cycleId!==e.cycleId||authority.activation.id!==e.activationId)throw new Error('MULTI_ACTIVATION_CHANGED');
 q.side==='over'?comparableSides(q,e.opposite):comparableSides(e.opposite,q);
 for(const alternative of e.alternatives){if(!quoteFresh(alternative,at,180,120)||alternative.line!==q.line||alternative.side!==q.side||alternative.playerId!==q.playerId||hash(alternative.event)!==hash(q.event)||Math.abs(ms(alternative.quotedAt)-ms(q.quotedAt))>30000||Math.abs(ms(alternative.retrievedAt)-ms(q.retrievedAt))>30000)throw new Error('MULTI_ALTERNATE_PRICE_STALE');}
 return true;
}
