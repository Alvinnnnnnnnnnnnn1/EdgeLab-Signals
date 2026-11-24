import{readFileSync,writeFileSync}from'node:fs';import{multiFixture}from'./multi-bookmaker-fixture';import{hash,props}from'../../src/core/domain';import{localParts}from'../../src/research/schedule';import{importConfirmedPlacement}from'../../src/suggestions/placements';
/** Entirely isolated TEST-ONLY slate, with different players and teams. */
export function slateFixture(){
 const base='2026-11-25T00:00:00.000Z',fixtures=[0,20,30].map((minutes,i)=>multiFixture(new Date(Date.parse(base)+minutes*60000).toISOString(),60,{gameId:7001+i,playerId:701+i,homeId:11+2*i,awayId:12+2*i})),first=fixtures[0],a=first.authorize(),store=first.d.store;
 for(const f of fixtures.slice(1)){
  for(const table of['receipts','source_receipts','logs','research_models','experimental_forecasts'])for(const row of f.d.store.db.prepare(`SELECT * FROM ${table}`).all()){
   const keys=Object.keys(row);store.db.prepare(`INSERT OR IGNORE INTO ${table}(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));
  }
  for(const row of f.d.store.db.prepare("SELECT key,value FROM meta WHERE key LIKE 'live:%'").all())store.set(String(row.key),JSON.parse(String(row.value)));
 }
 const activation=JSON.parse(readFileSync(a.config.multiBookmaker.activationFile!,'utf8'));activation.eventIds=fixtures.map(f=>f.d.event.id);writeFileSync(a.config.multiBookmaker.activationFile!,JSON.stringify(activation),{mode:0o600});const grant=JSON.parse(readFileSync(a.grantFile,'utf8'));grant.eventIds=activation.eventIds;grant.maxCredits=3;grant.maxRequests=12;writeFileSync(a.grantFile,JSON.stringify(grant),{mode:0o600});store.set('multi:active-release',{commit:activation.codeCommit,protectionHash:a.protection.hash,activationHash:hash(activation),eventIds:activation.eventIds,operatingDate:activation.operatingDate});
 for(const[f,markets]of[[fixtures[0],['rebounds','threes']],[fixtures[1],['rebounds','assists','threes']]]as const)for(const prop of markets)importConfirmedPlacement(store,{confirmed:true,event:f.d.event,playerId:f.d.fs[0].playerId,teamId:f.d.event.homeId,prop,side:'over',line:.5,bookmaker:'sportsbet',decimalOdds:2,placedAt:first.d.clock(),source:{kind:'owner-confirmation',externalId:`TEST-ONLY-${f.d.event.id}-${prop}`}},first.d.clock());
 const out=fixtures[2],injury=first.d.retain({label:'TEST-ONLY out'},'https://example.invalid/TEST-ONLY/out',first.d.clock(),'TEST-ONLY');store.set(`live:injury:${out.d.fs[0].playerId.split(':').at(-1)}`,{status:'Out',observedAt:first.d.clock(),source:injury});
 let requests=0,used=0;const calls:{endpoint:string;markets:string[];cost:number}[]=[],fetcher=async(input:string|URL)=>{
  requests++;const u=new URL(input);let body:unknown=[],cost=0,markets:string[]=[];
  if(u.pathname.endsWith('/events'))body=fixtures.map(f=>({id:f.raw.id,sport_key:f.raw.sport_key,commence_time:f.raw.commence_time,home_team:f.raw.home_team,away_team:f.raw.away_team}));
  if(u.pathname.endsWith('/odds')){const event=fixtures.find(f=>u.pathname.includes('/'+f.raw.id+'/'))!;if(!event)throw Error('TEST_ONLY_UNKNOWN_EVENT');markets=u.searchParams.get('markets')!.split(',');cost=markets.length;body={...event.raw,bookmakers:event.raw.bookmakers.map(b=>({...b,markets:b.markets.filter(m=>markets.includes(m.key)).map(m=>({...m,last_update:first.d.clock()}))}))};}
  used+=cost;calls.push({endpoint:u.pathname,markets,cost});return Response.json(body,{headers:{'x-requests-used':String(used),'x-requests-remaining':String(500-used),'x-requests-last':String(cost)}});
 };
 return{fixtures,first,store,a,grant,activation,date:localParts(first.d.event.startsAt).date,clock:first.d.clock,setAt:first.d.setAt,fetcher,calls,requests:()=>requests,credits:()=>used,close:()=>fixtures.forEach(f=>f.close())};
}
