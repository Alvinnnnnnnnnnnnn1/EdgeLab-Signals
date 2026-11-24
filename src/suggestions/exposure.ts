import {z} from 'zod';
import {Store} from '../core/store';
import {stamp,ms,type Quote} from '../core/domain';

export const exposureConfigSchema=z.object({enabled:z.boolean().default(false),policy:z.object({id:z.string().min(1),ownerApproved:z.literal(true),approvalReference:z.string().min(1),effectiveAt:stamp,expiresAt:stamp,maxPerFixture:z.number().int().min(1).max(30),maxPerPlayerFixture:z.number().int().min(1).max(4)}).strict().nullable().default(null)}).strict();
export type ExposureConfig=z.infer<typeof exposureConfigSchema>;
/** Invoke inside the same IMMEDIATE transaction that creates suggestion/outbox.
 * Count ALL permanent historical issues, regardless of delivery or grading.
 * No second mutable exposure ledger can diverge from issued identities. */
export function exposureBlock(store:Store,raw:ExposureConfig,q:Quote,at:string):string|null{
 const config=exposureConfigSchema.parse(raw);if(!config.enabled)return null;
 if(!store.db.isTransaction)throw Error('EXPOSURE_TRANSACTION_REQUIRED');
 const p=config.policy;if(!p||ms(p.effectiveAt)>ms(at)||ms(p.expiresAt)<=ms(at)||ms(p.expiresAt)<=ms(p.effectiveAt))return'EXPOSURE_POLICY_MISSING_OR_INACTIVE';
 const count=store.db.prepare("SELECT count(*) total,sum(CASE WHEN json_extract(body,'$.quote.playerId')=? THEN 1 ELSE 0 END) player FROM experimental_suggestions WHERE json_extract(body,'$.quote.event.id')=?").get(q.playerId,q.event.id)!;
 if(Number(count.total)>=p.maxPerFixture)return'FIXTURE_EXPOSURE_LIMIT';
 if(Number(count.player??0)>=p.maxPerPlayerFixture)return'PLAYER_FIXTURE_EXPOSURE_LIMIT';
 return null;
}
