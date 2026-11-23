import {existsSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {ms,nowISO} from '../core/domain';
import type {ComparisonPlan} from './journal';
export function comparisonHealth(path:string,at=nowISO()){
 if(!existsSync(path))return{state:'not-installed',at};
 const plan=JSON.parse(readFileSync(path,'utf8')) as ComparisonPlan,db=new DatabaseSync(plan.journalPath,{readOnly:true});try{db.exec('PRAGMA busy_timeout=100');const row=db.prepare("SELECT value FROM comparison_meta WHERE key='worker'").get(),worker=row?JSON.parse(String(row.value)):null,lease=db.prepare("SELECT expires_at FROM leases WHERE name='comparison-worker'").get(),fresh=worker&&ms(at)-ms(worker.at)<30000,valid=lease&&ms(String(lease.expires_at))>ms(at),meta=(key:string)=>{const r=db.prepare('SELECT value FROM comparison_meta WHERE key=?').get(key);return r?JSON.parse(String(r.value)):null;};return{at,state:fresh&&valid&&worker.state!=='stopped'?'healthy':'stale',worker,lease,predictions:db.prepare('SELECT count(*) n FROM challenger_predictions').get(),ready:db.prepare('SELECT prop,count(*) n FROM production_ready GROUP BY prop').all(),latestReport:meta('report'),lastTask:meta('task')};}finally{db.close();}}
