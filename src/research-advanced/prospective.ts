import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../core/store';
import {fixtureProof,rosterProof} from '../suggestions/forecasts';
import {hash,ms,nowISO,assertReceipt,eventSchema,quoteSchema,termsSchema,gameLogSchema,quoteFresh,type Receipt,type Prop,type Quote,type GameLog,type Event} from '../core/domain';
import {features,preparedFeatures} from '../research/features';
import {unknownMetadata} from '../research/dataset';
import {predict,modelSpec} from '../research/models';
import {calibrateCDF,type Calibration} from '../research/calibration';
import {summary} from '../research/distributions';
import {probabilities} from '../core/models';
import {scoreOne,scoreRows,type ScoredPrediction} from '../research/scoring';
import {thresholds} from '../research/experiment';
import {minutesDistribution,minuteMixture,attemptsMixture,fitMinutes,conditionalDispersion,type MinuteModel} from './models';
import {metricIntervals,HARDENING_VERSION} from './hardening';

const codeFiles=['src/research-advanced/prospective.ts','src/research-advanced/models.ts','src/research-advanced/hardening.ts','src/research/features.ts','src/research/models.ts','src/research/distributions.ts','src/research/calibration.ts','src/research/scoring.ts','src/core/domain.ts','src/core/models.ts'];
export function challengerCode(){return{commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),files:Object.fromEntries(codeFiles.map(p=>[p,hash(readFileSync(p,'utf8'))]))};}
export interface ChallengerParameters {minutes:MinuteModel;conditionalExcess:number;attemptExcess?:number;calibration:Calibration;algorithm:'minutes-hierarchical-nb'|'minutes-integrated-attempts';}
interface Artifact {id:string;at:string;trainingCutoff:string;prop:Prop;parameters:ChallengerParameters;trainingRefs:{id:string;bodyHash:string}[];fitProtocol:string;code:ReturnType<typeof challengerCode>;}
interface Registration {eventId:string;playerId:string;prop:Prop;artifactId:string;marketCandidateId?:string;}
const json=<T>(v:unknown):T=>JSON.parse(v as string);
const finite=(value:unknown):boolean=>typeof value==='number'?Number.isFinite(value):Array.isArray(value)?value.every(finite):value&&typeof value==='object'?Object.values(value).every(finite):true;
function retained(source:Store,r:Receipt,at:string){assertReceipt(r,at);if(!source.hasReceipt(r))throw new Error('EXACT_RETAINED_RECEIPT_REQUIRED');}
function transaction<T>(db:DatabaseSync,fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
export function productionDue(source:Store,at:string){const horizon=new Date(ms(at)+600000).toISOString();return !!source.db.prepare("SELECT id FROM recurring_market_jobs WHERE state='requesting' OR (state IN ('queued','deferred','observed') AND deadline>? AND due_at<=?) LIMIT 1").get(at,horizon)||!!source.db.prepare("SELECT id FROM research_jobs WHERE state='running' OR (state IN ('queued','deferred') AND deadline>? AND next_at<=?) LIMIT 1").get(at,horizon);}

/** A separate journal, never a migration of the production Store. No network,
 * outbox, recommendation or production model writes exist in this lifecycle. */
export class ChallengerJournal {
 readonly db:DatabaseSync;
 private loadedCode:ReturnType<typeof challengerCode>|null=null;
 constructor(path:string,private enabled=false,private clock=nowISO,private code=challengerCode,readOnly=false){
  if(readOnly){this.db=new DatabaseSync(path,{readOnly:true});return;}
  if(!enabled){this.db=new DatabaseSync(':memory:');return;}
  this.loadedCode=this.code();
  if(path!==':memory:'){
   if(!resolve(path).startsWith(resolve('.local')+'/')||!path.endsWith('/challenger.sqlite'))throw new Error('SEPARATE_PRIVATE_CHALLENGER_JOURNAL_REQUIRED');
   mkdirSync(dirname(path),{recursive:true,mode:0o700});
  }
  this.db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);
  if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('logs','experimental_suggestions','research_models')").get()){this.db.close();throw new Error('PRODUCTION_DATABASE_FORBIDDEN');}
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=100;
   CREATE TABLE IF NOT EXISTS challenger_artifacts(id TEXT PRIMARY KEY,at TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS challenger_predictions(id TEXT PRIMARY KEY,at TEXT NOT NULL,event_id TEXT NOT NULL,player_id TEXT NOT NULL,prop TEXT NOT NULL,artifact_id TEXT NOT NULL REFERENCES challenger_artifacts(id),body TEXT NOT NULL,UNIQUE(event_id,player_id,prop,artifact_id));
   CREATE TABLE IF NOT EXISTS challenger_grades(id TEXT PRIMARY KEY,prediction_id TEXT NOT NULL REFERENCES challenger_predictions(id),at TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS challenger_checks(prediction_id TEXT PRIMARY KEY REFERENCES challenger_predictions(id),sequence INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT,at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS challenger_grade_prediction ON challenger_grades(prediction_id,at);`);
  for(const table of ['challenger_artifacts','challenger_predictions','challenger_grades'])for(const operation of ['UPDATE','DELETE'])this.db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Challenger evidence is immutable'); END;`);
 }
 static review(path:string){return new ChallengerJournal(path,false,nowISO,challengerCode,true);}
 private active(){if(!this.enabled)throw new Error('CHALLENGER_DISABLED');}
 private sourceSeparate(source:Store){const a=this.db.prepare('PRAGMA database_list').get()!.file,b=source.db.prepare('PRAGMA database_list').get()!.file;if(a&&b&&resolve(String(a))===resolve(String(b)))throw new Error('SOURCE_MUST_BE_SEPARATE_READ_ONLY');}
 fitFromRetained(source:Store,prop:Prop,trainingCutoff:string,limit=1000){
  this.active();if(!Number.isInteger(limit)||limit<100||limit>1000)throw new Error('BOUNDED_TRAINING_REQUIRED');
  const logs=source.logs().filter(l=>!l.source.simulated&&l.final&&l.event.league==='NBA'&&ms(l.observedAt)<=ms(trainingCutoff)&&[l.source,...(l.supportingSources??[])].every(s=>ms(s.retrievedAt)<=ms(trainingCutoff))),latest=new Map<string,GameLog>();
  for(const l of logs){const key=hash([l.event.id,l.playerId]),old=latest.get(key);if(!old||old.observedAt<l.observedAt)latest.set(key,l);}
  const known=[...latest.values()].map(log=>({log,metadata:log.research??unknownMetadata()})),get=preparedFeatures(known,'as-of');
  const train=known.slice().sort((a,b)=>hash([a.log.event.id,a.log.playerId]).localeCompare(hash([b.log.event.id,b.log.playerId]))).flatMap(r=>{const f=get(r.log,prop);return f&&r.log.participated===true&&r.log.minutes!==null&&r.log.minutes>0&&r.log.stats[prop]!==null?[{f,y:r.log.stats[prop]!,minutes:r.log.minutes,row:r}]:[];}).slice(0,limit);
  if(train.length<100)throw new Error('INSUFFICIENT_GENUINE_TRAINING_HISTORY');
  const parameters:ChallengerParameters={algorithm:'minutes-hierarchical-nb',minutes:fitMinutes(train.map(r=>({f:r.f,y:r.minutes}))),conditionalExcess:conditionalDispersion(train),calibration:{method:'raw'}};
  if(prop==='threes'&&train.every(r=>r.row.metadata.threeAttempts!==null&&r.f.history.every(h=>h.metadata.threeAttempts!==null))){parameters.algorithm='minutes-integrated-attempts';parameters.attemptExcess=conditionalDispersion(train.map(r=>({...r,f:{...r.f,rate:r.f.history.reduce((n,h)=>n+h.metadata.threeAttempts!,0)/r.f.history.reduce((n,h)=>n+h.log.minutes!,0)},y:r.row.metadata.threeAttempts!})));}
  return this.publish(source,prop,trainingCutoff,parameters,known.map(r=>hash([r.log.event.id,r.log.playerId,r.log.source.hash])),'strict-history-as-of/1.4.6.1');
 }
 publish(source:Store,prop:Prop,trainingCutoff:string,parameters:ChallengerParameters,trainingIds:string[],fitProtocol='external-frozen-parameters'):Artifact{
  this.active();this.sourceSeparate(source);const at=this.clock(),code=this.code();if(hash(code)!==hash(this.loadedCode)||code.dirty||!/^[a-f0-9]{40}$/.test(code.commit)||ms(trainingCutoff)>=ms(at)||!trainingIds.length||trainingIds.length>20000||!finite(parameters))throw new Error('INVALID_FROZEN_ARTIFACT_OR_TRAINING_CLOCK');
  if(!['points','rebounds','assists','threes'].includes(prop)||!['minutes-hierarchical-nb','minutes-integrated-attempts'].includes(parameters.algorithm)||parameters.conditionalExcess<0||parameters.algorithm==='minutes-integrated-attempts'&&(prop!=='threes'||parameters.attemptExcess===undefined||parameters.attemptExcess<0))throw new Error('INVALID_MODEL_CONTRACT');
  const trainingRefs=[...new Set(trainingIds)].sort().map(id=>{const row=source.db.prepare('SELECT body FROM logs WHERE id=?').get(id);if(!row)throw new Error('TRAINING_INPUT_MISSING');const l=json<GameLog>(row.body);if(!l.final||ms(l.observedAt)>ms(trainingCutoff)||ms(l.event.startsAt)>=ms(trainingCutoff))throw new Error('TRAINING_INPUT_AFTER_CUTOFF');for(const s of [l.source,...(l.supportingSources??[])])retained(source,s,trainingCutoff);return{id,bodyHash:hash(row.body)};});
  const body={kind:HARDENING_VERSION,at,trainingCutoff,prop,parameters,trainingRefs,fitProtocol,code,productionEnabled:false},id=hash({kind:body.kind,trainingCutoff,prop,parameters,trainingRefs,fitProtocol,code}),record={...body,id};
  this.db.prepare('INSERT OR IGNORE INTO challenger_artifacts VALUES (?,?,?)').run(id,at,JSON.stringify(record));return json<Artifact>(this.db.prepare('SELECT body FROM challenger_artifacts WHERE id=?').get(id)!.body);
 }
 register(source:Store,request:Registration){
  this.active();this.sourceSeparate(source);const at=this.clock(),artifactRow=this.db.prepare('SELECT body FROM challenger_artifacts WHERE id=?').get(request.artifactId);if(!artifactRow)throw new Error('CHALLENGER_ARTIFACT_MISSING');const artifact=json<Artifact>(artifactRow.body);
  if(artifact.prop!==request.prop||ms(artifact.at)>ms(at)||hash(this.code())!==hash(artifact.code)||artifact.code.dirty)throw new Error('MODEL_CODE_OR_CUTOFF_CHANGED');
  for(const ref of artifact.trainingRefs){const row=source.db.prepare('SELECT body FROM logs WHERE id=?').get(ref.id);if(!row||hash(row.body)!==ref.bodyHash)throw new Error('FROZEN_TRAINING_INPUT_CHANGED');}
  const input=source.get<{event:Event;source:Receipt;status:string}>(`live:fixture:${request.eventId.split(':').at(-1)}`);if(!input||input.status!=='scheduled'||input.event.id!==request.eventId)throw new Error('EXACT_SCHEDULED_FIXTURE_REQUIRED');const event=eventSchema.parse(input.event);
  if(event.league!=='NBA'||ms(at)>=ms(event.startsAt)-120000)throw new Error('PREGAME_DEADLINE');fixtureProof(source,event,input.source,at);
  const roster=source.get<{playerId:string;teamId:string;source:Receipt;observedAt:string}>(`live:roster:${request.playerId.split(':').at(-1)}`);if(!roster||roster.playerId!==request.playerId||![event.homeId,event.awayId].includes(roster.teamId)||ms(roster.observedAt)>ms(at)||ms(at)-ms(roster.observedAt)>86400000)throw new Error('GENUINE_CURRENT_ROSTER_REQUIRED');rosterProof(source,roster,at);
  const raw=source.db.prepare("SELECT body FROM experimental_forecasts WHERE event_id=? AND player_id=? AND prop=? AND at<=? ORDER BY at DESC,id DESC LIMIT 1").get(event.id,request.playerId,request.prop,at);if(!raw)throw new Error('ORIGINAL_PRODUCTION_FORECAST_UNAVAILABLE');const baseline=json<any>(raw.body);
  if(hash(baseline.event)!==hash(event)||baseline.teamId!==roster.teamId||ms(baseline.at)>ms(at)||ms(baseline.inputs.cutoff)>ms(baseline.at)||baseline.inputHash!==hash(baseline.inputs)||hash(baseline.inputs.artifact)!==baseline.artifactHash||ms(baseline.inputs.artifact.generatedAt)>ms(baseline.at)||ms(baseline.at)>=ms(event.startsAt)-120000)throw new Error('INVALID_ORIGINAL_BASELINE');summary(baseline.distribution);
  const rows=source.logs().filter(l=>l.final).map(log=>({log,metadata:log.research??unknownMetadata()})),f=features(rows,{event,playerId:request.playerId,teamId:roster.teamId},request.prop,'as-of',at);if(!f)throw new Error('INSUFFICIENT_AS_OF_HISTORY');
  for(const id of baseline.inputs.inputRefs){const row=source.db.prepare('SELECT body FROM logs WHERE id=?').get(id);if(!row)throw new Error('BASELINE_INPUT_MISSING');const l=json<GameLog>(row.body);if(ms(l.observedAt)>ms(baseline.inputs.cutoff))throw new Error('FUTURE_BASELINE_INPUT');for(const s of [l.source,...(l.supportingSources??[])])retained(source,s,baseline.inputs.cutoff);}
  retained(source,baseline.inputs.fixtureSource,baseline.at);retained(source,baseline.inputs.rosterSource,baseline.at);
  const refs=new Map<string,{id:string;bodyHash:string;observedAt:string;sources:Receipt[]}>();for(const r of [...f.history,...f.leagueHistory,...f.opportunities]){const l=r.log;for(const s of [l.source,...(l.supportingSources??[])])retained(source,s,at);const id=hash([l.event.id,l.playerId,l.source.hash]),row=source.db.prepare('SELECT body FROM logs WHERE id=?').get(id);if(!row||ms(l.observedAt)>ms(at)||l.event.startsAt.slice(0,10)>=at.slice(0,10))throw new Error('UNAVAILABLE_FEATURE_EVIDENCE');refs.set(id,{id,bodyHash:hash(row.body),observedAt:l.observedAt,sources:[l.source,...(l.supportingSources??[])]});}
  const minutes=minutesDistribution(f,artifact.parameters.minutes,'hierarchical'),rawP=artifact.parameters.algorithm==='minutes-integrated-attempts'?attemptsMixture(f,minutes,artifact.parameters.attemptExcess!):minuteMixture(f,minutes,artifact.parameters.conditionalExcess);if(!rawP)throw new Error('VERIFIED_ATTEMPTS_UNAVAILABLE');const distribution=calibrateCDF(rawP,artifact.parameters.calibration);summary(distribution);
  const simple=predict(f,modelSpec('ewa'))!.pmf,hierarchical=predict(f,modelSpec('hierarchical-nb'))!.pmf,market=request.marketCandidateId?this.captureMarket(source,request.marketCandidateId,event,request,at):null;
  const frozenAt=this.clock();if(ms(frozenAt)<ms(at)||ms(frozenAt)-ms(at)>10000||ms(frozenAt)>=ms(event.startsAt)-120000)throw new Error('REGISTRATION_CROSSED_DEADLINE');
  const body={kind:HARDENING_VERSION,at:frozenAt,event,playerId:request.playerId,teamId:roster.teamId,prop:request.prop,artifact,inputs:{asOf:at,fixtureSource:input.source,roster,features:f.values,featureNames:f.names,history:[...refs.values()]},distribution,minutesDistribution:minutes,baselines:{production:{id:baseline.id,bodyHash:hash(raw.body),at:baseline.at,inputs:baseline.inputs,artifactHash:baseline.artifactHash,distribution:baseline.distribution,minutes:baseline.expectedMinutes},simple,hierarchical},market,conditionalOnParticipating:true,participationProbability:null,promotionEligible:false,productionEnabled:false};
  const id=hash([HARDENING_VERSION,event.id,request.playerId,request.prop,artifact.id]),record={...body,id,inputHash:hash(body)};
  const stillCurrent=()=>{const fixture=source.get<{event:Event;status:string}>(`live:fixture:${request.eventId.split(':').at(-1)}`),player=source.get<{playerId:string;teamId:string}>(`live:roster:${request.playerId.split(':').at(-1)}`);if(!fixture||fixture.status!=='scheduled'||hash(fixture.event)!==hash(event)||!player||player.playerId!==request.playerId||player.teamId!==roster.teamId)throw new Error('FIXTURE_OR_ROSTER_CHANGED_DURING_REGISTRATION');};
  return transaction(this.db,()=>{stillCurrent();if(ms(this.clock())>=ms(event.startsAt)-120000)throw new Error('PREGAME_DEADLINE');const existing=this.db.prepare('SELECT body FROM challenger_predictions WHERE id=?').get(id);if(existing)return{inserted:false,record:json<any>(existing.body)};this.db.prepare('INSERT INTO challenger_predictions VALUES (?,?,?,?,?,?,?)').run(id,frozenAt,event.id,request.playerId,request.prop,artifact.id,JSON.stringify(record));stillCurrent();if(ms(this.clock())>=ms(event.startsAt)-120000)throw new Error('PREGAME_DEADLINE');return{inserted:true,record};});
 }
 private captureMarket(source:Store,id:string,event:Event,request:Registration,at:string){
  const row=source.db.prepare('SELECT body FROM experimental_candidates WHERE id=?').get(id);if(!row)throw new Error('OBSERVED_MARKET_MISSING');const candidate=json<any>(row.body),q=quoteSchema.parse(candidate.quote);
  if(ms(q.mappingProof.event.verifiedAt)>ms(at)||ms(q.mappingProof.player.verifiedAt)>ms(at)||ms(candidate.at)>ms(at)||hash(q.event)!==hash(event)||q.playerId!==request.playerId||q.prop!==request.prop||q.bookmaker!=='sportsbet'||!quoteFresh(q,at))throw new Error('INVALID_ORIGINAL_MARKET');
  const pairs=source.db.prepare("SELECT body FROM experimental_candidates WHERE json_extract(body,'$.quote.event.id')=? AND json_extract(body,'$.quote.playerId')=? AND json_extract(body,'$.quote.prop')=? AND json_extract(body,'$.quote.line')=? AND json_extract(body,'$.quote.side')!=?").all(event.id,q.playerId,q.prop,q.line,q.side).map(r=>json<any>(r.body)).filter(r=>ms(r.at)<=ms(at)&&r.quote.bookmaker===q.bookmaker&&r.quote.teamId===q.teamId&&r.quote.termsId===q.termsId&&r.quote.source.hash===q.source.hash&&r.quote.quotedAt===q.quotedAt);
  const distinct=new Map(pairs.map(r=>[hash(r.quote),r]));if(distinct.size!==1)throw new Error('EXACT_TWO_SIDED_MARKET_REQUIRED');const pair=quoteSchema.parse([...distinct.values()][0].quote);if(hash(pair.event)!==hash(q.event))throw new Error('OPPOSITE_FIXTURE_REVISION');if(!quoteFresh(pair,at))throw new Error('STALE_OPPOSITE_PRICE');
  const terms=source.get<{terms:{id:string;source:Receipt}[]}>('suggestions:terms')?.terms.filter(t=>t.id===q.termsId)??[];if(terms.length!==1)throw new Error('ORIGINAL_TERMS_REQUIRED');const verifiedTerms=termsSchema.parse(terms[0]);if(verifiedTerms.prop!==q.prop||verifiedTerms.league!=='NBA'||verifiedTerms.bookmaker!=='sportsbet')throw new Error('SETTLEMENT_TERMS_MISMATCH');for(const s of [q.source,pair.source,q.mappingProof.event.source,q.mappingProof.player.source,terms[0].source])retained(source,s,at);
  return{quote:q,opposite:pair,terms:verifiedTerms,candidateId:id,fair:(1/q.decimalOdds)/(1/q.decimalOdds+1/pair.decimalOdds),independentBookmakers:false};
 }
 grade(source:Store,limit=50){
  this.active();this.sourceSeparate(source);if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('BOUNDED_GRADING_REQUIRED');let inserted=0;const held:{id:string;reason:string}[]=[];
  // Order least-recently reconciled first, so repeated bounded cycles cannot starve later IDs.
  const records=this.db.prepare('SELECT p.body FROM challenger_predictions p LEFT JOIN challenger_checks c ON c.prediction_id=p.id ORDER BY c.sequence IS NOT NULL,c.sequence,p.at,p.id LIMIT ?').all(limit);
  for(const row of records){const p=json<any>(row.body),at=this.clock();let checkState='resolved',checkReason:string|null=null;try{
   const {id:predictionId,inputHash,...frozen}=p;if(hash(frozen)!==inputHash)throw new Error('FROZEN_PREDICTION_HASH_MISMATCH');
   const finals=source.db.prepare('SELECT body FROM logs WHERE event_id=? AND player_id=? AND observed_at<=? ORDER BY observed_at DESC,rowid DESC').all(p.event.id,p.playerId,at).map(r=>gameLogSchema.parse(json<GameLog>(r.body))).filter(l=>l.final),l=finals[0];
   if(!l||l.participated===null||l.participated===true&&l.stats[p.prop as Prop]===null)throw new Error('FINAL_STAT_OR_PARTICIPATION_UNRESOLVED');
   if(l.teamId!==p.teamId||l.event.league!==p.event.league||l.event.season!==p.event.season||l.event.homeId!==p.event.homeId||l.event.awayId!==p.event.awayId||Math.abs(ms(l.event.startsAt)-ms(p.event.startsAt))>300000||ms(l.observedAt)<=ms(p.event.startsAt)||ms(p.at)>=ms(l.event.startsAt))throw new Error('EXACT_FINAL_IDENTITY_REQUIRED');
   if(finals.some(other=>other.observedAt===l.observedAt&&hash([other.minutes,other.stats,other.participated])!==hash([l.minutes,l.stats,l.participated])))throw new Error('AMBIGUOUS_FINAL_REVISION');
   for(const s of [l.source,...(l.supportingSources??[])]){retained(source,s,at);if(ms(s.retrievedAt)<=ms(p.at))throw new Error('FINAL_SOURCE_NOT_AFTER_PREDICTION');}
   const value=l.participated===true?l.stats[p.prop as Prop]:null,common={id:p.id,date:p.event.startsAt.slice(0,10),fixture:p.event.id,season:p.event.season,player:p.playerId,team:p.teamId,lowMinute:false,y:value!},models=value===null?null:Object.fromEntries([['challenger',p.distribution],['production',p.baselines.production.distribution],['simple',p.baselines.simple],['hierarchical',p.baselines.hierarchical]].map(([name,pmf])=>[name,scoreOne(pmf as number[],value,thresholds.NBA[p.prop as Prop])])),market=value===null||!p.market?null:(()=>{const q=p.market.quote as Quote,win=value===q.line?null:q.side==='over'?value!>q.line:value!<q.line,prob=probabilities(p.distribution,q.line,q.side),decisive=prob.push<1?prob.win/(1-prob.push):null;return{line:q.line,side:q.side,quoteTime:q.quotedAt,price:q.decimalOdds,push:win===null,fair:p.market.fair,challenger:decisive,result:win===null?'push':win?'won':'lost',brier:win===null||decisive===null?null:(decisive-Number(win))**2,marketBrier:win===null?null:(p.market.fair-Number(win))**2};})();
   const body={predictionId,at,sourceEvidence:l,evidenceHash:hash(l),status:value===null?'void':'settled',value,models,market,minutes:l.participated===true&&l.minutes!==null?{actual:l.minutes,productionAbsoluteError:Math.abs(p.baselines.production.minutes-l.minutes),challengerAbsoluteError:Math.abs(summary(p.minutesDistribution).mean-l.minutes),score:scoreOne(p.minutesDistribution,Math.round(l.minutes),[9.5,24.5,47.5])}:null,common,promotionEligible:false},id=hash([predictionId,body.evidenceHash]);
   inserted+=Number(this.db.prepare('INSERT OR IGNORE INTO challenger_grades VALUES (?,?,?,?)').run(id,predictionId,at,JSON.stringify({...body,id})).changes);
  }catch(e){checkState='held';checkReason=(e as Error).message;held.push({id:p.id,reason:checkReason});}finally{this.db.prepare('INSERT INTO challenger_checks VALUES (?,(SELECT COALESCE(max(sequence),0)+1 FROM challenger_checks),?,?,?) ON CONFLICT(prediction_id) DO UPDATE SET sequence=excluded.sequence,state=excluded.state,reason=excluded.reason,at=excluded.at').run(p.id,checkState,checkReason,at);}}
  return{inserted,held,networkRequests:0,outboundMessages:0};
 }
 comparison(){
  if(!this.db.prepare("SELECT name FROM sqlite_master WHERE name='challenger_predictions'").get())return{state:'disabled_or_uninitialised',pending:null,voids:null,groups:[],promotionEligible:false};
  const groups=new Map<string,{prop:Prop;models:Record<string,ScoredPrediction[]>;markets:any[];minutes:any[]}>();let pending=0,voids=0,unsupportedMarket=0;const held:{id:string;reason:string;at:string}[]=[];
  for(const row of this.db.prepare('SELECT body FROM challenger_predictions ORDER BY at,id').all()){
   const p=json<any>(row.body),check=this.db.prepare('SELECT state,reason,at FROM challenger_checks WHERE prediction_id=?').get(p.id);if(check?.state==='held'){pending++;held.push({id:p.id,reason:String(check.reason),at:String(check.at)});continue;}const gRow=this.db.prepare('SELECT body FROM challenger_grades WHERE prediction_id=? ORDER BY at DESC,rowid DESC LIMIT 1').get(p.id);if(!gRow){pending++;continue;}const g=json<any>(gRow.body);if(g.status==='void'){voids++;continue;}
   const key=p.artifact.id,group:{prop:Prop;models:Record<string,ScoredPrediction[]>;markets:any[];minutes:any[]}=groups.get(key)??{prop:p.prop,models:{challenger:[],production:[],simple:[],hierarchical:[]},markets:[],minutes:[]};
   if(g.market&&!g.market.push){if(Number.isFinite(g.market.brier))group.markets.push({...g.market,fixture:g.common.fixture,date:g.common.date});else unsupportedMarket++;}if(g.minutes)group.minutes.push(g.minutes);
   for(const name of Object.keys(group.models))group.models[name].push({...g.common,pmf:name==='challenger'?p.distribution:name==='production'?p.baselines.production.distribution:p.baselines[name]});groups.set(key,group);
  }
  return{version:HARDENING_VERSION,pending,voids,held,unsupportedMarket,groups:[...groups].map(([artifact,g])=>({artifact,prop:g.prop,minutes:{n:g.minutes.length,challengerMAE:g.minutes.length?g.minutes.reduce((n,r)=>n+r.challengerAbsoluteError,0)/g.minutes.length:null,productionMAE:g.minutes.length?g.minutes.reduce((n,r)=>n+r.productionAbsoluteError,0)/g.minutes.length:null},market:{matchedDecisive:g.markets.length,fixtures:new Set(g.markets.map(r=>r.fixture)).size,dates:new Set(g.markets.map(r=>r.date)).size,challengerBrier:g.markets.length?g.markets.reduce((n,r)=>n+r.brier,0)/g.markets.length:null,fairMarketBrier:g.markets.length?g.markets.reduce((n,r)=>n+r.marketBrier,0)/g.markets.length:null},metrics:Object.fromEntries(Object.entries(g.models).map(([n,r])=>[n,scoreRows(r,thresholds.NBA[g.prop])])),pairedDate:metricIntervals(g.models.challenger,g.models.production,thresholds.NBA[g.prop],'date'),pairedFixture:metricIntervals(g.models.challenger,g.models.production,thresholds.NBA[g.prop],'fixture')})),promotionEligible:false,limitation:'Per-artifact comparisons; overlapping model versions and props are correlated. No automatic winner or profitability claim.'};
 }
 close(){this.db.close();}
}
export function challengerCycle(journal:ChallengerJournal,source:Store,requests:Registration[],options:{enabled?:boolean;budgetMs?:number;clock?:()=>string}={}){
 if(!options.enabled)return{state:'disabled',registered:0,networkRequests:0,outboundMessages:0};
 const clock=options.clock??nowISO,start=Date.now(),budget=Math.min(2000,Math.max(100,options.budgetMs??1000)),results:unknown[]=[];
 for(const request of requests.slice(0,2)){if(Date.now()-start>=budget||productionDue(source,clock()))return{state:'yielded_to_production',results};try{results.push(journal.register(source,request));}catch(e){results.push({reason:(e as Error).message});}}
 if(Date.now()-start>=budget||productionDue(source,clock()))return{state:'yielded_to_production',results};return{state:'completed',results,grading:journal.grade(source,10),networkRequests:0,outboundMessages:0};
}
