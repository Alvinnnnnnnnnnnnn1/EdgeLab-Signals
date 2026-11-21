import { mkdirSync,existsSync,statSync,renameSync,appendFileSync } from 'node:fs';
if(process.argv[2]!=='worker')throw new Error('Research service wrapper accepts worker only');
mkdirSync('.local/logs',{recursive:true,mode:0o700});
const secrets=['BALLDONTLIE_API_KEY','ODDS_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','BLUEBUBBLES_PASSWORD'].map(k=>process.env[k]).filter(Boolean);
function output(stream,chunk){
  const path='.local/logs/research-bootstrap.jsonl';if(existsSync(path)&&statSync(path).size>1_000_000)renameSync(path,`${path}.1`);
  let text=String(chunk);for(const secret of secrets)text=text.replaceAll(secret,'[redacted]');
  appendFileSync(path,JSON.stringify({at:new Date().toISOString(),stream,text:text.slice(0,4000)})+'\n',{mode:0o600});
}
for(const stream of ['stdout','stderr'])process[stream].write=(chunk,encoding,callback)=>{output(stream,chunk);const done=typeof encoding==='function'?encoding:callback;done?.();return true;};
await import('../src/research/cli.ts');
