import{mkdirSync,existsSync,statSync,renameSync,appendFileSync}from'node:fs';
if(process.argv[2]!=='worker')throw new Error('Reliable research wrapper accepts worker only');
mkdirSync('.local/logs',{recursive:true,mode:0o700});
const secrets=['BALLDONTLIE_API_KEY','ODDS_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','BLUEBUBBLES_PASSWORD'].map(k=>process.env[k]).filter(Boolean);
for(const stream of ['stdout','stderr'])process[stream].write=(chunk,encoding,callback)=>{const path='.local/logs/reliability-bootstrap.jsonl';if(existsSync(path)&&statSync(path).size>1000000)renameSync(path,path+'.1');let text=String(chunk);for(const secret of secrets)text=text.replaceAll(secret,'[redacted]');appendFileSync(path,JSON.stringify({at:new Date().toISOString(),stream,text:text.slice(0,4000)})+'\n',{mode:0o600});const done=typeof encoding==='function'?encoding:callback;done?.();return true;};
await import('../src/research/reliability/cli.ts');
