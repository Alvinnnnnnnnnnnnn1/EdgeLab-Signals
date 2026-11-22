import{setPriority}from'node:os';
import{readFileSync}from'node:fs';
import{props,ms,nowISO,hash,type Prop}from'../core/domain';
import{exportIntelligence,immutableJSON,loadSnapshot}from'./snapshot';
import{intelligenceAudit}from'./audit';import{capabilities}from'./registry';import{historicalFeatures,observePlayer}from'./features';import{evaluateChallengers}from'./evaluate';import type{IntelligenceSnapshot}from'./types';
import{reconcileObservation,type RegisteredObservation}from'./observations';
export function researchWorkGuard(snapshot:IntelligenceSnapshot,at:string){
 if(snapshot.fixtures.some(f=>ms(f.event.startsAt)>ms(at)&&ms(f.event.startsAt)-ms(at)<=95*60000))throw new Error('RESEARCH_YIELDS_TO_KNOWN_LIVE_PREGAME_WINDOW');
}
async function main(){
 const[command,...args]=process.argv.slice(2);if(!command||command==='help'){console.log('Offline research intelligence (no credentials, networking, service installation or production writes)\n  registry\n  export DETACHED_SQLITE IMMUTABLE_JSON\n  audit SNAPSHOT_JSON OUTPUT_JSON\n  observe SNAPSHOT_JSON EXACT_FIXTURE_ID EXACT_PLAYER_ID PROP OUTPUT_JSON\n  reconcile OBSERVATION_JSON ORIGINAL_SNAPSHOT FINAL_SNAPSHOT NEW_OUTPUT\n  evaluate SNAPSHOT_JSON points|rebounds|assists|threes|minutes as-of OUTPUT_JSON');return;}
 setPriority(19);const started=Date.now();
 if(command==='registry'){console.log(JSON.stringify(capabilities,null,2));return;}
 if(command==='export'){if(args.length!==2)throw new Error('Use export DETACHED_SQLITE IMMUTABLE_JSON');const s=exportIntelligence(args[0],nowISO(),'Explicit detached local archive');immutableJSON(args[1],s);console.log(JSON.stringify({snapshotId:s.id,rows:s.rows.length,output:args[1]}));return;}
 if(command==='audit'){if(args.length!==2)throw new Error('Use audit SNAPSHOT_JSON OUTPUT_JSON');immutableJSON(args[1],intelligenceAudit(loadSnapshot(args[0])));console.log(JSON.stringify({output:args[1]}));return;}
 if(command==='reconcile'){if(args.length!==4)throw new Error('Use reconcile OBSERVATION_JSON ORIGINAL_SNAPSHOT FINAL_SNAPSHOT NEW_OUTPUT');const r=reconcileObservation(JSON.parse(readFileSync(args[0],'utf8'))as RegisteredObservation,loadSnapshot(args[1]),loadSnapshot(args[2]),nowISO());immutableJSON(args[3],r);console.log(JSON.stringify({output:args[3],state:r.state,productionEnabled:false}));return;}
 if(command==='observe'){if(args.length!==5||!props.includes(args[3]as Prop))throw new Error('Use observe SNAPSHOT_JSON EXACT_FIXTURE_ID EXACT_PLAYER_ID PROP OUTPUT_JSON');const s=loadSnapshot(args[0]);if(ms(nowISO())-ms(s.capturedAt)>15*60000)throw new Error('RESEARCH_SNAPSHOT_TOO_OLD_FOR_NEW_OBSERVATION');const observation=observePlayer(s,args[1],args[2],args[3]as Prop),recordedAt=nowISO(),fixture=s.fixtures.find(f=>f.event.id===observation.event.id&&f.source.hash===observation.provenance.fixtureSourceHash);if(ms(recordedAt)>=ms(observation.event.startsAt)-120000||!fixture||ms(recordedAt)-ms(fixture.source.retrievedAt)>6*3600000||ms(recordedAt)-ms(observation.rosterSource.retrievedAt)>24*3600000)throw new Error('REGISTRATION_DEADLINE_OR_SOURCE_TTL_EXPIRED');immutableJSON(args[4],{...observation,recordedAt,registrationId:hash([observation.id,recordedAt])});console.log(JSON.stringify({output:args[4],recordedAt,outcome:observation.outcome,productionEnabled:false}));return;}
 if(command==='evaluate'){
  if(args.length!==4||![...props,'minutes'].includes(args[1])||args[2]!=='as-of')throw new Error('ORIGINAL_PREGAME_SOURCE_AVAILABILITY_REQUIRED');
  const snapshot=loadSnapshot(args[0]),guard=()=>{researchWorkGuard(snapshot,nowISO());if(Date.now()-started>120000)throw new Error('BOUNDED_OFFLINE_BATCH_TIME_LIMIT');};guard();
  const target=args[1]as Prop|'minutes',features=historicalFeatures(snapshot,target==='minutes'?'points':target,args[2]as'as-of'|'retrospective',guard),report={...evaluateChallengers(features.observations,target,guard),sourceSnapshotId:snapshot.id};
  guard();immutableJSON(args[3]+'.features.json',features);immutableJSON(args[3],report);console.log(JSON.stringify({output:args[3],state:report.state,inputRows:report.inputRows,productionEnabled:false}));return;
 }
 throw new Error('Unknown intelligence command');
}
// Importing this module for guard tests must never execute the CLI.
if(process.argv[1]?.replaceAll('\\','/').endsWith('/research-intelligence/cli.ts'))main().catch(e=>{console.error(`Research command failed: ${e instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'CHECK_INPUTS_AND_SNAPSHOT_INTEGRITY'}. Live services were not modified.`);process.exitCode=1;});
