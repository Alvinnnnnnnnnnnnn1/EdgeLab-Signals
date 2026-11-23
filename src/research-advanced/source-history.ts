import{z}from'zod';import{Store}from'../core/store';import{hash,ms,assertReceipt,type Receipt,type Event}from'../core/domain';import{bdlEvent}from'../providers/balldontlie';import{currentPlayerEvidence}from'../suggestions/engine';import{type ExperimentalForecast}from'../suggestions/forecasts';
const injuryRow=z.object({player:z.object({id:z.number().int().positive()}),status:z.string()});
type Page={source:Receipt;url:URL;data:unknown[];next:number|null;valid:boolean};
/** Reconstruct retained source knowledge without reading today's overwritten
 * live metadata. Only unfiltered, fully linked injury chains prove completeness.
 * This is source-evidence replay, not proof of historical process execution. */
export function sourceHistory(store:Store){
 const fixtures=new Map<string,{event:Event;source:Receipt;status:string}[]>(),players=new Map<string,{playerId:string;teamId:string;observedAt:string;source:Receipt}[]>(),injuries=new Map<string,{status:string;observedAt:string;source:Receipt}[]>(),pages:Page[]=[],invalidInjuryTimes:number[]=[];
 const raw=store.db.prepare("SELECT s.body AS source,r.body AS data FROM source_receipts s JOIN receipts r ON r.hash=s.hash ORDER BY json_extract(s.body,'$.retrievedAt'),s.id").all()as{source:string;data:string}[];
 raw.sort((a,b)=>Date.parse(JSON.parse(a.source).retrievedAt)-Date.parse(JSON.parse(b.source).retrievedAt));
 const add=<T>(map:Map<string,T[]>,id:string,value:T)=>{const a=map.get(id)??[];a.push(value);map.set(id,a);};
 for(const row of raw){const source=JSON.parse(row.source)as Receipt;if(source.provider!=='balldontlie'||source.simulated)continue;let url:URL;try{url=new URL(source.endpoint);}catch{continue;}if(url.origin!=='https://api.balldontlie.io'||!['/nba/v1/games','/nba/v1/players/active','/nba/v1/player_injuries'].includes(url.pathname))continue;
  assertReceipt(source,source.retrievedAt);if(!store.hasReceipt(source))throw new Error('SOURCE_HISTORY_RECEIPT_MISSING');const body=JSON.parse(row.data);if(!Array.isArray(body.data))continue;
  if(url.pathname==='/nba/v1/games')for(const g of body.data){try{const event=bdlEvent(g),status=g.postponed?'postponed':g.status_state??(g.status==='Final'?'final':'unknown');add(fixtures,event.id,{event,source,status});}catch{/* An unparseable fixture is not manufactured into an exact start. */}}
  else if(url.pathname==='/nba/v1/players/active')for(const p of body.data){const team=p.team?.id??p.team_id;if(!Number.isInteger(p.id)||p.id<=0||!Number.isInteger(team)||team<=0||p.team?.id&&p.team_id&&p.team.id!==p.team_id)continue;const playerId=`bdl:nba:player:${p.id}`;add(players,playerId,{playerId,teamId:`bdl:nba:team:${team}`,observedAt:source.retrievedAt,source});}
  else{
   const parsed=z.array(injuryRow).safeParse(body.data),meta=z.object({next_cursor:z.number().int().positive().nullable().optional()}).safeParse(body.meta);
   const valid=parsed.success&&meta.success;if(!valid)invalidInjuryTimes.push(ms(source.retrievedAt));
   if(parsed.success)for(const p of parsed.data)add(injuries,`bdl:nba:player:${p.player.id}`,{status:p.status,observedAt:source.retrievedAt,source});
   // Filtered player/team responses cannot prove league-wide absence.
   if([...url.searchParams.keys()].some(k=>!['per_page','cursor'].includes(k)))continue;
   pages.push({source,url,data:body.data,next:meta.success?meta.data.next_cursor??null:null,valid});
  }
 }
 const complete:{at:string;source:Receipt;pages:Receipt[]}[]=[];
 // Build completion events online. A later duplicate/epoch cannot erase or
 // alter a traversal already completed before an earlier prediction cutoff.
 let chain:Page[]=[],seen=new Set<number>();
 for(const page of pages){
  if(!page.valid){chain=[];seen=new Set();continue;}
  if(!page.url.searchParams.has('cursor')){chain=[page];seen=new Set();}
  else{
   const previous=chain.at(-1),cursor=Number(page.url.searchParams.get('cursor'));
   if(!previous||previous.next!==cursor)continue;
   if(seen.has(cursor)){chain=[];continue;}seen.add(cursor);chain.push(page);
  }
  if(page.next!==null&&seen.has(page.next)){chain=[];continue;}
  if(page.next===null){complete.push({at:page.source.retrievedAt,source:page.source,pages:chain.map(p=>p.source)});chain=[];}
 }
 const last=<T extends{source:Receipt}>(rows:T[],at:string)=>{const known=rows.filter(r=>ms(r.source.retrievedAt)<=ms(at)),latest=known.at(-1);if(!latest)return undefined;const ties=known.filter(r=>ms(r.source.retrievedAt)===ms(latest.source.retrievedAt)),values=new Set(ties.map(({source,...data})=>hash(data)));return values.size===1?latest:undefined;};
 const assessment=(f:ExperimentalForecast,at:string)=>{
  const fixture=last(fixtures.get(f.event.id)??[],at),roster=last(players.get(f.playerId)??[],at),injury=last(injuries.get(f.playerId)??[],at),snapshot=complete.filter(c=>ms(c.at)<=ms(at)).at(-1);
  if(invalidInjuryTimes.some(t=>t<=ms(at)&&ms(at)-t<4*3600000))return{verified:false,reason:'Malformed retained injury page prevents safe historical reconstruction',sourceRefs:[]as string[],participation:'unconfirmed_not_assumed'};
  const view=new Proxy(store,{get(target,key){if(key==='get')return(name:string)=>name===`live:fixture:${f.event.id.split(':').at(-1)}`?fixture:name===`live:roster:${f.playerId.split(':').at(-1)}`?roster:name===`live:injury:${f.playerId.split(':').at(-1)}`?injury:name==='live:injuries-complete'?snapshot:undefined;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  try{currentPlayerEvidence(view,f,at);return{verified:true,reason:null,sourceRefs:[fixture!.source,roster!.source,...snapshot!.pages,...(injury?[injury.source]:[])].map(s=>hash(s)),participation:'unconfirmed_not_assumed'};}catch(e){return{verified:false,reason:(e as Error).message,sourceRefs:[]as string[],participation:'unconfirmed_not_assumed'};}
 };
 return{assessment,completeInjurySnapshots:complete.map(c=>({at:c.at,pages:c.pages.length,sourceRefs:c.pages.map(s=>hash(s))})),classification:'Retained source evidence only; historical runtime delivery/config state is not inferred'};
}
