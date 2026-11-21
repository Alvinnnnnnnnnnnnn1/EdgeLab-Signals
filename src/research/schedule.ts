import { ms } from '../core/domain';

export const MELBOURNE = 'Australia/Melbourne';
export const RESEARCH_WINDOWS = ['07:15','09:00','11:00','13:00','16:00','19:30','22:30'] as const;
export const WINDOW_MINUTES = 30;
export const PREGAME_MINUTES = [90,20] as const;
const formatter = new Intl.DateTimeFormat('en-CA',{timeZone:MELBOURNE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function localParts(at:string){
  const p=Object.fromEntries(formatter.formatToParts(new Date(at)).map(v=>[v.type,v.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,minutes:Number(p.hour)*60+Number(p.minute)};
}
const dayAfter=(date:string)=>new Date(ms(`${date}T12:00:00Z`)+86400000).toISOString().slice(0,10);
// Resolve civil time with the IANA database, never the host timezone or a fixed offset.
// Reject gaps; choose the earlier occurrence of a fold. Our scheduled times avoid both.
export function melbourneInstant(date:string,time:string){
  const civil=ms(`${date}T${time}:00Z`),matches=[10,11].map(offset=>new Date(civil-offset*3600000).toISOString()).filter(at=>{const p=localParts(at);return p.date===date&&p.time===time;}).sort();
  if(!matches.length)throw new Error('Nonexistent Melbourne civil time');return matches[0];
}
export function researchSchedule(at:string){
  const {date}=localParts(at),slots=[...RESEARCH_WINDOWS.map(t=>melbourneInstant(date,t)),...RESEARCH_WINDOWS.map(t=>melbourneInstant(dayAfter(date),t))];
  const active=slots.find(t=>ms(t)<=ms(at)&&ms(at)<ms(t)+WINDOW_MINUTES*60000)??null;
  return {timeZone:MELBOURNE,heartbeatSeconds:60,windows:RESEARCH_WINDOWS,windowMinutes:WINDOW_MINUTES,activeWindow:active,nextWindow:slots.find(t=>ms(t)>ms(at))!,pregameMinutes:PREGAME_MINUTES};
}
export function nextRoutineAt(at:string){const schedule=researchSchedule(at);return schedule.activeWindow?at:schedule.nextWindow;}
export function notificationWindow(at:string,deadline:string|null=null){
  const p=localParts(at),quiet=p.minutes>=30&&p.minutes<420;
  const nextAt=quiet?melbourneInstant(p.date,'07:00'):at;
  const expired=deadline!==null&&(!Number.isFinite(ms(deadline))||ms(nextAt)>=ms(deadline));
  return {quiet,quietHours:'00:30–07:00',timeZone:MELBOURNE,nextAt,state:expired?'expired':quiet?'deferred':'ready'} as const;
}
