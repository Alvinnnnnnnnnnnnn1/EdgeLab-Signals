import {setPriority} from 'node:os';
import {comparisonChild} from './supervisor';
try{setPriority(0,10);}catch{/* Scheduling priority is best effort. */}
process.once('message',async(request:any)=>{try{const result=await comparisonChild(request);process.send?.({type:'result',result});process.disconnect?.();}catch(e){process.send?.({type:'error',reason:(e as Error).message});process.exitCode=1;process.disconnect?.();}});
