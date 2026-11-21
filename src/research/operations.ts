import { readFileSync,writeFileSync,mkdirSync,statSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { configSchema,loadConfig } from '../core/config';
import { Store } from '../core/store';
import { researchModels } from './shadow';
import { nowISO } from '../core/domain';

function privateConfigPath(){const path=resolve(process.env.EDGELAB_CONFIG||'config/local.json');if(!path.startsWith(resolve(process.cwd())+'/')||(statSync(path).mode&0o077)!==0)throw new Error('Owner-only Signals configuration inside this repository required');return path;}
export function configureMode(store:Store,mode:'disabled'|'research'|'shadow',confirmed:boolean){
  if(!confirmed)throw new Error('Explicit owner activation requires --confirm');
  const path=privateConfigPath(),raw=JSON.parse(readFileSync(path,'utf8')),config=loadConfig(path);
  if(mode==='shadow'&&researchModels(store).length!==4)throw new Error('Register four current genuine provisional model artifacts before SHADOW activation');
  if(mode!=='disabled'&&(!config.networkEnabled||!config.providers.balldontlie.enabled||config.providers.balldontlie.dailyLimit<=0))throw new Error('Configured independent finite NBA source allowance required');
  raw.operatingMode=mode;raw.deliveryEnabled=false;raw.telegram={...config.telegram,qualifiedEnabled:false,...(mode==='disabled'?{statusEnabled:false}:{})};raw.providers={...config.providers,...raw.providers,odds:{...config.providers.odds,...raw.providers?.odds,enabled:false}};
  configSchema.parse(raw);writeFileSync(path,JSON.stringify(raw,null,2)+'\n',{mode:0o600});
  if(mode==='shadow'){const at=nowISO();store.db.prepare("UPDATE research_jobs SET state='queued',next_at=? WHERE kind='pregame' AND state='complete' AND deadline>?").run(at,at);}
  return{mode,qualifiedAlerts:false,persistentOdds:false,serviceStarted:false};
}
export function configureStatusMessages(enabled:boolean,confirmed:boolean){
  if(!confirmed)throw new Error('Research-status messages require explicit --confirm');const path=privateConfigPath(),raw=JSON.parse(readFileSync(path,'utf8')),config=loadConfig(path);raw.telegram={...config.telegram,statusEnabled:enabled,qualifiedEnabled:false};configSchema.parse(raw);writeFileSync(path,JSON.stringify(raw,null,2)+'\n',{mode:0o600});return{statusEnabled:enabled,qualifiedEnabled:false};
}
export function prepareLaunchAgent(){
  const root=resolve(process.cwd()),node=process.execPath,config=privateConfigPath();mkdirSync('.local/ops',{recursive:true,mode:0o700});mkdirSync('.local/logs',{recursive:true,mode:0o700});
  const xml=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const args=[node,`--env-file-if-exists=${join(root,'.env.local')}`,'--import','tsx',join(root,'scripts/research-service.mjs'),'worker'];
  const body=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.edgelab.signals.research</string><key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xml(root)}</string><key>EnvironmentVariables</key><dict><key>EDGELAB_CONFIG</key><string>${xml(config)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer><key>StandardOutPath</key><string>${xml('/dev/null')}</string><key>StandardErrorPath</key><string>${xml('/dev/null')}</string></dict></plist>\n`;
  const path=join(root,'.local/ops/com.edgelab.signals.research.plist');writeFileSync(path,body,{mode:0o600});return{path,node,workingDirectory:root,installed:false,loaded:false};
}
