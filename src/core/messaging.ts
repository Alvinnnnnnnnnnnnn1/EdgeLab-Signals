import { hash, ms, nowISO, quoteFresh, type Decision } from './domain';
import type { Config } from './config';
import { Store, type Signal } from './store';
import type { Fetcher } from '../providers/http';
export interface NotificationTransport {
  send(signal:Signal,text:string):Promise<{guid:string;deliveredAt:string|null}>;
  reconcile?(signal:Signal,text:string):Promise<{guid:string}|null>;
  status(guid:string):Promise<{deliveredAt:string|null;failed:boolean}>;
}
export class TransportFailure extends Error { constructor(public kind:string,public uncertain:boolean){super(kind);} }
const pct=(n:number)=>(100*n).toFixed(1)+'%';
export function message(signal:Signal) {
  const {quote:q,forecast:f,ev:estimated}=signal.decision;
  if(!f)throw new Error('Forecast missing');
  return[
    `${signal.simulated?'[SIMULATED] ':''}EdgeLab Signals${signal.supersedes?' · Market update':''}`,
    `${q.event.league} · ${q.event.away} at ${q.event.home}`,
    `${q.player} · ${q.side.toUpperCase()} ${q.line} ${q.prop}`,
    `${q.bookmaker} @ ${q.decimalOdds.toFixed(2)}`,
    `Model ${pct(f.win)} · break-even ${pct(1/q.decimalOdds)} · estimated EV ${pct(estimated!)}`,
    ...(f.push>0?[`Push ${pct(f.push)} · conditional break-even ${pct((1-f.push-(f.voidProbability??0))/q.decimalOdds)}`]:[]),
    ...((f.voidProbability??0)>0?[`DNP void ${(100*f.voidProbability!).toFixed(1)}%`]:[]),
    `Reasons: ${f.n} complete games; ${f.expectedMinutes.toFixed(1)} expected minutes; stressed EV ${pct(f.robustEV)}.`,
    `Uncertainties: ${f.limitations.join(' ')}`,
    `Quote ${q.quotedAt} · expires ${q.expiresAt}`,
    'Research recommendation · 1 hypothetical unit for analysis.',
    `Ref ${signal.id.slice(0,12)}`,
  ].join('\n');
}
export const relayBinding=(c:Config)=>hash([c.bluebubbles.url,c.bluebubbles.recipient,c.bluebubbles.chatGuid,c.bluebubbles.allowlist]);
export class BlueBubbles implements NotificationTransport {
  constructor(private config:Config,private store:Store,private fetcher:Fetcher=fetch,private clock=nowISO){}
  private async request(path:string,method='GET',body?:unknown) {
    const c=this.config.bluebubbles,url=new URL(c.url),secret=process.env.BLUEBUBBLES_PASSWORD;
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new TransportFailure('Relay URL must be an origin without credentials',false);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new TransportFailure('Remote relay requires HTTPS',false);
    if(!secret)throw new TransportFailure('Relay credential missing',false);
    url.pathname=path;url.searchParams.set('password',secret);url.searchParams.set('with','participants,chats');
    try{
      const res=await this.fetcher(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!res.ok)throw new TransportFailure(`Relay HTTP ${res.status}`,method==='POST'&&![401,403,404,429].includes(res.status));
      const payload=await res.json() as {status?:number;data?:unknown};
      if(typeof payload.status==='number'&&payload.status!==200)throw new TransportFailure('Relay rejected response',method==='POST');
      return payload.data;
    }catch(e){if(e instanceof TransportFailure)throw e;throw new TransportFailure('Relay transport or parse failure',method==='POST');}
  }
  async verify() {
    const c=this.config.bluebubbles;
    if(!this.config.networkEnabled||!c.recipient||!c.chatGuid||!c.allowlist.includes(c.recipient))throw new TransportFailure('Configure network and allowlisted destination before verification',false);
    if(!c.chatGuid.startsWith('iMessage;-;')||c.chatGuid.slice('iMessage;-;'.length)!==c.recipient)throw new TransportFailure('Only exact one-recipient iMessage chats supported',false);
    await this.request('/api/v1/ping');
    const data=await this.request(`/api/v1/chat/${encodeURIComponent(c.chatGuid)}`) as {guid?:string;participants?:{address?:string}[]}|undefined;
    if(data?.guid!==c.chatGuid||data.participants?.length!==1||data.participants[0].address!==c.recipient)throw new TransportFailure('Relay chat recipient verification failed',false);
    const verified={binding:relayBinding(this.config),at:this.clock()};this.store.set('relay:verification',verified);return verified;
  }
  ready(at:string) {
    const c=this.config.bluebubbles,v=this.store.get<{binding:string;at:string}>('relay:verification');
    return this.config.networkEnabled&&this.config.deliveryEnabled&&!!process.env.BLUEBUBBLES_PASSWORD&&c.allowlist.includes(c.recipient)&&!!v&&v.binding===relayBinding(this.config)&&ms(at)>=ms(v.at)&&ms(at)-ms(v.at)<30*86400000;
  }
  async send(signal:Signal,text:string) {
    if(signal.simulated||!this.ready(this.clock()))throw new TransportFailure('Live relay not ready or simulated signal blocked',false);
    const result=await this.request('/api/v1/message/text','POST',{chatGuid:this.config.bluebubbles.chatGuid,message:text,tempGuid:`temp-edgelab-${signal.id}`,method:'apple-script'}) as {guid?:string}|undefined;
    if(!result?.guid)throw new TransportFailure('Submission returned no message GUID',true);
    // Submission cannot prove delivery. Query the final GUID separately on a subsequent cycle.
    return{guid:result.guid,deliveredAt:null};
  }
  async reconcile(signal:Signal,text:string) {
    const data=await this.request('/api/v1/message/query','POST',{chatGuid:this.config.bluebubbles.chatGuid,after:ms(signal.issuedAt)-2000,limit:1000,sort:'DESC',with:['chats']}) as {guid?:string;text?:string;isFromMe?:boolean;dateCreated?:number;chats?:{guid?:string}[]}[]|undefined;
    if(!Array.isArray(data))throw new TransportFailure('Message reconciliation schema invalid',false);
    const matches=data.filter(m=>m.guid&&m.text===text&&m.isFromMe===true&&typeof m.dateCreated==='number'&&m.dateCreated>=ms(signal.issuedAt)-2000&&m.chats?.some(c=>c.guid===this.config.bluebubbles.chatGuid));
    return matches.length===1?{guid:matches[0].guid!}:null;
  }
  async status(guid:string) {
    const data=await this.request(`/api/v1/message/${encodeURIComponent(guid)}`) as {guid?:string;isFromMe?:boolean;dateDelivered?:number;dateRead?:number;error?:number;chats?:{guid?:string}[]}|undefined;
    if(data?.guid!==guid||data.isFromMe!==true||!data.chats?.some(c=>c.guid===this.config.bluebubbles.chatGuid))throw new TransportFailure('Message identity/recipient proof missing',false);
    const at=Math.max(data.dateDelivered??0,data.dateRead??0);
    return{deliveredAt:at>1e12&&at<=ms(this.clock())+5000?new Date(at).toISOString():null,failed:!!data.error};
  }
}
export interface Revalidation {decision:Decision|null;checkedAt:string;}
export async function dispatch(store:Store,transport:NotificationTransport,config:Config,revalidate:(signal:Signal)=>Promise<Revalidation>,clock=nowISO,simulated=false) {
  if(!config.deliveryEnabled)return{sent:0,disabled:true};
  const lockAt=clock(),lease=store.acquire('delivery',lockAt,90);if(!lease)return{sent:0,busy:true};
  let sent=0;
  try{
    for(const out of store.outboxes()){
      const signal=store.signals().find(s=>s.id===out.signalId)!;
      let at=clock();
      if(signal.simulated!==simulated)continue;
      if(['submitted','uncertain','sending'].includes(out.state)){
        if(!out.guid){
          if(transport.reconcile){try{const found=await transport.reconcile(signal,message(signal));if(found){store.transition(out.id,'submitted',clock(),'Recovered exact outbound message GUID',found.guid);continue;}}catch{store.set('relay:health',{at:clock(),state:'reconciliation_failed'});}}
          if(out.state==='sending')store.transition(out.id,'uncertain',at,'Recovered interrupted send; no blind resend');continue;
        }
        try{
          const state=await transport.status(out.guid);
          if(state.deliveredAt&&ms(state.deliveredAt)>=ms(signal.issuedAt))store.transition(out.id,'delivered',at,'Provider confirmed delivery',out.guid);
          else if(state.failed)store.transition(out.id,'uncertain',at,'Relay reports failure after submission; reconcile before retry',out.guid);
        }catch{store.set('relay:health',{at,state:'status_query_failed'});}
        continue;
      }
      if(!['pending','failed'].includes(out.state)||out.attempts>=3||ms(out.nextAt)>ms(at))continue;
      if(!quoteFresh(signal.decision.quote,at,config.screen.maxQuoteAgeSeconds,config.scan.minBeforeStartSeconds)){store.transition(out.id,'expired',at,'Original signal quote expired');continue;}
      let refreshed:Revalidation;
      try{refreshed=await revalidate(signal);}catch{store.transition(out.id,'failed',clock(),'Pre-send source refresh failed',null,60);continue;}
      at=clock();
      const latest=refreshed.decision,original=signal.decision.quote;
      // Preserve immutable quoted terms. A changed price/line requires a newly screened recommendation.
      if(!latest?.qualified||latest.quote.playerId!==original.playerId||latest.quote.event.id!==original.event.id||latest.quote.bookmaker!==original.bookmaker||latest.quote.side!==original.side||latest.quote.prop!==original.prop||latest.quote.line!==original.line||latest.quote.decimalOdds!==original.decimalOdds
        ||ms(refreshed.checkedAt)>ms(at)||ms(at)-ms(refreshed.checkedAt)>30000||!quoteFresh(latest.quote,at,config.screen.maxQuoteAgeSeconds,config.scan.minBeforeStartSeconds)){
        store.transition(out.id,'expired',at,'Market/evidence no longer qualifies at original terms');continue;
      }
      if(!store.leaseValid('delivery',lease,at))break;
      if(!store.claimDelivery(out.id,at))continue;
      try{
        const result=await transport.send(signal,message(signal));
        store.transition(out.id,'submitted',clock(),'API accepted; delivery unconfirmed',result.guid);
        sent++;store.set('relay:health',{at:clock(),state:'submitted'});
      }catch(e){const uncertain=!(e instanceof TransportFailure)||e.uncertain;store.transition(out.id,uncertain?'uncertain':'failed',clock(),e instanceof TransportFailure?e.kind:'Unknown transport failure',null,Math.min(900,60*2**out.attempts));store.set('relay:health',{at:clock(),state:uncertain?'uncertain':'failed'});}
    }
  }finally{store.release('delivery',lease);}
  return{sent,disabled:false};
}
