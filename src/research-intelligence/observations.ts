import{hash,ms,type Prop}from'../core/domain';
import{observePlayer,type FeatureObservation}from'./features';
import{validateSnapshot,type IntelligenceSnapshot}from'./types';

export type RegisteredObservation=ReturnType<typeof observePlayer>&{recordedAt:string;registrationId:string};
/** Append a separate authentic label; never regenerate the prediction's
 * features using newer inputs or overwrite its original registration. */
export function reconcileObservation(record:RegisteredObservation,original:IntelligenceSnapshot,final:IntelligenceSnapshot,at:string){
 validateSnapshot(original);validateSnapshot(final);
 const{recordedAt,registrationId,...frozen}=record;
 if(record.provenance.snapshotId!==original.id||ms(recordedAt)<ms(original.capturedAt)||ms(recordedAt)<ms(record.cutoff)||ms(recordedAt)>=ms(record.event.startsAt)-120000||registrationId!==hash([record.id,recordedAt])||ms(final.capturedAt)>ms(at))throw new Error('ORIGINAL_RESEARCH_REGISTRATION_INVALID');
 const replay=observePlayer(original,record.event.id,record.playerId,record.prop as Prop,record.cutoff);
 if(hash(replay)!==hash(frozen)||record.outcome!==null)throw new Error('ORIGINAL_RESEARCH_FEATURES_CHANGED');
 const candidates=final.rows.filter(r=>hash(r.log.event)===hash(record.event)&&r.log.playerId===record.playerId&&r.log.teamId===record.teamId&&r.log.final&&ms(r.log.observedAt)>ms(record.event.startsAt)&&ms(r.log.observedAt)<=ms(at)&&ms(r.log.source.retrievedAt)>ms(recordedAt)).sort((a,b)=>ms(b.log.observedAt)-ms(a.log.observedAt));
 const latest=candidates[0],sameClock=latest?candidates.filter(r=>r.log.observedAt===latest.log.observedAt):[];
 const base={version:'research-label/1.4.4',originalObservationId:record.id,originalRegistrationId:registrationId,originalSnapshotId:original.id,finalSnapshotId:final.id,at,productionEnabled:false};
 if(!latest)return{...base,state:'pending',labelledObservation:null};
 if(new Set(sameClock.map(r=>hash([r.log.stats,r.log.minutes,r.log.participated]))).size>1)return{...base,state:'ambiguous_final_revision',labelledObservation:null};
 const l=latest.log;if(l.participated!==true||l.stats[record.prop]===null||l.minutes===null)return{...base,state:l.participated===false?'verified_nonparticipation':'unresolved_final',labelledObservation:null,sourceHash:l.source.hash};
 const outcome={value:l.stats[record.prop]!,minutes:l.minutes,observedAt:l.observedAt,sourceHash:l.source.hash},labelledObservation:FeatureObservation={...frozen,outcome};
 return{...base,id:hash([registrationId,l.source,outcome]),state:'labelled',sourceHash:l.source.hash,labelledObservation};
}
