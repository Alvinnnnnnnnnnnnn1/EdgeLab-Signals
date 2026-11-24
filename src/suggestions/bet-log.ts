import {existsSync} from 'node:fs';
import {Store,type Outcome} from '../core/store';
import {loadConfig} from '../core/config';
import {hash,ms,type Quote} from '../core/domain';
import {localParts} from '../research/schedule';
import {suggestions} from './engine';

export interface BetLogRow {id:string;at:string;date:string;eventId:string;playerId:string;player:string;fixture:string;startsAt:string;prop:string;side:string;line:number;odds:number;bookmaker:string;probability:number|null;result:'won'|'lost'|'push'|'void'|null;value:number|null;stakeAUD:5;profitAUD:number|null;cumulativeProfitAUD:number;cumulativeROI:number|null;model:string;modelVersion:string;artifactHash:string|null;forecastId:string|null;policy:string;quotedAt:string;retrievedAt:string;sourceProvider:string;sourceHash:string;sourceReceiptId:string;gradeId:string|null;gradeSourceHash:string|null;}
export function readBetLog(store:Store,at=new Date().toISOString()){
  const available=!!store.db.prepare("SELECT name FROM sqlite_master WHERE name='experimental_suggestions'").get(),grades=new Map<string,Outcome>();
  if(available)for(const row of store.db.prepare('SELECT body FROM experimental_grades ORDER BY at,rowid').all() as {body:string}[]){const g=JSON.parse(row.body) as Outcome;grades.set(g.signalId,g);}
  for(const g of store.outcomes())grades.set(g.signalId,g);
  const base:{id:string;at:string;quote:Quote;win:number|null;model:string;version:string;artifactHash:string|null;forecastId:string|null;policy:string}[]=[];
  if(available)for(const s of suggestions(store)){const artifact=s.forecast.inputs.artifact as {modelVersion?:string};base.push({id:s.id,at:s.at,quote:s.quote,win:s.win,model:s.forecast.model,version:artifact.modelVersion??'unknown',artifactHash:s.forecast.artifactHash,forecastId:s.forecastId,policy:s.forecast.policy});}
  // Historical genuine qualified issues also belong to the complete log. Their
  // immutable records and original analytical units are left untouched.
  for(const s of store.signals().filter(s=>!s.simulated)){const f=s.decision.forecast;base.push({id:s.id,at:s.issuedAt,quote:s.decision.quote,win:f?f.win/(1-(f.voidProbability??0)):null,model:f?.model??'unknown',version:f?.version??'unknown',artifactHash:f?.artifactHash??null,forecastId:null,policy:'qualified-legacy'});}
  base.sort((a,b)=>ms(a.at)-ms(b.at)||a.id.localeCompare(b.id));let cumulative=0,settled=0;
  const rows:BetLogRow[]=base.map(s=>{const q=s.quote,g=grades.get(s.id),profit=g?5*g.units:null;if(g){settled++;cumulative+=profit!;}
    return{id:s.id,at:s.at,date:localParts(s.at).date,eventId:q.event.id,playerId:q.playerId,player:q.player,fixture:`${q.event.away} at ${q.event.home}`,startsAt:q.event.startsAt,prop:q.prop,side:q.side,line:q.line,odds:q.decimalOdds,bookmaker:q.bookmaker,probability:s.win,result:g?.result??null,value:g?.value??null,stakeAUD:5,profitAUD:profit,cumulativeProfitAUD:cumulative,cumulativeROI:settled?cumulative/(settled*5):null,model:s.model,modelVersion:s.version,artifactHash:s.artifactHash,forecastId:s.forecastId,policy:s.policy,quotedAt:q.quotedAt,retrievedAt:q.retrievedAt,sourceProvider:q.source.provider,sourceHash:q.source.hash,sourceReceiptId:hash(q.source),gradeId:g?.id??null,gradeSourceHash:g?.evidence.source.hash??null};});
  return{at,rows,summary:{total:rows.length,won:rows.filter(r=>r.result==='won').length,lost:rows.filter(r=>r.result==='lost').length,pending:rows.length-settled,push:rows.filter(r=>r.result==='push').length,void:rows.filter(r=>r.result==='void').length,settled,profitAUD:cumulative,turnoverAUD:settled*5,roi:settled?cumulative/(settled*5):null}};
}
export function betLogSnapshot(){const config=loadConfig(),path=process.env.EDGELAB_DB||config.database,store=existsSync(path)?new Store(path,true):new Store(':memory:');try{return readBetLog(store);}finally{store.close();}}
export function betLogCSV(log:ReturnType<typeof readBetLog>){const cell=(value:unknown)=>{const raw=value===null||value===undefined?'':String(value),safe=typeof value==='string'&&/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(raw)?`'${raw}`:raw;return`"${safe.replaceAll('"','""')}"`;};
  const header=['Reference','Recommendation timestamp','Melbourne date','Fixture ID','Fixture','Game start','Player ID','Player','Market','Side','Line','Original Sportsbet odds','Model probability if plays','Result','Actual player statistic','Hypothetical A$ stake','Hypothetical A$ P/L','Cumulative hypothetical A$ P/L','Cumulative hypothetical ROI','Model','Model version','Artifact hash','Forecast ID','Policy version','Original market timestamp','Price retrieved at','Source provider','Source body hash','Source receipt ID','Grade ID','Grade source hash'];
  const multipleBooks=log.rows.some(r=>r.bookmaker!=='sportsbet');if(multipleBooks){header[11]='Original bookmaker odds';header.push('Bookmaker');}
  const rows=log.rows.map(r=>[r.id,r.at,r.date,r.eventId,r.fixture,r.startsAt,r.playerId,r.player,r.prop,r.side,r.line,r.odds,r.probability,r.result??'pending',r.value,5,r.profitAUD,r.cumulativeProfitAUD,r.cumulativeROI,r.model,r.modelVersion,r.artifactHash,r.forecastId,r.policy,r.quotedAt,r.retrievedAt,r.sourceProvider,r.sourceHash,r.sourceReceiptId,r.gradeId,r.gradeSourceHash,...(multipleBooks?[r.bookmaker]:[])]);return[header,...rows].map(row=>row.map(cell).join(',')).join('\r\n');}
