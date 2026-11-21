import { randomUUID } from 'node:crypto';
import { appendFileSync,existsSync,mkdirSync,renameSync,statSync } from 'node:fs';
import { z } from 'zod';
import { type Config } from '../core/config';
import { Store } from '../core/store';
import { ms,nowISO,hash,type Receipt,type Event } from '../core/domain';
import { JsonHTTP,ProviderError } from '../providers/http';
import { BDLProvider,bdlEvent } from '../providers/balldontlie';
import { bdlQuota,collectionPlan,pendingCollectionWindows } from './collection';
import { researchModels,freezeConditionalShadow,type RosterCandidate } from './shadow';
import { scoreProspective } from './prospective';
import { recordProspective } from './prospective';
import { loadEvidence } from '../providers/import';
import { enqueueResearchDigest,dispatchTelegramStatus,telegramBinding,Telegram } from '../core/telegram';
import { researchSchedule,nextRoutineAt,PREGAME_MINUTES,notificationWindow,localParts } from './schedule';
import type { reviewMarketReceipt } from './market-benchmarks';

type Job={id:string;kind:string;next_at:string;deadline:string|null;state:string;attempts:number;body:string;error:string|null};
const sourceJobs=new Set(['fixtures','roster','injuries','finals','history']);
const add=(at:string,seconds:number)=>new Date(ms(at)+seconds*1000).toISOString();
const tomorrow=(at:string)=>new Date(Date.parse(`${at.slice(0,10)}T00:00:00Z`)+86400000).toISOString();
function table(store:Store,name:string){return!!store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);}
function putJob(store:Store,id:string,kind:string,at:string,body:unknown={},deadline:string|null=null){store.db.prepare("INSERT OR IGNORE INTO research_jobs(id,kind,next_at,deadline,state,body) VALUES (?,?,?,?,'queued',?)").run(id,kind,at,deadline,JSON.stringify(body));}
function futureFixtures(store:Store,at:string){return(store.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:fixture:%'").all() as {value:string}[]).map(r=>JSON.parse(r.value) as {event:Event;source:Receipt;status:string}).filter(f=>ms(f.event.startsAt)>ms(at)&&f.status==='scheduled');}
function seedJobs(store:Store,config:Config,at:string){
  for(const kind of ['fixtures','roster','injuries','finals','score','monitor','digest'])putJob(store,kind,kind,at);
  if(config.research.historicalBackfill)putJob(store,'history','history',at);
  // Retire superseded queued stages without deleting their checkpoint/history.
  store.db.prepare("UPDATE research_jobs SET state='expired',error='Superseded by T-90/T-20 research schedule' WHERE kind='pregame' AND state IN ('queued','deferred') AND json_extract(body,?) NOT IN (90,20)").run('$.window');
  for(const f of futureFixtures(store,at))for(const [i,minutes] of PREGAME_MINUTES.entries()){
    const due=add(f.event.startsAt,-minutes*60),deadline=add(f.event.startsAt,-[20,2][i]*60),key=`${f.event.id}:${hash(f.event).slice(0,12)}:${minutes}`;
    putJob(store,`pregame:${key}`,'pregame',due,{event:f.event,source:f.source,window:minutes},deadline);
    for(const kind of ['fixtures','roster','injuries'])putJob(store,`pregame-source:${key}:${kind}`,kind,due,{pregame:{event:f.event,window:minutes}},deadline);
  }
}
export function liveStatus(store:Store,config:Config,at=nowISO()){
  const heartbeat=store.get<{at:string;state:string}>('live:worker'),last=store.get<Record<string,unknown>>('live:last-run');
  const count=(name:string)=>table(store,name)?Number((store.db.prepare(`SELECT count(*) AS n FROM ${name}`).get() as {n:number}).n):0;
  const verified=store.get<{at:string;binding:string}>('telegram:verification');
  const fixtures=store.get<{at:string}>('live:fixtures-complete'),roster=store.get<{at:string}>('live:roster-complete');
  const freshness=(value:{at:string}|null,hours:number)=>!value?'unverified':ms(at)-ms(value.at)>hours*3600000?'stale':'fresh';
  const tgVerified=!!verified&&verified.binding===telegramBinding()&&ms(verified.at)<=ms(at)&&ms(at)-ms(verified.at)<30*86400000&&!!process.env.TELEGRAM_CHAT_ID&&config.telegram.allowlist.includes(process.env.TELEGRAM_CHAT_ID);
  return{at,mode:config.operatingMode,researchActive:config.operatingMode!=='disabled'&&!!heartbeat&&['running','waiting'].includes(heartbeat.state)&&ms(at)-ms(heartbeat.at)<180000,scheduler:heartbeat?{...heartbeat,stale:ms(at)-ms(heartbeat.at)>=180000}:{state:'not_started',stale:true},
    lastRun:last,bdl:bdlQuota(store,config,at),fixtureDiscovery:fixtures,rosterDiscovery:roster,dataFreshness:{fixtures:freshness(fixtures,config.research.fixtureHours),roster:freshness(roster,config.research.rosterHours)},gap:store.get('live:gap'),models:count('research_models'),
    forecasts:{verifiedAvailability:count('prospective_forecasts'),conditionalShadow:count('shadow_forecasts')},modelPromoted:false,
    schedule:{...researchSchedule(at),notification:notificationWindow(at),deadlineTasks:table(store,'research_jobs')?store.db.prepare("SELECT kind,next_at,deadline,state,error FROM research_jobs WHERE deadline>? AND state IN ('queued','deferred') ORDER BY next_at LIMIT 8").all(at):[],pendingStatus:count('telegram_outbox')?Number((store.db.prepare("SELECT count(*) AS n FROM telegram_outbox WHERE kind='research-status' AND state IN ('pending','retryable_failed')").get() as {n:number}).n):0},
    marketBenchmarks:{primary:'sportsbet',optional:['tab','ladbrokes_au'],state:'prepared_unverified',recurringPaidRequests:false,review:store.get<ReturnType<typeof reviewMarketReceipt>>('markets:last-review')},
    marketStatus:'MARKET_DATA_NOT_AUTHORISED',telegram:{verified:tgVerified,statusEnabled:config.telegram.statusEnabled,qualifiedEnabled:false},qualifiedOpportunityAlerts:'disabled',nextDue:table(store,'research_jobs')?store.db.prepare("SELECT min(next_at) AS at FROM research_jobs WHERE state IN ('queued','deferred','running')").get():null};
}
export function livePlan(store:Store,config:Config,at=nowISO()){
  const jobs=table(store,'research_jobs')?store.db.prepare("SELECT id,kind,next_at,deadline,state,error FROM research_jobs ORDER BY next_at,id").all():[];
  return{state:'dry_run' as const,mode:'dry_run_no_network',at,schedule:researchSchedule(at),notifications:notificationWindow(at),configuredMode:config.operatingMode,maximumRequestsPerCycle:config.research.maxRequestsPerCycle,quota:bdlQuota(store,config,at),existingJobs:jobs,
    initialTasks:jobs.length?[]:['fixtures','roster','injuries','finals','score','monitor','digest',...(config.research.historicalBackfill?['history']:[])],marketStatus:'MARKET_DATA_NOT_AUTHORISED',qualifiedAlerts:false,sourcePriority:['current results and future fixtures','2025–26','2024–25'],telegramStatusOptIn:config.telegram.statusEnabled};
}

export async function liveOnce(store:Store,config:Config,options:{dryRun?:boolean;clock?:()=>string;http?:JsonHTTP;manual?:boolean;signal?:AbortSignal}={}){
  const clock=options.clock??nowISO,at=clock();if(options.dryRun)return livePlan(store,config,at);
  if(config.operatingMode==='disabled'&&!options.manual)return{state:'disabled',networkRequests:0};
  const lease=store.acquire('live-cycle',at,150);if(!lease)return{state:'busy',networkRequests:0};
  const total=()=>Number((store.db.prepare("SELECT count(*) AS n FROM quota WHERE provider='balldontlie'").get() as {n:number}).n),before=total();
  const counts={fixturesReviewed:0,playersExamined:0,predictionsGenerated:0,forecastsFrozen:0,forecastsGraded:0,playersExcluded:0,missingAvailability:0};
  const outcomes:{job:string;state:string;reason?:string}[]=[],sources:string[]=[],comparisons:unknown[]=[];let digest=false;
  const http=options.http??new JsonHTTP(store,config),bdl=new BDLProvider(http,store,config);
  function finish(job:Job,next:string,state='queued',body:unknown={},error:string|null=null){store.db.prepare('UPDATE research_jobs SET next_at=?,state=?,body=?,error=? WHERE id=?').run(next,state,JSON.stringify(body),error,job.id);}
  try{
    seedJobs(store,config,at);
    // All fixture stages share one in-flight source cursor. Migrate existing job
    // checkpoints once; never restart a league-wide roster for each fixture.
    for(const kind of ['fixtures','roster','injuries'])if(!store.get(`live:shared-cursor:${kind}`)){
      const old=store.db.prepare("SELECT body FROM research_jobs WHERE kind=? AND state IN ('queued','deferred','running') ORDER BY next_at,id").all(kind) as {body:string}[];
      const saved=old.map(r=>JSON.parse(r.body)).find(b=>b.cursor!==undefined);
      if(saved)store.set(`live:source-progress:${kind}`,{cursor:saved.cursor,seen:saved.seen,scope:saved.scope});
      store.set(`live:shared-cursor:${kind}`,true);
    }
    // Recover interrupted work through saved source cursors and immutable keys.
    store.db.prepare("UPDATE research_jobs SET state='queued',error='Recovered interrupted job' WHERE state='running'").run();
    const jobs=store.db.prepare("SELECT * FROM research_jobs WHERE state IN ('queued','deferred') AND next_at<=? ORDER BY deadline IS NULL,deadline,CASE kind WHEN 'fixtures' THEN 0 WHEN 'roster' THEN 1 WHEN 'injuries' THEN 2 WHEN 'finals' THEN 3 WHEN 'pregame' THEN 4 WHEN 'score' THEN 5 WHEN 'monitor' THEN 6 WHEN 'digest' THEN 7 ELSE 8 END,next_at LIMIT 40").all(at) as unknown as Job[];
    for(const job of jobs){
      if(options.signal?.aborted)break;
      const now=clock();if(!store.leaseValid('live-cycle',lease,now))throw new Error('Live cycle lease expired');
      if(job.deadline&&ms(now)>=ms(job.deadline)){finish(job,now,'expired',JSON.parse(job.body),'Missed pregame window or tip-off');outcomes.push({job:job.id,state:'expired'});continue;}
      const checkpoint=JSON.parse(job.body) as {cursor?:number;pregame?:{event:Event;window:number}};
      if(checkpoint.pregame){
        const event=checkpoint.pregame.event,current=store.get<{event:Event;status:string}>(`live:fixture:${event.id.split(':').at(-1)}`);
        if(!current||current.status!=='scheduled'||hash(current.event)!==hash(event)){finish(job,now,'expired',checkpoint,'Fixture canceled or rescheduled');continue;}
        const fresh=store.get<{at:string}>(`live:${job.kind}-complete`),ttl=job.kind==='roster'?24*3600:900;
        if(!store.get(`live:source-progress:${job.kind}`)&&fresh&&ms(fresh.at)<=ms(now)&&ms(now)-ms(fresh.at)<ttl*1000){finish(job,now,'complete',checkpoint,'Fresh source reused');continue;}
      }else if(job.kind!=='pregame'&&!researchSchedule(now).activeWindow){
        finish(job,nextRoutineAt(now),'deferred',checkpoint,'OUTSIDE_DAYTIME_RESEARCH_WINDOW');outcomes.push({job:job.id,state:'deferred',reason:'OUTSIDE_DAYTIME_RESEARCH_WINDOW'});continue;
      }
      if(!checkpoint.pregame&&['roster','injuries'].includes(job.kind)&&!futureFixtures(store,now).some(f=>ms(f.event.startsAt)-ms(now)<=72*3600000)){
        finish(job,researchSchedule(now).nextWindow,'deferred',checkpoint,'NO_UPCOMING_RELEVANT_FIXTURES');continue;
      }
      if(!checkpoint.pregame&&['fixtures','roster','injuries'].includes(job.kind)&&!store.get(`live:source-progress:${job.kind}`)){
        const fresh=store.get<{at:string}>(`live:${job.kind}-complete`),hours=job.kind==='fixtures'?config.research.fixtureHours:job.kind==='roster'?config.research.rosterHours:config.research.injuryHours;
        if(fresh&&ms(fresh.at)<=ms(now)&&ms(now)-ms(fresh.at)<hours*3600000){finish(job,nextRoutineAt(add(fresh.at,hours*3600)),'queued',checkpoint,'Fresh source reused');continue;}
      }
      if(job.kind==='finals'&&!(store.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:fixture:%'").all() as {value:string}[]).some(r=>{const f=JSON.parse(r.value) as {event:Event;status:string},age=ms(now)-ms(f.event.startsAt);return ['scheduled','final'].includes(f.status)&&age>=3*3600000&&age<=4*86400000;})){
        finish(job,researchSchedule(now).nextWindow,'deferred',checkpoint,'NO_KNOWN_COMPLETED_FIXTURES');continue;
      }
      if(sourceJobs.has(job.kind)){
        const quota=bdlQuota(store,config,now),cooldown=quota.lastRequestAt?Math.max(0,ms(quota.lastRequestAt)+quota.minIntervalSeconds*1000-ms(now)):0;
        const reason=!config.networkEnabled||!config.providers.balldontlie.enabled?'NETWORK_OR_SOURCE_DISABLED':quota.remaining===0?'BDL_DAILY_QUOTA_EXHAUSTED':total()-before>=config.research.maxRequestsPerCycle?'CYCLE_REQUEST_BUDGET':cooldown>0?'BDL_COOLDOWN':job.kind==='history'&&quota.remaining<=10?'RESERVED_DAILY_MAINTENANCE_CAPACITY':null;
        if(reason){const next=reason==='BDL_DAILY_QUOTA_EXHAUSTED'||reason==='RESERVED_DAILY_MAINTENANCE_CAPACITY'?tomorrow(now):add(now,reason==='BDL_COOLDOWN'?Math.ceil(cooldown/1000)+1:60);finish(job,next,'deferred',JSON.parse(job.body),reason);outcomes.push({job:job.id,state:'deferred',reason});continue;}
      }
      store.db.prepare("UPDATE research_jobs SET state='running',attempts=attempts+1 WHERE id=?").run(job.id);
      try{
        const body=JSON.parse(job.body) as {cursor?:number;seen?:number[];scope?:{from:string;to:string};epoch?:string;pregame?:{event:Event;window:number}};
        if(['fixtures','roster','injuries'].includes(job.kind)){
          const progress=store.get<{cursor?:number;seen?:number[];scope?:{from:string;to:string}}>(`live:source-progress:${job.kind}`);
          body.cursor=progress?.cursor;body.seen=progress?.seen;body.scope=progress?.scope;
          const expiredScope=job.kind==='fixtures'&&body.scope!==undefined&&body.scope.to<now.slice(0,10);
          const scope=expiredScope?{from:now.slice(0,10),to:add(now,3*86400).slice(0,10)}:body.scope??{from:now.slice(0,10),to:add(now,3*86400).slice(0,10)},query:Record<string,string>={per_page:'100',...(!expiredScope&&body.cursor?{cursor:String(body.cursor)}:{})};
          const endpoint=job.kind==='fixtures'?'/nba/v1/games':job.kind==='roster'?'/nba/v1/players/active':'/nba/v1/player_injuries';
          if(job.kind==='fixtures'){query.start_date=scope.from;query.end_date=scope.to;}
          const page=await http.get('balldontlie',endpoint,query,job.kind==='roster'?3600:900,0),parsed=z.object({data:z.array(z.unknown()),meta:z.object({next_cursor:z.number().int().positive().nullable().optional()})}).parse(page.body),cursor=parsed.meta.next_cursor??undefined;
          if(!expiredScope&&cursor!==undefined&&(cursor===body.cursor||body.seen?.includes(cursor)))throw new Error('Source pagination cursor cycle');sources.push(page.receipt.hash);
          for(const input of parsed.data){
            if(job.kind==='fixtures'){
              const game=z.object({id:z.number().int().positive(),status:z.string(),status_state:z.string().optional(),postponed:z.boolean().optional()}).passthrough().parse(input);
              try{const event=bdlEvent(input),status=game.postponed?'postponed':game.status_state??(game.status==='Final'?'final':'unknown');store.set(`live:fixture:${game.id}`,{event,source:page.receipt,status});store.set(`bdl:fixture:${game.id}`,{body:input,receipt:page.receipt});}catch{outcomes.push({job:`fixture:${game.id}`,state:'blocked',reason:'EXACT_START_OR_IDENTITY_MISSING'});}
            }else if(job.kind==='roster'){
              const p=z.object({id:z.number().int().positive(),first_name:z.string(),last_name:z.string(),team_id:z.number().int().positive().nullable().optional(),team:z.object({id:z.number().int().positive()}).nullable().optional()}).parse(input),team=p.team?.id??p.team_id;
              if(!team||p.team?.id&&p.team_id&&p.team.id!==p.team_id){counts.playersExcluded++;continue;}
              store.set(`live:roster:${p.id}`,{playerId:`bdl:nba:player:${p.id}`,player:`${p.first_name} ${p.last_name}`,teamId:`bdl:nba:team:${team}`,source:page.receipt,observedAt:page.receipt.retrievedAt});
            }else{
              const p=z.object({player:z.object({id:z.number().int().positive()}),status:z.string()}).parse(input);store.set(`live:injury:${p.player.id}`,{status:p.status,source:page.receipt,observedAt:page.receipt.retrievedAt});
            }
          }
          const interval=job.kind==='fixtures'?config.research.fixtureHours:job.kind==='roster'?config.research.rosterHours:config.research.injuryHours;
          if(cursor!==undefined){store.set(`live:source-progress:${job.kind}`,{cursor,seen:[...(expiredScope?[]:body.seen??[]),cursor],scope});finish(job,add(now,config.providers.balldontlie.minIntervalSeconds+1),'queued',body.pregame?{pregame:body.pregame}:{});}
          else{store.set(`live:source-progress:${job.kind}`,null);store.set(`live:${job.kind}-complete`,{at:page.receipt.retrievedAt,source:page.receipt});finish(job,body.pregame?now:nextRoutineAt(add(now,interval*3600)),body.pregame?'complete':'queued',body.pregame?{pregame:body.pregame}:{});}
        }else if(job.kind==='finals'){
          const scope=body.scope??{from:add(now,-3*86400).slice(0,10),to:add(now,-86400).slice(0,10)},season=Number(scope.to.slice(0,4))-(Number(scope.to.slice(5,7))<7?1:0),epoch=body.epoch??`${now.slice(0,10)}:${Math.floor(Number(now.slice(11,13))/6)}`;
          const result=await bdl.maintenanceStats(season,scope.from,scope.to,now,epoch);finish(job,result.complete?add(now,6*3600):add(now,config.providers.balldontlie.minIntervalSeconds+1),'queued',result.complete?{}:{scope,epoch});
          if(result.exclusions.length)outcomes.push({job:job.id,state:'partial',reason:`${result.exclusions.length} source rows excluded; originals retained`});
        }else if(job.kind==='history'){
          const plan=collectionPlan(store,config,now),pending=pendingCollectionWindows(store,[...plan.seasons.filter(s=>s.season===2026),...plan.seasons.filter(s=>s.season===2025),...plan.seasons.filter(s=>s.season===2024)].flatMap(s=>s.windows),now)[0];
          if(pending){const result=await bdl.leagueStats(pending.season,pending.from,pending.to,now);finish(job,add(now,60),'queued',{},result.exclusions.length?'Source exclusions require review':null);if(result.exclusions.length)finish(job,add(now,86400),'deferred',{},'SOURCE_ROWS_QUARANTINED');}else finish(job,add(now,86400));
        }else if(job.kind==='pregame'){
          const request=JSON.parse(job.body) as {event:Event;source:Receipt},current=store.get<{event:Event;source:Receipt;status:string}>(`live:fixture:${request.event.id.split(':').at(-1)}`);
          if(!current||hash(current.event)!==hash(request.event)||current.status!=='scheduled')throw new Error('Fixture changed or is not confirmed scheduled');
          counts.fixturesReviewed++;
          const players=(store.db.prepare("SELECT value FROM meta WHERE key LIKE 'live:roster:%'").all() as {value:string}[]).map(r=>JSON.parse(r.value) as RosterCandidate).filter(p=>[request.event.homeId,request.event.awayId].includes(p.teamId)&&ms(now)-ms(p.observedAt)<=24*3600000).map(p=>{const injury=store.get<{status:string;observedAt:string}>(`live:injury:${p.playerId.split(':').at(-1)}`);return{...p,injuryStatus:injury&&ms(now)-ms(injury.observedAt)<config.research.injuryHours*3600000?injury.status:null};});
          const models=researchModels(store);if(!models.length)throw new Error('No frozen provisional models registered');if(!players.length)throw new Error('No genuine current source-backed roster membership');
          let conditionalPlayers=players;
          if(config.operatingMode==='shadow'){
            const evidence=loadEvidence(config.evidenceFile,store,now),contexts=evidence.contexts.filter(c=>c.eventId===current.event.id&&players.some(p=>p.playerId===c.playerId&&p.teamId===c.teamId)&&!players.find(p=>p.playerId===c.playerId)?.injuryStatus?.toLowerCase().includes('out'));
            if(contexts.length){const strict=recordProspective(store,models,[current],contexts,now,clock);counts.forecastsFrozen+=strict.inserted;const registered=new Set((store.db.prepare('SELECT DISTINCT player_id FROM prospective_forecasts WHERE event_id=?').all(current.event.id) as {player_id:string}[]).map(r=>r.player_id));conditionalPlayers=players.filter(p=>!registered.has(p.playerId));}
          }
          const result=freezeConditionalShadow(store,current.event,current.source,conditionalPlayers,models,now,config.research.maxCandidatesPerFixture,config.operatingMode==='shadow',clock);counts.playersExamined+=result.examined;counts.predictionsGenerated+=result.generated;counts.forecastsFrozen+=result.inserted;counts.missingAvailability+=conditionalPlayers.slice(0,result.examined).filter(p=>p.injuryStatus?.toLowerCase()!=='out').length;counts.playersExcluded+=new Set(result.exclusions.map(e=>e.playerId)).size;comparisons.push(...result.disagreement);for(const e of result.exclusions)outcomes.push({job:e.playerId,state:'blocked',reason:e.reason});
          finish(job,now,'complete',request);
        }else if(job.kind==='score'||job.kind==='monitor'){
          const verified=scoreProspective(store,now),shadow=scoreProspective(store,now,'conditional-shadow');if(job.kind==='score'){const ids=[...verified.gradedIds,...shadow.gradedIds],previous=new Set(store.get<string[]>('live:graded-ids')??[]);counts.forecastsGraded+=ids.filter(id=>!previous.has(id)).length;store.set('live:graded-ids',[...new Set([...previous,...ids])]);}
          store.set(job.kind==='score'?'live:scoring':'live:monitoring',{at:now,verifiedAvailability:verified,conditionalShadow:shadow,qualifiedEligible:false});
          if(job.kind==='score')for(const report of [verified,shadow]){const{at:ignored,...content}=report;void ignored;store.db.prepare('INSERT OR IGNORE INTO research_grades VALUES (?,?,?,?)').run(hash(content),now,report.classification,JSON.stringify(report));}
          if(job.kind==='monitor')for(const group of [...verified.groups,...shadow.groups])store.set(`model-health:${group.id}`,{at:now,state:group.metrics&&group.baseline&&group.metrics.playerGames>=200&&group.metrics.crps>group.baseline.crps*1.05?'degraded':'provisional_unpromoted',qualifiedEligible:false});finish(job,add(now,6*3600));
        }else if(job.kind==='digest'){
          const local=localParts(now);digest=config.telegram.statusEnabled&&local.minutes>=config.telegram.digestHour*60&&store.get('live:digest-date')!==local.date;finish(job,researchSchedule(now).nextWindow);
        }
        outcomes.push({job:job.id,state:'processed'});
      }catch(e){
        const reason=e instanceof ProviderError?e.message:e instanceof Error&&/^No |^Fixture |^Source pagination/.test(e.message)?e.message:'SOURCE_SCHEMA_OR_RESEARCH_ERROR; original inputs retained';
        finish(job,add(now,job.deadline?60:3600),'deferred',JSON.parse(job.body),reason);outcomes.push({job:job.id,state:'failed',reason});
      }
    }
    const sourceEvidenceMissing=!store.get('live:fixtures-complete')||!store.get('live:roster-complete');
    const state=options.signal?.aborted?'interrupted':outcomes.some(o=>o.state==='failed')?'partial':outcomes.some(o=>o.state==='deferred')||sourceEvidenceMissing?'deferred':outcomes.length?'completed':'waiting',id=randomUUID();
    const run={id,at:clock(),startedAt:at,mode:config.operatingMode,manual:!!options.manual,state,...counts,networkRequests:total()-before,outcomes,comparisons,sourceHashes:sources,marketStatus:'MARKET_DATA_NOT_AUTHORISED',qualifiedOpportunities:0,qualifiedAlertsEnabled:false};
    store.db.prepare('INSERT INTO research_runs VALUES (?,?,?)').run(id,run.at,JSON.stringify(run));store.set('live:last-run',run);
    if(digest){enqueueResearchDigest(store,id,clock());store.set('live:digest-date',localParts(clock()).date);}
    // A queued overnight digest must drain at 07:00, independently of digest production.
    if(config.telegram.statusEnabled)await dispatchTelegramStatus(store,config,new Telegram(config,store,undefined,clock),{clock});
    return run;
  }catch(e){
    const id=randomUUID(),run={id,at:clock(),startedAt:at,mode:config.operatingMode,manual:!!options.manual,state:'failed',...counts,networkRequests:total()-before,outcomes,sourceHashes:sources,error:'Interrupted or failed cycle; successful original records retained',marketStatus:'MARKET_DATA_NOT_AUTHORISED',qualifiedOpportunities:0};
    store.db.prepare('INSERT INTO research_runs VALUES (?,?,?)').run(id,run.at,JSON.stringify(run));store.set('live:last-run',run);throw e;
  }finally{store.release('live-cycle',lease);}
}

export function researchLog(value:unknown){mkdirSync('.local/logs',{recursive:true,mode:0o700});const path='.local/logs/research.jsonl';if(existsSync(path)&&statSync(path).size>1_000_000)renameSync(path,`${path}.1`);appendFileSync(path,JSON.stringify(value)+'\n',{mode:0o600});}
export async function liveWorker(store:Store,readConfig:()=>Config,signal:AbortSignal){
  const start=nowISO(),lease=store.acquire('live-worker',start,150);if(!lease)throw new Error('An independent research worker is already active');
  try{while(!signal.aborted){const config=readConfig(),at=nowISO();if(config.operatingMode==='disabled')break;
      const previous=store.get<{at:string}>('live:worker');if(previous&&ms(at)-ms(previous.at)>180000)store.set('live:gap',{from:previous.at,to:at,reason:'Sleep, stopped process or outage; continuity unverified'});
      if(!store.renew('live-worker',lease,at,150))throw new Error('Research worker lease expired');
      store.set('live:worker',{at,state:'running'});try{const result=await liveOnce(store,config,{signal});researchLog({at:nowISO(),state:result.state,runId:'id' in result?result.id:null,networkRequests:'networkRequests' in result?result.networkRequests:0});}catch{researchLog({at:nowISO(),state:'cycle_error'});}
      store.set('live:worker',{at:nowISO(),state:'waiting'});await new Promise<void>(resolve=>{const timer=setTimeout(done,60000);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});
    }}finally{store.set('live:worker',{at:nowISO(),state:'stopped'});store.release('live-worker',lease);}
}
