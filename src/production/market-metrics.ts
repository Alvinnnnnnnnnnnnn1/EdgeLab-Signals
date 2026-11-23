import {hash,type Prop} from '../core/domain';
import {scoreRows,type ScoredPrediction} from '../research/scoring';
import {metricIntervals} from '../research-advanced/hardening';
interface Observation {model:string;predictionId:string;fixture:string;player:string;date:string;line:number;side:string;quoteAt:string;price:number;probability:number;fair:number;outcome:string;}
/** One OVER observation per exact captured line and source clock. The UNDER
 * side is retained in the journal, not counted as independent extra evidence. */
export function observedMarketComparison(prop:Prop,observations:Observation[]){
 const models=new Map<string,Map<string,Observation>>();for(const r of observations.filter(r=>r.side==='over')){const id=hash([r.fixture,r.player,prop,r.line,r.side,r.quoteAt,r.price]),group=models.get(r.model)??new Map<string,Observation>();group.set(id,r);models.set(r.model,group);}
 const active=models.get('active')??new Map<string,Observation>(),original=models.get('original')??new Map<string,Observation>(),ids=[...active.keys()].filter(id=>original.has(id));
 const scored=(model:'active'|'original'|'fair'):ScoredPrediction[]=>ids.map(id=>{const r=model==='original'?original.get(id)!:active.get(id)!,p=model==='fair'?r.fair:r.probability;return{id,date:r.date,fixture:r.fixture,player:r.player,team:'not-stratified',season:'not-pooled',lowMinute:false,y:Number(r.outcome==='won'),pmf:[1-p,p]};});
 const a=scored('active'),b=scored('original'),fair=scored('fair');return{prop,matchedExactLineOverObservations:ids.length,uniquePlayerFixtures:new Set(a.map(r=>hash([r.fixture,r.player]))).size,fixtures:new Set(a.map(r=>r.fixture)).size,dates:new Set(a.map(r=>r.date)).size,active:scoreRows(a,[.5]),original:scoreRows(b,[.5]),fair:scoreRows(fair,[.5]),pairedDate:ids.length?metricIntervals(a,b,[.5],'date'):null,pairedFixture:ids.length?metricIntervals(a,b,[.5],'fixture'):null,limitation:'Binary scores conditional on decisive settlement; multiple lines remain correlated and are never treated as equivalent prices.'};
}
