import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {hash,ms,type GameLog,type Receipt} from '../core/domain';
import {bdlEvent} from '../providers/balldontlie';
import {INTELLIGENCE_VERSION,rawFields,snapshotID,validateSnapshot,type RawFields,type IntelligenceSnapshot,type EnrichedGame,type FixtureEvidence,type InjuryObservation} from './types';

export function immutableJSON(path:string,value:unknown){mkdirSync(dirname(path),{recursive:true,mode:0o700});const body=JSON.stringify(value);if(existsSync(path)){if(readFileSync(path,'utf8')!==body)throw new Error('IMMUTABLE_RESEARCH_OUTPUT_COLLISION');return path;}writeFileSync(path,body,{mode:0o600,flag:'wx'});return path;}
export function loadSnapshot(path:string){return validateSnapshot(JSON.parse(readFileSync(path,'utf8')));}
export function assertDetachedDatabase(path:string){
 const actual=realpathSync(path),blocked=[resolve('.local/signals.sqlite')];
 if(existsSync('config/local.json')){const config=JSON.parse(readFileSync('config/local.json','utf8'));if(typeof config.database==='string')blocked.push(resolve(config.database));}
 if(process.env.EDGELAB_DB)blocked.push(resolve(process.env.EDGELAB_DB));
 if(blocked.some(p=>existsSync(p)&&realpathSync(p)===actual))throw new Error('USE_A_DETACHED_DATABASE_SNAPSHOT');
}
export function exportIntelligence(database:string,at:string,sourceReference:string):IntelligenceSnapshot{
 assertDetachedDatabase(database);const db=new DatabaseSync(database,{readOnly:true});
 try{
  const sourceManifest=new Map<string,{receipt:Receipt;bodyHashVerified:true}>(),cache=new Map<string,unknown>(),issues:string[]=[];
  function retain(source:Receipt){if(source.simulated||ms(source.retrievedAt)>ms(at))throw new Error('NON_GENUINE_OR_FUTURE_SOURCE');if(!sourceManifest.has(hash(source))){const retained=db.prepare('SELECT body FROM source_receipts WHERE id=?').get(hash(source)) as {body:string}|undefined,raw=db.prepare('SELECT body FROM receipts WHERE hash=?').get(source.hash) as {body:string}|undefined;if(!retained||hash(JSON.parse(retained.body))!==hash(source)||!raw||hash(raw.body)!==source.hash)throw new Error('EXACT_SOURCE_RECEIPT_MISSING');sourceManifest.set(hash(source),{receipt:source,bodyHashVerified:true});}return source;}
  function rawPage(source:Receipt){retain(source);if(!cache.has(source.hash)){const raw=db.prepare('SELECT body FROM receipts WHERE hash=?').get(source.hash) as {body:string};cache.set(source.hash,JSON.parse(raw.body));}return cache.get(source.hash) as {data?:Record<string,unknown>[]};}
  const logs=(db.prepare('SELECT body FROM logs WHERE observed_at<=? ORDER BY observed_at,rowid').all(at) as {body:string}[]).map(r=>JSON.parse(r.body) as GameLog).filter(l=>!l.source.simulated&&l.event.league==='NBA');
  const rows:EnrichedGame[]=logs.map(log=>{
   for(const s of [log.source,...(log.supportingSources??[])])retain(s);const raw=Object.fromEntries(rawFields.map(k=>[k,null])) as RawFields;let rawRowId:string|null=null,rawSource:Receipt|null=null;const rowIssues:string[]=[];
   const page=rawPage(log.source),matches=Array.isArray(page.data)?page.data.filter(r=>{const game=r.game as {id?:number}|undefined,player=r.player as {id?:number}|undefined,team=r.team as {id?:number}|undefined;return`bdl:nba:game:${game?.id}`===log.event.id&&`bdl:nba:player:${player?.id}`===log.playerId&&`bdl:nba:team:${team?.id}`===log.teamId;}):[];
   if(matches.length===1){const r=matches[0];if(['pts','reb','ast','fg3m'].some((k,i)=>r[k]!==null&&r[k]!==undefined&&r[k]!==log.stats[(['points','rebounds','assists','threes'] as const)[i]]))throw new Error('RAW_NORMALIZED_STATS_DISAGREE');rawRowId=r.id===undefined?null:String(r.id);rawSource=log.source;
    for(const k of rawFields){const value=r[k];if(typeof value==='number'&&Number.isFinite(value)&&(k==='usage'||Number.isInteger(value))&&(k==='plus_minus'||value>=0))raw[k]=value;else if(value!==undefined&&value!==null)rowIssues.push(`invalid:${k}`);}
    if(raw.fga!==null&&raw.fgm!==null&&raw.fgm>raw.fga||raw.fta!==null&&raw.ftm!==null&&raw.ftm>raw.fta||raw.fg3a!==null&&log.stats.threes!==null&&log.stats.threes>raw.fg3a)throw new Error('IMPOSSIBLE_ATTEMPT_COUNTS');
   }else rowIssues.push(matches.length?'ambiguous_raw_identity':'raw_identity_not_found');
   return{log,raw,rawRowId,rawSource,issues:rowIssues};
  });
  const fixtures:FixtureEvidence[]=[];for(const row of db.prepare("SELECT key,value FROM meta WHERE key LIKE 'bdl:fixture:%' OR key LIKE 'live:fixture:%'").all() as {key:string;value:string}[]){const value=JSON.parse(row.value);try{const event=value.event??bdlEvent(value.body),source=value.source??value.receipt;retain(source);fixtures.push({event,source,status:value.status??value.body.status});}catch{issues.push(`unusable_fixture:${row.key}`);}}
  // Recover earlier fixture observations from retained responses, rather than
  // replacing their pregame clocks with the latest metadata checkpoint.
  const injuries:InjuryObservation[]=[];for(const row of db.prepare('SELECT body FROM source_receipts ORDER BY rowid').all()as{body:string}[]){const source=JSON.parse(row.body)as Receipt;if(source.provider!=='balldontlie'||source.simulated||ms(source.retrievedAt)>ms(at))continue;const path=new URL(source.endpoint).pathname;if(!['/nba/v1/games','/nba/v1/player_injuries'].includes(path))continue;const page=rawPage(source);for(const value of page.data??[]){if(path.endsWith('/games')){try{fixtures.push({event:bdlEvent(value),source,status:String(value.status)});}catch{issues.push('retained_fixture_missing_exact_identity_or_clock');}}else{const player=value.player as {id?:number;team_id?:number}|undefined;if(player?.id)injuries.push({playerId:`bdl:nba:player:${player.id}`,teamId:player.team_id?`bdl:nba:team:${player.team_id}`:null,status:typeof value.status==='string'?value.status:'unknown',description:typeof value.description==='string'?value.description:null,returnDate:typeof value.return_date==='string'?value.return_date:null,source,observedAt:source.retrievedAt,publishedAt:null});}}}
  const models=(db.prepare('SELECT at,body FROM research_models ORDER BY id').all() as {at:string;body:string}[]).map(r=>{const m=JSON.parse(r.body);return{prop:m.prop,artifact:m.artifact,artifactHash:m.artifactHash,registeredAt:m.registeredAt??r.at};});
  const roster:NonNullable<IntelligenceSnapshot['roster']>=[];for(const row of db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%'").all()as{value:string}[]){const r=JSON.parse(row.value),source=retain(r.source),page=rawPage(source),matches=(page.data??[]).filter(p=>`bdl:nba:player:${p.id}`===r.playerId&&`bdl:nba:team:${(p.team as {id?:number}|undefined)?.id??p.team_id}`===r.teamId);if(matches.length!==1)throw new Error('EXACT_ROSTER_IDENTITY_REQUIRED');roster.push({playerId:r.playerId,teamId:r.teamId,source});}
  const checkpoints=(db.prepare("SELECT key,value FROM meta WHERE key LIKE 'ingest:league:%' OR key LIKE 'bdl:fixture-window:%' OR key LIKE 'live:injuries%' OR key LIKE 'bdl:quarantine:%'").all() as {key:string;value:string}[]).map(r=>({key:r.key,value:JSON.parse(r.value)}));
  const base:Omit<IntelligenceSnapshot,'id'>={version:INTELLIGENCE_VERSION,capturedAt:at,sourceReference,rows,fixtures:[...new Map(fixtures.map(f=>[hash(f),f])).values()],roster,availability:[],injuries,exclusions:issues,models,checkpoints,sourceManifest:[...sourceManifest.values()]};
  // Injury-list absence has no positive availability semantics. Current BDL
  // injuries have no exact game-specific publication history to export as such.
  return validateSnapshot({...base,id:snapshotID(base)});
 }finally{db.close();}
}
