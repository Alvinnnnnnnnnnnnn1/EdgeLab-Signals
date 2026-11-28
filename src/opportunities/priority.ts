import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {hash,quoteFresh} from '../core/domain';
import type {Store} from '../core/store';
/** A read-only operational hint, never a forecast or qualification override.
 * Only genuinely captured, unexpired LIVE_STAGE prices can request catch-up. */
export function liveForecastPriorities(s:Store,at:string,path=process.env.EDGELAB_OPPORTUNITY_JOURNAL){
 const targets=new Set<string>();if(!path||!path.includes('/.local/')||!existsSync(path))return targets;const j=new DatabaseSync(path,{readOnly:true});try{j.exec('PRAGMA busy_timeout=50');for(const row of j.prepare("SELECT body FROM evaluations WHERE kind='LIVE_STAGE' AND json_extract(body,'$.quote.expiresAt')>? ORDER BY json_extract(body,'$.quote.expiresAt'),rowid LIMIT 256").all(at)){const b=JSON.parse(String(row.body)),q=b.quote;if(q.prop==='threes'||!quoteFresh(q,at,180,120)||!s.hasReceipt(q.source))continue;targets.add(hash([q.event,q.playerId,q.prop]));}}catch{/* An unavailable hint cannot block ordinary fair forecasting. */}finally{j.close();}return targets;
}
