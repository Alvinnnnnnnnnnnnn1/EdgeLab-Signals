import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
const [base='http://127.0.0.1:3117',mode='live',db='.local/signals.sqlite']=process.argv.slice(2);
const fingerprint=()=>existsSync(db)?createHash('sha256').update(readFileSync(db)).digest('hex'):null;
const before=fingerprint(),checks=[];
for(const [path,title] of [['/opportunities','Opportunities'],['/performance','Performance'],['/status','System Status'],['/opportunities?league=NBL&prop=threes','Opportunities']]){
  const res=await fetch(base+path);assert.equal(res.status,200,path);const html=await res.text();assert.ok(html.includes(title));assert.ok(!html.includes('Workspace data unavailable'));
  if(mode==='simulated')assert.ok(html.includes('SIMULATED DATA'));
  checks.push({path,status:res.status});
}
const api=await fetch(base+'/api/snapshot');assert.equal(api.status,200);assert.equal(api.headers.get('cache-control'),'no-store');const data=await api.json();assert.equal(data.mode,mode);assert.equal(data.status.deliveryEnabled,false);assert.equal(data.status.networkEnabled,false);assert.equal(data.status.usage.length,0);assert.ok(data.status.completeness.every(r=>r.playerGames===0));
if(mode==='live')assert.equal(data.signals.length,0);else{assert.ok(data.signals.length>0);assert.ok(data.signals.every(s=>s.simulated));assert.equal(data.performance.won,1);}
assert.equal((await fetch(base+'/api/snapshot',{method:'POST'})).status,405);
assert.equal((await fetch(base+'/api/snapshot',{headers:{Origin:'https://untrusted.example'}})).status,403);
const hostStatus=await new Promise((resolve,reject)=>{const req=http.get(new URL('/api/snapshot',base),{headers:{Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(hostStatus,403);
assert.equal(fingerprint(),before,'Dashboard must not alter the research database');
console.log(JSON.stringify({mode,checks,api:200,postRejected:405,originRejected:403,hostRejected:403,databaseUnchanged:true},null,2));
