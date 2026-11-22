import {z} from 'zod';
import {Store} from '../../core/store';
import {hash,ms,props,assertReceipt,eventSchema,type Receipt} from '../../core/domain';
import {artifactSchema} from '../inference';
import {thresholds} from '../experiment';
import {scoreRows,pairedDifference,type ScoredPrediction} from '../scoring';

/** Same statistical definitions and ordered cohorts as scoreProspective.
 * Only integrity work shared by immutable input-reference sets is deduplicated. */
export function scoreProspectiveFast(store:Store,at:string,classification:'verified-availability'|'conditional-shadow'='verified-availability'){
 const records=store.db.prepare(classification==='conditional-shadow'?'SELECT body FROM shadow_forecasts ORDER BY at,id':'SELECT body FROM prospective_forecasts ORDER BY at,id').all()as{body:string}[];
 const logs=store.logs(),indexed=new Map(logs.map(log=>[hash([log.event.id,log.playerId,log.source.hash]),log])),finals=new Map<string,typeof logs>();
 for(const log of logs){const key=`${log.event.id}:${log.playerId}`,list=finals.get(key)??[];list.push(log);finals.set(key,list);}
 const groups=new Map<string,{prop:typeof props[number];selected:ScoredPrediction[];baseline:ScoredPrediction[]}>(),exclusions:{id:string;reason:string}[]=[],checked=new Map<string,{known:number;day:string}>();
 const pmf=z.array(z.number().min(0).max(1)).min(2).refine(v=>Math.abs(v.reduce((n,p)=>n+p,0)-1)<1e-8);
 function history(refs:string[],cutoff:string){const key=hash(refs),cached=checked.get(key),time=ms(cutoff),day=cutoff.slice(0,10);if(cached&&cached.known<=time&&cached.day<day)return;
  let known=0,lastDay='';for(const id of refs){const input=indexed.get(id);if(!input||ms(input.observedAt)>time||input.event.startsAt.slice(0,10)>=day)throw new Error('Frozen input missing or unavailable before forecast');known=Math.max(known,ms(input.observedAt));lastDay=[lastDay,input.event.startsAt.slice(0,10)].sort().at(-1)!;
   for(const source of [input.source,...(input.supportingSources??[])]){assertReceipt(source,cutoff);if(!store.hasReceipt(source))throw new Error('Frozen history receipt missing');known=Math.max(known,ms(source.retrievedAt));}
  }checked.set(key,{known,day:lastDay});
 }
 for(const row of records){const r=JSON.parse(row.body);try{
  if(r.kind!=='pregame-conditional-count/1'||r.researchOnly!==true||r.promotionEligible!==false||hash(r.inputs)!==r.inputHash||ms(r.at)>ms(at)||ms(r.at)>=ms(r.event.startsAt)-120000)throw new Error('Invalid frozen pregame record');
  const prop=z.enum(['points','rebounds','assists','threes']).parse(r.prop),event=eventSchema.parse(r.event),artifact=artifactSchema.parse(r.inputs.artifact);
  if(event.league!=='NBA'||hash(artifact)!==r.artifactHash||ms(artifact.generatedAt)>ms(r.at))throw new Error('Frozen artifact identity or clock invalid');
  for(const source of [r.inputs.fixtureSource,r.inputs.context.source]as Receipt[]){assertReceipt(source,r.at);if(!store.hasReceipt(source))throw new Error('Frozen source missing');}history(r.inputs.inputRefs,r.at);
  const final=(finals.get(`${event.id}:${r.playerId}`)??[]).filter(l=>!l.source.simulated&&l.final&&l.teamId===r.teamId&&hash(l.event)===hash(event)&&ms(l.observedAt)<=ms(at)&&ms(l.observedAt)>ms(event.startsAt)).sort((a,b)=>ms(b.observedAt)-ms(a.observedAt))[0];
  if(!final||final.participated!==true||final.stats[prop]===null){exclusions.push({id:r.id,reason:'No genuine observed participating final with this stat; unresolved DNP stays excluded'});continue;}
  for(const source of [final.source,...(final.supportingSources??[])]){assertReceipt(source,at);if(!store.hasReceipt(source))throw new Error('Final source missing');}
  const common={id:r.id,date:new Date(ms(event.startsAt)).toISOString().slice(0,10),fixture:event.id,season:event.season,player:r.playerId,team:r.teamId,lowMinute:r.inputs.features[4]<15,y:final.stats[prop]},key=`${r.artifactHash}:${prop}`,group=groups.get(key)??{prop,selected:[],baseline:[]};group.selected.push({...common,pmf:pmf.parse(r.distribution)});group.baseline.push({...common,pmf:pmf.parse(r.baselineDistribution)});groups.set(key,group);
 }catch(e){exclusions.push({id:r.id,reason:e instanceof Error?e.message:'Invalid frozen record'});}}
 return{at,classification,frozenRecords:records.length,gradedIds:[...groups.values()].flatMap(g=>g.selected.map(r=>r.id)),unresolved:records.length-[...groups.values()].reduce((n,g)=>n+g.selected.length,0),groups:[...groups].map(([id,g])=>({id,prop:g.prop,metrics:scoreRows(g.selected,thresholds.NBA[g.prop]),baseline:scoreRows(g.baseline,thresholds.NBA[g.prop]),paired:pairedDifference(g.selected,g.baseline,thresholds.NBA[g.prop])})),exclusions,scope:'Conditional count accuracy only; these records cannot replace quote/terms/participation monitoring or promote a live alert.',promotionEligible:false};
}
