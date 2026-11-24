import { hash, ms, type Event, type Receipt } from '../core/domain';
import type { Store } from '../core/store';
import type { ExperimentalForecast } from '../suggestions/forecasts';
import { assertState, type PregameState, type Availability } from '../model-engineering/freshness';

export function trialContext(s: Store, event: Event, playerId: string, teamId: string, at: string) {
  const fixture = s.get<any>('live:fixture:'+event.id.split(':').at(-1)), roster = s.get<any>('live:roster:'+playerId.split(':').at(-1));
  const complete=s.get<{at:string;source:Receipt}>('live:injuries-complete');
  const injury=(id:string)=>s.get<any>('live:injury:'+id.split(':').at(-1));
  const fact=(v:any)=>v ? { value: (({available:'Available',probable:'Probable',questionable:'Questionable',out:'Out','late scratch':'LateScratch'} as Record<string,Availability>)[String(v.status).toLowerCase()]??'Unknown'), observedAt:v.observedAt, source:v.source } : null;
  const players=s.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%' AND json_extract(value,'$.teamId')=? ORDER BY key").all(teamId).map(r=>JSON.parse(String(r.value)));
  const state:PregameState={event,playerId,teamId,fixture:fixture?{value:fixture.event,observedAt:fixture.source.retrievedAt,source:fixture.source}:null,roster:roster?{value:{playerId:roster.playerId,teamId:roster.teamId},observedAt:roster.observedAt,source:roster.source}:null,injury:fact(injury(playerId)),starter:null,teammates:players.filter(p=>p.playerId!==playerId).flatMap(p=>{const status=fact(injury(p.playerId));return status?[{playerId:p.playerId,status}]:[];})};
  assertState(state,at,r=>s.hasReceipt(r));
  if(complete&&(ms(complete.at)>ms(at)||complete.source.simulated||!s.hasReceipt(complete.source)))throw Error('INVALID_COMPLETED_INJURY_SNAPSHOT');
  const context={state,injurySnapshot:complete,historyHead:s.db.prepare('SELECT rowid,id FROM logs ORDER BY rowid DESC LIMIT 1').get()??null,teamRoster:players.map(p=>({playerId:p.playerId,teamId:p.teamId,observedAt:p.observedAt,source:p.source})),availability:'UNCONFIRMED_CONDITIONAL_ON_PLAYING',starter:null,quantitativeTeammateResponse:null};
  return{...context,hash:hash(context)};
}
export function assertTrialFreshness(s:Store,f:ExperimentalForecast,at:string) {
  const marker=s.get<any>('production:m1-trial');
  const inputs=f.inputs as typeof f.inputs&{trialId?:string;contextHash?:string};
  if(!marker?.enabled){if(inputs.trialId)throw Error('M1_TRIAL_NO_LONGER_ACTIVE');return;}
  if(f.prop==='threes')return;
  if(inputs.trialId!==marker.protocol.id||!inputs.contextHash||f.modelVersion!=='pooled-minutes-rate/1.0.1')throw Error('ACTIVE_M1_ROUTE_REQUIRED');
  if(trialContext(s,f.event,f.playerId,f.teamId,at).hash!==inputs.contextHash)throw Error('M1_MATERIAL_CONTEXT_CHANGED_REFRESH_REQUIRED');
}
