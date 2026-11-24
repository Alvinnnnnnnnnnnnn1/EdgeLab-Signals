import{nowISO,ms}from'../core/domain';import{loadConfig}from'../core/config';import{FencedStore,type Fence}from'../research/reliability/store';import{researchSlateBatch}from'./slate';
// This is an ephemeral child of the existing market supervisor, never a new
// service. It has no transport/provider capability or paid request allowance.
async function main(){
 const[database,date,parentToken,slotToken]=process.argv.slice(2);if(!database||!date||!parentToken||!slotToken)throw Error('EXACT_RESEARCH_TASK_REQUIRED');const config=loadConfig();if(!config.multiBookmaker.codeEnabled)return;
 const at=nowISO(),owners:Fence[]=[{name:'recurring-market-worker',token:parentToken},{name:'multi-slate-research',token:slotToken}],store=new FencedStore(database,owners);
 globalThis.fetch=async()=>{throw Error('LOCAL_SLATE_RESEARCH_CANNOT_USE_NETWORK');};store.reserve=()=>{throw Error('LOCAL_SLATE_RESEARCH_CANNOT_RESERVE_PROVIDER_REQUESTS');};
 try{store.setTaskDeadline(new Date(ms(at)+8000).toISOString());const result=researchSlateBatch(store,date,at,{clock:nowISO,assertOwner:()=>store.fence.assert(),maxFixtures:3,codeCommit:store.get<{commit:string}>('multi:active-release')?.commit??null});store.set('multi:research-worker-last',{at:nowISO(),processed:result.processed,date,coverage:result.slate.counters,providerRequests:0,outboundMessages:0});}
 finally{store.fence.restore();store.close();}
}
void main().catch(()=>{process.exitCode=1;});
