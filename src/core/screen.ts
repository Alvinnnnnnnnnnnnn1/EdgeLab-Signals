import { quoteSchema, contextSchema, termsSchema, quoteFresh, assertReceipt, ev, hash, ms, type Quote, type Context, type Terms, type GameLog, type Decision } from './domain';
import { forecast, MODEL_VERSION } from './models';
import type { LiveValidation } from '../providers/import';
import { isResearchValidation,researchForecast } from '../research/inference';
import { RESEARCH_VERSION } from '../research/models';
import type { Config } from './config';
export function screen(quote:Quote,logs:GameLog[],context:Context|null,terms:Terms|null,validation:LiveValidation|null,config:Config,at:string,simulated=false):Decision {
  const q=quoteSchema.parse(quote),reasons:string[]=[];
  if(q.bookmaker!==config.bookmaker)reasons.push('Reference bookmaker mismatch');
  if(!config.leagues.includes(q.event.league))reasons.push('League disabled');
  try{assertReceipt(q.source,at,simulated);}catch(e){reasons.push((e as Error).message);}
  if(!quoteFresh(q,at,config.screen.maxQuoteAgeSeconds,config.scan.minBeforeStartSeconds))reasons.push('Price stale, expired, future-dated or event too close');
  if(!terms||terms.id!==q.termsId)reasons.push('Verified exact market terms missing');
  else {
    termsSchema.parse(terms);
    try{assertReceipt(terms.source,at,simulated);}catch(e){reasons.push((e as Error).message);}
    if(terms.bookmaker!==q.bookmaker||terms.prop!==q.prop||terms.league!==q.event.league)reasons.push('Terms do not cover exact market');
  }
  if(!simulated&&validation&&!isResearchValidation(validation))reasons.push('Legacy 200-game checkpoint is not V1.1 promotion evidence');
  if(!validation||validation.modelVersion!==(isResearchValidation(validation)?RESEARCH_VERSION:MODEL_VERSION)||validation.league!==q.event.league||validation.prop!==q.prop||!validation.eligible||ms(validation.generatedAt)>ms(at)||!simulated&&(validation.simulated||!validation.asOfVerified||validation.samples<200||validation.players<10||validation.dates<30))reasons.push('League/market model not validated for live signals');
  if(!context)reasons.push('Availability/roster/minutes evidence missing');
  else{
    contextSchema.parse(context);
    try{assertReceipt(context.source,at,simulated);}catch(e){reasons.push((e as Error).message);}
    if(context.eventId!==q.event.id||context.playerId!==q.playerId||context.teamId!==q.teamId)reasons.push('Context identity mismatch');
    if(context.status!=='available'||!context.rosterVerified)reasons.push('Player availability or roster unverified');
    if(ms(context.observedAt)>ms(at)||ms(at)-ms(context.observedAt)>config.screen.maxEvidenceAgeSeconds*1000||ms(context.source.retrievedAt)<ms(context.observedAt)||ms(at)-ms(context.source.retrievedAt)>config.screen.maxEvidenceAgeSeconds*1000)reasons.push('Availability evidence stale or future-dated');
    if(context.expectedMinutes===null||context.expectedMinutes<config.screen.minMinutes||context.minutesSD===null||context.minutesSD>config.screen.maxMinutesSD)reasons.push('Minutes missing, low or uncertain');
  }
  if(logs.some(r=>!simulated&&r.source.simulated))reasons.push('Synthetic training data blocked');
  const f=context&&validation?(isResearchValidation(validation)?researchForecast(logs,q,context,at,validation,config.screen.minGames):forecast(logs,q,context,at,validation.selected,config.screen.minGames)):null;
  if(!f)reasons.push('Insufficient complete causal history');
  const estimatedEV=f?ev(f.win,f.push+(f.voidProbability??0),q.decimalOdds):null;
  if(f){
    const last=f.inputs.logs.at(-1)!;
    if(ms(at)-ms(last.event.startsAt)>30*86400000)reasons.push('Player history too old for current research');
    if(f.inputs.logs.filter(r=>r.event.season===q.event.season).length<5)reasons.push('Insufficient current-season history');
    if(!simulated&&context&&(context.opponentRateFactor!==null||context.homeRateFactor!==null))reasons.push('Context effects outside validated baseline feature set');
    if(f.limitations.some(l=>l.includes('differ materially')))reasons.push('Model minutes and verified pregame projection disagree');
    if(f.win<.15||f.win>.85)reasons.push('Probability outside conservative screen');
    if(Math.abs(f.empiricalWin-f.gammaWin)>config.screen.maxProbabilityGap)reasons.push('Candidate distributions disagree');
    if(estimatedEV!<config.screen.minEV)reasons.push('Estimated EV below threshold');
    if(f.robustEV<config.screen.minRobustEV)reasons.push('Minutes/model sensitivity removes robust edge');
    if(f.inputHash!==hash(f.inputs))throw new Error('Forecast integrity mismatch');
  }
  return{quote:q,evidence:{terms,validation},forecast:f,qualified:reasons.length===0,reasons,ev:estimatedEV,fairOdds:f&&f.win>0?(1-f.push-(f.voidProbability??0))/f.win:null,breakEven:1/q.decimalOdds};
}
