import{average,negativeBinomial,mixPMFs,summary,rng,sampleCount,betaBinomial}from'../research/distributions';import{type FeatureSet}from'../research/features';
const cap=(x:number,lo=1,hi=60)=>Math.max(lo,Math.min(hi,x));
export function quantile(a:number[],q:number){const s=a.slice().sort((a,b)=>a-b);return s[Math.floor(q*(s.length-1))];}
export function minuteFeatures(f:FeatureSet){const m=f.history.map(r=>r.log.minutes!),last=m.slice(-20),recent=last.slice(-10),weights=last.map((_,i)=>Math.exp(-Math.LN2*(last.length-1-i)/5)),season=f.history.filter(r=>r.log.event.season===f.history.at(-1)!.log.event.season).map(r=>r.log.minutes!);return[1,average(m.slice(-5))/48,average(recent)/48,average(season)/48,last.reduce((n,v,i)=>n+v*weights[i],0)/weights.reduce((a,b)=>a+b,0)/48,f.minutesSD/15,quantile(last,.1)/48,quantile(last,.9)/48,(average(m.slice(-5))-average(recent))/15,f.values[7]/14,f.values[8],f.values[9],last.filter(m=>m<10).length/last.length];}
export interface Regression {weights:number[];}
export function fitRidge(x:number[][],y:number[],penalty=2):Regression{if(x.length!==y.length||x.length<20||x.some(v=>v.some(n=>!Number.isFinite(n))))throw new Error('FINITE_PAST_TRAINING_ROWS_REQUIRED');const d=x[0].length,a=Array.from({length:d},()=>new Array(d+1).fill(0));for(let j=0;j<d;j++){for(let k=0;k<d;k++)a[j][k]=x.reduce((n,r)=>n+r[j]*r[k],0)+(j===k?(j===0?.01:penalty):0);a[j][d]=x.reduce((n,r,i)=>n+r[j]*y[i],0);}for(let j=0;j<d;j++){const p=a[j][j]||1e-9;for(let k=j;k<=d;k++)a[j][k]/=p;for(let i=0;i<d;i++)if(i!==j){const p=a[i][j];for(let k=j;k<=d;k++)a[i][k]-=p*a[j][k];}}return{weights:a.map(r=>r[d])};}
export const regression=(m:Regression,x:number[])=>m.weights.reduce((n,w,i)=>n+w*x[i],0);
export interface QuantileBoost {base:number;trees:{feature:number;threshold:number;left:number;right:number}[];q:number;}
export function fitQuantile(x:number[][],y:number[],q:number,rounds=16):QuantileBoost{const model:QuantileBoost={base:quantile(y,q),trees:[],q},p=y.map(()=>model.base);for(let step=0;step<rounds;step++){let best:any=null,loss=Infinity;for(let j=1;j<x[0].length;j++)for(const threshold of[.2,.5,.8].map(q=>quantile(x.map(r=>r[j]),q))){const left:number[]=[],right:number[]=[];x.forEach((r,i)=>(r[j]<=threshold?left:right).push(y[i]-p[i]));if(Math.min(left.length,right.length)<15)continue;const l=quantile(left,q),r=quantile(right,q),cost=y.reduce((n,v,i)=>{const e=v-p[i]-(x[i][j]<=threshold?l:r);return n+(e>=0?q:1-q)*Math.abs(e);},0);if(cost<loss){loss=cost;best={feature:j,threshold,left:l,right:r};}}if(!best)break;model.trees.push(best);x.forEach((r,i)=>{p[i]+=.15*(r[best.feature]<=best.threshold?best.left:best.right);});}return model;}
export const quantilePredict=(m:QuantileBoost,x:number[])=>cap(m.base+.15*m.trees.reduce((n,s)=>n+(x[s.feature]<=s.threshold?s.left:s.right),0),0,75);
/** Continuous Student-t(3) residual KDE, integrated over rounded-minute bins.
 * Truncation conditions on 0 < minutes <= 75 (the retained data contract).
 * It never clips individual draws into a boundary atom. */
export function residualBandwidth(residuals:number[]){
 if(!residuals.length||residuals.some(v=>!Number.isFinite(v)))throw new Error('FINITE_RESIDUALS_REQUIRED');
 const mean=average(residuals),sd=Math.sqrt(average(residuals.map(v=>(v-mean)**2))),iqr=(quantile(residuals,.75)-quantile(residuals,.25))/1.34;
 return Math.max(.5,.9*(Math.min(sd,iqr)||sd||1)*residuals.length**(-.2));
}
export const student3CDF=(z:number)=>.5+(Math.atan(z/Math.sqrt(3))+z*Math.sqrt(3)/(z*z+3))/Math.PI;
export function minuteBins(cdf:(x:number)=>number,max=75,survival?:(x:number)=>number){
 const lo=cdf(0),mass=cdf(max)-lo;if(!(mass>0&&Number.isFinite(mass)))throw new Error('INVALID_MINUTES_DENSITY');
 const p=new Array<number>(501).fill(0);for(let k=0;k<=max;k++){const lo=Math.max(0,k-.5),hi=Math.min(max,k+.5),a=cdf(lo);p[k]=Math.max(0,(survival&&a>.5?survival(lo)-survival(hi):cdf(hi)-a)/mass);}
 summary(p);return p;
}
export function residualPMF(mean:number,residuals:number[],max=75){
 const scale=residualBandwidth(residuals)/Math.sqrt(3);
 return minuteBins(x=>average(residuals.map(e=>student3CDF((x-mean-e)/scale))),max);
}
export interface MinuteModel {ridge:Regression;playerOffsets:Record<string,number>;residuals:number[];quantiles:QuantileBoost[];}
export function fitMinutes(rows:{f:FeatureSet;y:number}[]):MinuteModel{rows=rows.slice().sort((a,b)=>a.f.cutoff.localeCompare(b.f.cutoff));const x=rows.map(r=>minuteFeatures(r.f)),y=rows.map(r=>r.y),ridge=fitRidge(x,y),by=new Map<string,number[]>(),days=[...new Set(rows.map(r=>r.f.cutoff.slice(0,10)))],boundary=days[Math.floor(days.length*.7)],early=rows.map((r,i)=>i).filter(i=>rows[i].f.cutoff.slice(0,10)<boundary),later=rows.map((r,i)=>i).filter(i=>rows[i].f.cutoff.slice(0,10)>=boundary);if(early.length<20||!later.length)throw new Error('CHRONOLOGICAL_RESIDUAL_FOLD_REQUIRED');const cross=fitRidge(early.map(i=>x[i]),early.map(i=>y[i]));rows.forEach((r,i)=>{const a=by.get(r.f.playerId)??[];a.push(y[i]-regression(ridge,x[i]));by.set(r.f.playerId,a);});return{ridge,playerOffsets:Object.fromEntries([...by].map(([id,r])=>[id,r.reduce((a,b)=>a+b,0)/(r.length+20)])),residuals:later.map(i=>y[i]-regression(cross,x[i])),quantiles:[.1,.25,.5,.75,.9].map(q=>fitQuantile(x,y,q))};}
export function minutesDistribution(f:FeatureSet,m:MinuteModel,kind:'ridge'|'hierarchical'|'quantile'){
 const x=minuteFeatures(f),mean=regression(m.ridge,x)+(kind==='hierarchical'?(m.playerOffsets[f.playerId]??0):0);
 if(kind!=='quantile')return residualPMF(mean,m.residuals);
 // Piecewise-linear inverse CDF in logit probability coordinates. Analytic
 // logistic tails extend beyond the anchors; no 20-point histogram or spike.
 const qs=m.quantiles.map(q=>quantilePredict(q,x)).sort((a,b)=>a-b),levels=[.1,.25,.5,.75,.9],logit=(p:number)=>Math.log(p/(1-p)),floor=residualBandwidth(m.residuals)/2;
 for(let i=1;i<qs.length;i++)qs[i]=Math.max(qs[i],qs[i-1]+.05);
 const logistic=(z:number)=>1/(1+Math.exp(-z));
 const z=(value:number)=>{const i=value<qs[0]?0:value>=qs[4]?3:qs.findIndex((q,i)=>i<4&&value>=q&&value<qs[i+1]);
 const slope=Math.max(floor,(qs[i+1]-qs[i])/(logit(levels[i+1])-logit(levels[i])));
 // Floor only the extrapolated tail slopes; interior anchors remain coherent.
 if(value<qs[0])return logit(.1)+(value-qs[0])/slope;
 if(value>=qs[4])return logit(.9)+(value-qs[4])/slope;
 return logit(levels[i])+(value-qs[i])*(logit(levels[i+1])-logit(levels[i]))/(qs[i+1]-qs[i]);};
 return minuteBins(value=>logistic(z(value)),75,value=>logistic(-z(value)));
}
/** Conditional excess is fitted on training outcomes with observed minutes.
 * Predictive minutes are integrated once; raw count variance is not added again. */
export function conditionalDispersion(rows:{f:FeatureSet;y:number;minutes:number}[]){return cap(average(rows.map(r=>{const mu=Math.max(.1,r.f.rate*r.minutes);return((r.y-mu)**2-r.y)/(mu*mu);})),.01,3);}
export function minuteMixture(f:FeatureSet,minutes:number[],phi:number,monteCarlo=false):number[]{const means=new Map<number,number[]>(),dist=(m:number)=>{if(!means.has(m))means.set(m,negativeBinomial(f.rate*m,f.rate*m+phi*(f.rate*m)**2));return means.get(m)!;};if(monteCarlo){const random=rng(146),counts=new Array(501).fill(0);for(let i=0;i<2000;i++)counts[sampleCount(dist(sampleCount(minutes,random)),random)]++;return mixPMFs([counts.map(n=>n/2000),minuteMixture(f,minutes,phi)],[.99,.01]);}const result=new Array(501).fill(0);minutes.forEach((w,m)=>{if(w)dist(m).forEach((p,k)=>{result[k]+=w*p;});});summary(result);return result;}
/** Integrate conditional attempts over the full minutes PMF, then apply the
 * same beta-binomial conversion posterior to every attempt count. */
export function attemptsMixture(f:FeatureSet,minutes:number[],phi:number){
 if(f.prop!=='threes'||f.history.some(r=>r.metadata.threeAttempts===null))return null;
 summary(minutes);const n=f.history.reduce((n,r)=>n+r.metadata.threeAttempts!,0),made=f.history.reduce((n,r)=>n+r.log.stats.threes!,0),totalMinutes=f.history.reduce((n,r)=>n+r.log.minutes!,0);
 if(!Number.isFinite(phi)||phi<0||n<made||!totalMinutes||f.history.some(r=>!Number.isInteger(r.metadata.threeAttempts)||r.metadata.threeAttempts!<r.log.stats.threes!))return null;
 const attempts=new Array<number>(501).fill(0);minutes.forEach((w,m)=>{if(w){const mean=n/totalMinutes*m;negativeBinomial(mean,mean+phi*mean**2).forEach((p,k)=>attempts[k]+=w*p);}});
 const result=new Array<number>(501).fill(0);for(let n=0;n<attempts.length;n++)if(attempts[n]>=1e-14){const conversion=betaBinomial(n,made+.5,f.history.reduce((sum,r)=>sum+r.metadata.threeAttempts!-r.log.stats.threes!,0)+.5);for(let k=0;k<=n;k++)result[k]+=attempts[n]*conversion[k];}
 const total=result.reduce((a,b)=>a+b,0);if(Math.abs(total-1)>1e-7)throw new Error('INCOMPLETE_ATTEMPTS_MIXTURE');return result.map(p=>p/total);
}
