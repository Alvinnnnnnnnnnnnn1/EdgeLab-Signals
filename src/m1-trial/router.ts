import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { realpathSync as realpath } from 'node:fs';
import { hash, ms } from '../core/domain';
import type { Store } from '../core/store';
import type { ExperimentalForecast } from '../suggestions/forecasts';
import { fixtureProof,rosterProof } from '../suggestions/forecasts';
import { summary } from '../research/distributions';
import { assertProtocol,type TrialMarker,TRIAL_VERSION } from './contracts';
import { assertTrialFreshness } from './context';
import { trialCodeHash,assertFrozenConfiguration } from './code';

/** A missing trial forecast holds its three live props. Original 3PM objects pass through unchanged. */
export function routeTrial(s:Store,at:string,eventIds:string[],legacy:ExperimentalForecast[],marker:TrialMarker){
  const forecasts=legacy.filter(f=>f.prop==='threes'&&(f.artifactHash===marker.protocol.originalArtifacts.threes||(f.inputs.artifact as any).originalArtifactHash===marker.protocol.originalArtifacts.threes)),decisions:any[]=forecasts.map(f=>({eventId:f.event.id,playerId:f.playerId,prop:f.prop,forecastId:f.id,route:'original-threes',reason:'FROZEN_EXISTING_PRODUCTION'}));let j:DatabaseSync|undefined;
  try{
    assertProtocol(marker.protocol);assertFrozenConfiguration(marker.protocol);const a=marker.activation,{id,...abody}=a;
    if(hash(abody)!==id||a.protocolId!==marker.protocol.id||ms(a.activatedAt)>ms(at)||marker.protocol.codeHash!==trialCodeHash(marker.protocol.release))throw Error('TRIAL_ACTIVATION_OR_LOADED_CODE_MISMATCH');
    const activation=s.db.prepare('SELECT body FROM m1_trial_activations WHERE id=?').get(id);if(!activation||JSON.parse(String(activation.body)).markerHash!==hash(marker))throw Error('IMMUTABLE_TRIAL_ACTIVATION_REQUIRED');
    if(!resolve(marker.journalPath).includes('/.local/')||!marker.journalPath.endsWith('/engineering-shadow.sqlite')||!realpath(marker.journalPath).includes('/.local/'))throw Error('PRIVATE_TRIAL_JOURNAL_REQUIRED');
    j=new DatabaseSync(marker.journalPath,{readOnly:true});j.exec('PRAGMA busy_timeout=50');
    const protocol=j.prepare('SELECT body FROM m1_trial_protocols WHERE id=?').get(marker.protocol.id);if(!protocol||hash(JSON.parse(String(protocol.body)))!==hash(marker.protocol))throw Error('REGISTERED_TRIAL_PROTOCOL_REQUIRED');
    const targets=j.prepare(`SELECT r.body FROM m1_trial_ready r WHERE protocol_id=? AND event_id IN (${eventIds.map(()=>'?').join(',')||'NULL'}) AND NOT EXISTS (SELECT 1 FROM m1_trial_ready n WHERE n.protocol_id=r.protocol_id AND n.event_id=r.event_id AND n.player_id=r.player_id AND n.prop=r.prop AND (n.at>r.at OR (n.at=r.at AND n.id>r.id))) ORDER BY r.at,r.id`).all(marker.protocol.id,...eventIds);
    for(const row of targets){let f:ExperimentalForecast|undefined;try{
      const r=JSON.parse(String(row.body)),{id,...body}=r;f=r.forecast;
      if(hash(body)!==id||r.protocolId!==marker.protocol.id||r.bodyHash!==hash(f)||!f||f.prop==='threes'||f.artifactHash!==hash(f.inputs.artifact)||f.inputHash!==hash(f.inputs)||(f.inputs.artifact as any).modelId!==marker.protocol.modelId||ms(f.at)>ms(at)||ms(f.inputs.cutoff)>ms(f.at)||ms(at)>=ms(f.event.startsAt)-120000)throw Error('TRIAL_FORECAST_IDENTITY_OR_CLOCK');
      const raw=j.prepare('SELECT body FROM engineering_predictions WHERE id=?').get(r.predictionId);if(!raw)throw Error('M1_SHADOW_PAIR_REQUIRED');const p=JSON.parse(String(raw.body)),{id:pid,bodyHash,...pbody}=p;
      if(hash(pbody)!==bodyHash||r.predictionBodyHash!==bodyHash||p.artifact.id!==marker.protocol.modelId||p.prop!==f.prop||p.state.playerId!==f.playerId||p.state.teamId!==f.teamId||hash(p.state.event)!==hash(f.event)||hash(p.distribution)!==hash(f.distribution)||p.registeredAt!==f.at)throw Error('MATCHED_SHADOW_BODY_CHANGED');
      assertTrialFreshness(s,f,at);const fixture=s.get<any>('live:fixture:'+f.event.id.split(':').at(-1)),roster=s.get<any>('live:roster:'+f.playerId.split(':').at(-1));fixtureProof(s,f.event,fixture.source,at);rosterProof(s,roster,at);
      [f.distribution,f.baseline,f.challenger,...f.stress].forEach(summary);forecasts.push(f);decisions.push({eventId:f.event.id,playerId:f.playerId,prop:f.prop,forecastId:f.id,route:'m1-owner-trial',reason:'IMMUTABLE_PRETIP_M1_AND_MATCHED_ORIGINAL'});
    }catch(e){decisions.push({eventId:f?.event.id,playerId:f?.playerId,prop:f?.prop,route:'m1-hold',reason:(e as Error).message});}}
  }catch(e){decisions.push({route:'m1-hold',reason:(e as Error).message});}finally{j?.close();}
  return{at,version:TRIAL_VERSION,forecasts,decisions,counts:{advancedAssists:0,originalPrecomputed:forecasts.filter(f=>f.prop==='threes').length,originalFallbacks:0,sourceBlocked:decisions.filter(d=>/CONTEXT|SOURCE|roster|fixture/.test(d.reason)).length,artifactMismatch:decisions.filter(d=>/HASH|ARTIFACT|CHANGED|MISMATCH/.test(d.reason)).length,m1:forecasts.filter(f=>f.prop!=='threes').length,originalThrees:forecasts.filter(f=>f.prop==='threes').length,holds:decisions.filter(d=>d.route==='m1-hold').length}};
}
