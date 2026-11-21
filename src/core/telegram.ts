import { z } from 'zod';
import type { Config } from './config';
import { Store,type Signal } from './store';
import { hash,ms,nowISO } from './domain';
import { TransportFailure,type NotificationTransport } from './messaging';
import type { Fetcher } from '../providers/http';

export class TelegramFailure extends TransportFailure {constructor(kind:string,uncertain:boolean,public retryAfter:number|null=null){super(kind,uncertain);}}
export const telegramBinding=()=>hash([process.env.TELEGRAM_BOT_TOKEN??'',process.env.TELEGRAM_CHAT_ID??'']);
export class Telegram implements NotificationTransport{
  constructor(private config:Config,private store:Store,private fetcher:Fetcher=fetch,private clock=nowISO){}
  private async request(method:'getMe'|'getChat'|'sendMessage',body:unknown={}){
    const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw new TelegramFailure('telegram_credentials_missing',false);
    const sending=method==='sendMessage';
    try{
      const response=await this.fetcher(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
      const data=await response.json() as {ok?:boolean;result?:unknown;error_code?:number;parameters?:{retry_after?:number}};
      if(!response.ok||data.ok!==true){const code=Number.isInteger(data.error_code)?data.error_code!:response.status;if(code===429){const delay=data.parameters?.retry_after;throw new TelegramFailure('telegram_rate_limited',false,Math.max(1,Math.min(3600,typeof delay==='number'&&Number.isFinite(delay)?delay:60)));}throw new TelegramFailure(`telegram_rejected_${code}`,sending&&code>=500);}
      return data.result;
    }catch(e){if(e instanceof TelegramFailure)throw e;throw new TelegramFailure('telegram_transport_or_parse_failure',sending);}
  }
  private destination(){const chat=process.env.TELEGRAM_CHAT_ID;if(!chat||!this.config.telegram.allowlist.includes(chat)||! /^[1-9]\d*$/.test(chat))throw new TelegramFailure('telegram_private_destination_not_allowlisted',false);return chat;}
  async verify(){
    if(!this.config.networkEnabled)throw new TelegramFailure('network_disabled',false);const chat=this.destination();
    const bot=await this.request('getMe') as {id?:number;is_bot?:boolean};if(bot?.is_bot!==true||!Number.isSafeInteger(bot.id))throw new TelegramFailure('telegram_bot_verification_failed',false);
    const destination=await this.request('getChat',{chat_id:chat}) as {id?:number;type?:string};
    if(destination?.type!=='private'||String(destination.id)!==chat)throw new TelegramFailure('telegram_private_destination_verification_failed',false);
    const result={binding:telegramBinding(),at:this.clock(),verified:true,privateDestination:true};this.store.set('telegram:verification',result);return result;
  }
  verified(at=this.clock()){
    const v=this.store.get<{binding:string;at:string}>('telegram:verification');
    return!!process.env.TELEGRAM_BOT_TOKEN&&!!process.env.TELEGRAM_CHAT_ID&&this.config.telegram.allowlist.includes(process.env.TELEGRAM_CHAT_ID)&&!!v&&v.binding===telegramBinding()&&ms(v.at)<=ms(at)&&ms(at)-ms(v.at)<30*86400000;
  }
  private async submit(text:string){
    if(!this.config.networkEnabled||!this.verified())throw new TelegramFailure('telegram_unverified_or_network_disabled',false);
    const chat=this.destination(),data=await this.request('sendMessage',{chat_id:chat,text,protect_content:true}) as {message_id?:number;chat?:{id?:number;type?:string}};
    if(!Number.isSafeInteger(data?.message_id)||String(data.chat?.id)!==chat||data.chat?.type!=='private')throw new TelegramFailure('telegram_submission_identity_uncertain',true);
    return{guid:String(data.message_id),deliveredAt:null};
  }
  async send(signal:Signal,text:string){
    if(signal.simulated||!signal.decision.qualified||!this.config.deliveryEnabled||!this.config.telegram.qualifiedEnabled||this.config.operatingMode!=='qualified')throw new TelegramFailure('qualified_telegram_disabled_or_ineligible',false);
    return this.submit(text);
  }
  async status(){return{deliveredAt:null,failed:false};} // Bot API has no device delivery/read receipt.
  async sendResearch(text:string,canary=false){if(!canary&&!this.config.telegram.statusEnabled)throw new TelegramFailure('research_status_delivery_disabled',false);return this.submit(text);}
}

const digestSchema=z.object({fixtures:z.number().int().nonnegative(),players:z.number().int().nonnegative(),frozen:z.number().int().nonnegative(),graded:z.number().int().nonnegative(),excluded:z.number().int().nonnegative()}).strict();
export function enqueueResearchDigest(store:Store,runId:string,at=nowISO()){
  const row=store.db.prepare('SELECT body FROM research_runs WHERE id=?').get(runId) as {body:string}|undefined;if(!row)throw new Error('Genuine research journal required for digest');
  const r=JSON.parse(row.body),d=digestSchema.parse({fixtures:r.fixturesReviewed,players:r.playersExamined,frozen:r.forecastsFrozen,graded:r.forecastsGraded,excluded:r.playersExcluded});
  const text=['EdgeLab Signals — NBA Research',`Cycle: ${r.state}`,`Fixtures reviewed: ${d.fixtures}`,`Players examined: ${d.players}`,`Forecasts frozen: ${d.frozen}`,`Forecasts graded: ${d.graded}`,`Excluded: ${d.excluded}`,'Qualified opportunities: 0',`Model status: ${String(r.mode??'research').toUpperCase()} / NOT PROMOTED`,`Market evidence: ${r.marketStatus}`,'Research status only; no betting recommendation.'].join('\n');
  return enqueueTelegram(store,'research-status',hash(['daily-digest',new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at)),telegramBinding()]),text,at);
}
function enqueueTelegram(store:Store,kind:'test'|'research-status',id:string,text:string,at:string){
  store.db.prepare("INSERT OR IGNORE INTO telegram_outbox(id,kind,state,next_at,binding,body,created_at) VALUES (?,?,'pending',?,?,?,?)").run(id,kind,at,telegramBinding(),JSON.stringify({text}),at);return id;
}
export function enqueueTelegramCanary(store:Store,at=nowISO()){
  return enqueueTelegram(store,'test',hash(['v14-integrated-canary',telegramBinding()]),'EdgeLab Signals — Telegram research transport test\nIntegrated outbox canary. Research-status delivery remains opt-in. Qualified opportunity alerts are disabled. Provider acceptance is not device delivery confirmation.',at);
}
export async function dispatchTelegramStatus(store:Store,config:Config,transport=new Telegram(config,store),options:{canaryId?:string;clock?:()=>string}={}){
  const clock=options.clock??nowISO,lease=store.acquire('telegram-status',clock(),60);if(!lease)return{accepted:0,state:'busy'};
  let accepted=0;
  try{
    // An interrupted send has an unknown outcome. Telegram cannot reconcile it.
    store.db.prepare("UPDATE telegram_outbox SET state='uncertain',error='Interrupted send; no blind resend' WHERE state='sending'").run();
    const rows=store.db.prepare("SELECT * FROM telegram_outbox WHERE state IN ('pending','retryable_failed') AND next_at<=? ORDER BY created_at LIMIT 5").all(clock()) as {id:string;kind:string;attempts:number;binding:string;body:string}[];
    for(const row of rows){
      if(!store.renew('telegram-status',lease,clock(),60))break;
      const canary=row.kind==='test'&&row.id===options.canaryId;if(row.kind==='test'&&!canary||row.kind==='research-status'&&!config.telegram.statusEnabled||row.binding!==telegramBinding()||row.attempts>=3)continue;
      if(!store.db.prepare("UPDATE telegram_outbox SET state='sending',attempts=attempts+1 WHERE id=? AND state IN ('pending','retryable_failed')").run(row.id).changes)continue;
      try{const result=await transport.sendResearch(JSON.parse(row.body).text,canary);store.db.prepare("UPDATE telegram_outbox SET state='accepted',message_id=?,error=NULL WHERE id=?").run(result.guid,row.id);accepted++;}
      catch(e){const failure=e instanceof TelegramFailure?e:new TelegramFailure('telegram_unknown_failure',true),retry=failure.retryAfter!==null;store.db.prepare('UPDATE telegram_outbox SET state=?,error=?,next_at=? WHERE id=?').run(failure.uncertain?'uncertain':retry?'retryable_failed':'rejected',failure.kind,new Date(ms(clock())+(failure.retryAfter??60)*1000).toISOString(),row.id);}
    }
    return{accepted,state:'completed',deviceDelivery:'unobservable'};
  }finally{store.release('telegram-status',lease);}
}
