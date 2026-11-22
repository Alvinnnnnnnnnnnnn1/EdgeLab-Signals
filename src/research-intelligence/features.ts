import {hash,ms,type Event,type Prop,type GameLog} from '../core/domain';
import {preparedFeatures,type KnowledgeMode} from '../research/features';
import {unknownMetadata} from '../research/dataset';
import {predict} from '../research/models';
import {calibrateCDF} from '../research/calibration';
import {knownAt,receiptKnownAt,INTELLIGENCE_VERSION,type IntelligenceSnapshot,type EnrichedGame,type RawFields} from './types';

export const extraFeatureNames=['fgaPerMinute','threeAttemptsPerMinute','ftaPerMinute','assistsPerMinute','threeMakeRate','minutesVolatility','observedPlayedWithin36h','observedTeamGames7dLowerBound','paceProxy','opponentDefenseProxy','opponentCombinedMissedFGProxy','opponentAssistsAllowed','opponentThreeAttemptsAllowed','usageProxy','observedTeammatesOut','confirmedStarter','minutesLimit','gameCompetitiveness','defensiveMatchup'] as const;
export interface FeatureObservation {
 id:string;event:Event;playerId:string;teamId:string;prop:Prop;cutoff:string;mode:KnowledgeMode;sourceTimeVerified:boolean;productionEnabled:false;
 names:string[];values:(number|null)[];missing:string[];historyN:number;historyMean:number;historyVariance:number;role:string;
 outcome:{value:number;minutes:number;observedAt:string;sourceHash:string}|null;
 provenance:{snapshotId:string;priorPoolHash:string;historyIds:string[];opponentFixtures:string[];fixtureSourceHash:string|null;inputHash:string};
 deployed:{artifactHash:string;pmf:number[]}|null;
}
const average=(x:number[])=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const key=(r:EnrichedGame)=>`${r.log.event.id}:${r.log.playerId}:${r.log.source.hash}`;
const sum=(rows:EnrichedGame[],get:(r:EnrichedGame)=>number|null)=>{const xs=rows.map(get);return rows.length&&xs.every(x=>x!==null)?xs.reduce<number>((a,b)=>a+b!,0):null;};
function teamSummary(rows:EnrichedGame[],teamId:string){
 const own=rows.filter(r=>r.log.teamId===teamId),opp=rows.filter(r=>r.log.teamId!==teamId),ot=rows[0]?.log.research?.overtimePeriods;
 if(ot===undefined||ot===null||!own.length||!opp.length||rows.some(r=>!r.log.final||r.log.research?.overtimePeriods!==ot||r.log.participated!==true&&r.log.minutes!==0))return null;
 const duration=48+5*ot,m1=sum(own,r=>r.log.minutes),m2=sum(opp,r=>r.log.minutes);
 if(m1===null||m2===null||Math.abs(m1-5*duration)>2.5||Math.abs(m2-5*duration)>2.5)return null;
 const total=(team:EnrichedGame[],field:keyof RawFields)=>sum(team,r=>r.raw[field]),a=total(own,'fga'),b=total(opp,'fga'),ft1=total(own,'fta'),ft2=total(opp,'fta'),o1=total(own,'oreb'),o2=total(opp,'oreb'),t1=total(own,'turnover'),t2=total(opp,'turnover');
 const possessions=[a,b,ft1,ft2,o1,o2,t1,t2].every(v=>v!==null)?.5*(a!+.44*ft1!-o1!+t1!+b!+.44*ft2!-o2!+t2!):null;
 const oppPoints=sum(opp,r=>r.log.stats.points),made=total(opp,'fgm'),ownMade=total(own,'fgm');
 return{eventId:rows[0].log.event.id,startsAt:rows[0].log.event.startsAt,pace:possessions!==null&&possessions>0?possessions*48/duration:null,defense:possessions!==null&&possessions>0&&oppPoints!==null?100*oppPoints/possessions:null,missed:made!==null&&b!==null&&ownMade!==null&&a!==null?a-ownMade+b-made:null,assists:sum(opp,r=>r.log.stats.assists),threes:total(opp,'fg3a'),usageDenominator:a!==null&&ft1!==null&&t1!==null?a+.44*ft1+t1:null,duration};
}
export function featureGenerator(snapshot:IntelligenceSnapshot,mode:KnowledgeMode){
 if(mode!=='as-of')throw new Error('ORIGINAL_PREGAME_SOURCE_AVAILABILITY_REQUIRED');
 const sourceRows=snapshot.rows.map(r=>({log:r.log,metadata:r.log.research??unknownMetadata()})),original=preparedFeatures(sourceRows,mode),rawByKey=new Map(snapshot.rows.map(r=>[key(r),r]));
 const fixtureIndex=new Map<string,typeof snapshot.fixtures>();for(const f of snapshot.fixtures){const group=fixtureIndex.get(f.event.id)??[];group.push(f);fixtureIndex.set(f.event.id,group);}
 const indexed=snapshot.rows.map(r=>({r,start:ms(r.log.event.startsAt),observed:ms(r.log.observedAt),known:knownAt(r.log,r.rawSource),day:r.log.event.startsAt.slice(0,10)})),cache=new Map<string,{rows:EnrichedGame[];poolHash:string;teams:Map<string,NonNullable<ReturnType<typeof teamSummary>>[]>}>();
 function prior(cutoff:string){const day=cutoff.slice(0,10),time=ms(cutoff),cacheKey=cutoff;let value=cache.get(cacheKey);if(value)return value;
  const latest=new Map<string,typeof indexed[number]>();for(const r of indexed){if(r.day>=day||r.r.log.completedAt&&ms(r.r.log.completedAt)>=time||r.known>=time)continue;const id=`${r.r.log.event.id}:${r.r.log.playerId}`,old=latest.get(id);if(!old||old.observed<r.observed)latest.set(id,r);}
  const rows=[...latest.values()].sort((a,b)=>a.start-b.start||key(a.r).localeCompare(key(b.r))).map(r=>r.r),byEvent=new Map<string,EnrichedGame[]>(),teams=new Map<string,NonNullable<ReturnType<typeof teamSummary>>[]>();
  for(const r of rows){const group=byEvent.get(r.log.event.id)??[];group.push(r);byEvent.set(r.log.event.id,group);}
  for(const group of byEvent.values())for(const id of new Set(group.map(r=>r.log.teamId))){const result=teamSummary(group,id);if(result){const group=teams.get(id)??[];group.push(result);teams.set(id,group);}}
  value={rows,poolHash:hash(rows.map(key)),teams};cache.set(cacheKey,value);return value;
 }
 return(target:EnrichedGame|Pick<GameLog,'event'|'playerId'|'teamId'>,prop:Prop,asOf?:string):FeatureObservation|null=>{
  const l='log'in target?target.log:target,cutoff=asOf??l.event.startsAt;if(ms(cutoff)>ms(l.event.startsAt))return null;
  const outcome='log'in target&&target.log.final&&target.log.participated===true&&target.log.minutes!==null&&target.log.stats[prop]!==null?{value:target.log.stats[prop]!,minutes:target.log.minutes,observedAt:target.log.observedAt,sourceHash:target.log.source.hash}:null;
  const eventHash=hash(l.event),fixture=fixtureIndex.get(l.event.id)?.find(f=>hash(f.event)===eventHash&&receiptKnownAt(f.source)<ms(cutoff));
  if(mode==='as-of'&&!fixture)return null;
  const f=original(l,prop,cutoff);if(!f)return null;const p=prior(cutoff),history=f.history.map(r=>rawByKey.get(`${r.log.event.id}:${r.log.playerId}:${r.log.source.hash}`)!).filter(Boolean),recent=history.slice(-10);
  if(history.length!==f.history.length)throw new Error('EXACT_FEATURE_HISTORY_MAPPING');
  const minutes=sum(recent,r=>r.log.minutes),rate=(field:keyof RawFields)=>{const count=sum(recent,r=>r.raw[field]);return count!==null&&minutes!==null&&minutes>0?count/minutes:null;},threeAttempts=sum(recent,r=>r.raw.fg3a),threeMakes=sum(recent,r=>r.log.stats.threes),assist=sum(recent,r=>r.log.stats.assists),meanMinutes=average(recent.map(r=>r.log.minutes!))!,volatility=Math.sqrt(average(recent.map(r=>(r.log.minutes!-meanMinutes)**2))!);
  const opponent=l.teamId===l.event.homeId?l.event.awayId:l.event.homeId,context=(p.teams.get(opponent)??[]).slice(-10),ownContext=(p.teams.get(l.teamId)??[]).slice(-10),contextMean=(field:'pace'|'defense'|'missed'|'assists'|'threes')=>context.length>=3&&context.every(r=>r[field]!==null)?average(context.map(r=>r[field]!)):null;
  const usage=recent.map(r=>{const g=(p.teams.get(r.log.teamId)??[]).find(g=>g.eventId===r.log.event.id),a=r.raw.fga,ft=r.raw.fta,t=r.raw.turnover;return g?.usageDenominator&&r.log.minutes&&a!==null&&ft!==null&&t!==null?100*(a+.44*ft+t)*g.duration/(r.log.minutes*g.usageDenominator):null;});
  const availability=snapshot.availability.filter(a=>a.fixtureId===l.event.id&&a.teamId===l.teamId&&ms(a.observedAt)<ms(cutoff)&&receiptKnownAt(a.source)<ms(cutoff)&&(!a.sourceUpdatedAt||ms(a.sourceUpdatedAt)<ms(cutoff))&&ms(a.validUntil)>ms(cutoff));
  const latestAvailability=new Map<string,typeof availability[number]>();for(const a of availability.sort((a,b)=>ms(a.observedAt)-ms(b.observedAt)))latestAvailability.set(a.playerId,a);
  const self=latestAvailability.get(l.playerId),teammates=[...latestAvailability.values()].filter(a=>a.playerId!==l.playerId),ownGames=new Set(p.rows.filter(r=>r.log.teamId===l.teamId&&ms(cutoff)-ms(r.log.event.startsAt)<=7*86400000).map(r=>r.log.event.id));
  const extras:(number|null)[]=[rate('fga'),rate('fg3a'),rate('fta'),minutes&&assist!==null?assist/minutes:null,threeAttempts!==null&&threeMakes!==null?(threeMakes+.5)/(threeAttempts+1):null,volatility,Number(ms(cutoff)-ms(recent.at(-1)!.log.event.startsAt)<=36*3600000),ownGames.size,contextMean('pace'),contextMean('defense'),contextMean('missed'),contextMean('assists'),contextMean('threes'),usage.every(v=>v!==null)?average(usage as number[]):null,teammates.length?teammates.filter(a=>a.status==='out').length:null,self?.status==='confirmed-starter'?1:self?.status==='projected-starter'?null:null,self?.minutesLimit??null,null,null];
  const names=[...f.names,...extraFeatureNames],values=[...f.values,...extras],missing=names.filter((_,i)=>values[i]===null);
  missing.push('confirmed participation probability unavailable','observed team-game count is a lower bound; schedule completeness unverified','pace/defense/rebound values are complete-boxscore proxies, not tracking measurements');
  if(!ownContext.length)missing.push('No complete historical team boxscore');
  const counts=f.history.map(r=>r.log.stats[prop]!),historyMean=average(counts)!,historyVariance=counts.reduce((n,y)=>n+(y-historyMean)**2,0)/Math.max(1,counts.length-1),historyIds=history.map(key),opponentFixtures=context.map(r=>r.eventId);
  const inputs={snapshotId:snapshot.id,version:INTELLIGENCE_VERSION,mode,cutoff,playerId:l.playerId,event:l.event,names,values,priorPoolHash:p.poolHash,historyIds,opponentFixtures,fixtureSourceHash:fixture?.source.hash??null};
  const model=snapshot.models.find(m=>m.prop===prop),artifact=model?.artifact;let deployed:FeatureObservation['deployed']=null;
  if(mode==='as-of'&&artifact&&model&&ms(artifact.generatedAt)<ms(cutoff)&&ms(model.registeredAt)<ms(cutoff)&&artifact.calibrationBefore<cutoff.slice(0,10)&&artifact.selectedAt<cutoff.slice(0,10)){
   const prediction=predict(f,artifact.selected);if(prediction)deployed={artifactHash:model.artifactHash,pmf:calibrateCDF(prediction.pmf,artifact.calibration)};
  }
  return{id:hash([snapshot.id,l.event.id,l.playerId,prop,cutoff,mode]),event:l.event,playerId:l.playerId,teamId:l.teamId,prop,cutoff,mode,sourceTimeVerified:true,productionEnabled:false,names,values,missing,historyN:history.length,historyMean,historyVariance,role:f.minutes<15?'low-minutes':f.minutes<28?'rotation':'high-minutes',outcome,provenance:{snapshotId:snapshot.id,priorPoolHash:p.poolHash,historyIds,opponentFixtures,fixtureSourceHash:fixture?.source.hash??null,inputHash:hash(inputs)},deployed};
 };
}
export function historicalFeatures(snapshot:IntelligenceSnapshot,prop:Prop,mode:KnowledgeMode,guard:()=>void=()=>{}){
 const generate=featureGenerator(snapshot,mode),latest=new Map<string,EnrichedGame>();for(const r of snapshot.rows){const k=`${r.log.event.id}:${r.log.playerId}`,old=latest.get(k);if(!old||ms(old.log.observedAt)<ms(r.log.observedAt))latest.set(k,r);}
 const rows=[...latest.values()].filter(r=>r.log.final&&r.log.participated===true&&r.log.minutes!==null&&r.log.stats[prop]!==null&&['regular','playoffs'].includes(r.log.research?.phase??'unknown')).sort((a,b)=>ms(a.log.event.startsAt)-ms(b.log.event.startsAt)||key(a).localeCompare(key(b))),observations:FeatureObservation[]=[];
 for(const [i,r]of rows.entries()){if(i%128===0)guard();const f=generate(r,prop);if(f)observations.push(f);}
 return{version:INTELLIGENCE_VERSION,snapshotId:snapshot.id,prop,mode,productionEnabled:false,examined:rows.length,excluded:rows.length-observations.length,observations};
}
export function observePlayer(snapshot:IntelligenceSnapshot,eventId:string,playerId:string,prop:Prop,cutoff=snapshot.capturedAt){
 if(ms(cutoff)>ms(snapshot.capturedAt))throw new Error('OBSERVATION_CUTOFF_AFTER_SNAPSHOT');
 const fixture=snapshot.fixtures.filter(f=>f.event.id===eventId&&receiptKnownAt(f.source)<ms(cutoff)&&ms(cutoff)-receiptKnownAt(f.source)<=6*3600000&&ms(f.event.startsAt)>ms(cutoff)).sort((a,b)=>receiptKnownAt(b.source)-receiptKnownAt(a.source))[0];
 const roster=snapshot.roster?.filter(r=>r.playerId===playerId&&receiptKnownAt(r.source)<ms(cutoff)&&ms(cutoff)-receiptKnownAt(r.source)<=24*3600000);
 if(!fixture||/final|cancel|postpone|suspend|in.?progress/i.test(fixture.status)||roster?.length!==1||![fixture.event.homeId,fixture.event.awayId].includes(roster[0].teamId))throw new Error('CURRENT_EXACT_FIXTURE_AND_ROSTER_REQUIRED');
 const result=featureGenerator(snapshot,'as-of')({event:fixture.event,playerId,teamId:roster[0].teamId},prop,cutoff);if(!result)throw new Error('INSUFFICIENT_PRIOR_KNOWN_HISTORY');
 return{...result,participationProbability:null,limitations:['Observational features only; no recommendation or promotion','Active roster membership is not confirmation of participation'],rosterSource:roster[0].source};
}
