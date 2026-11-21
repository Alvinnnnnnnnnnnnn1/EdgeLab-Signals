import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { gameLogSchema, contextSchema, termsSchema, receiptSchema, stamp, assertReceipt, type GameLog, type Context, type Terms, ms,nowISO } from '../core/domain';
import { registrySchema, verifyRegistry, emptyRegistry, type Registry } from './identity';
import { Store } from '../core/store';
import { validationSchema, type Validation } from '../core/evaluation';
import {isResearchValidation,type ResearchValidation} from '../research/inference';
import {validateResearchDocument} from '../research/monitoring';
import { hash } from '../core/domain';
// Explicit interchange format for a permitted feed or licensed NBL export. No undocumented Rosetta extraction.
export const bundleSchema=z.object({label:z.enum(['licensed_export','synthetic']),licenseReference:z.string().min(8),exportedAt:stamp,
  sources:z.array(z.object({receipt:receiptSchema,body:z.string()})),logs:z.array(gameLogSchema).default([]),contexts:z.array(contextSchema).default([]),terms:z.array(termsSchema).default([]),registry:registrySchema.optional()}).strict();
export interface Evidence {contexts:Context[]; terms:Terms[]; registry:Registry;}
export function importBundle(raw:unknown,store:Store,now:string,allowSimulated=false):{inserted:number;evidence:Evidence} {
  const b=bundleSchema.parse(raw);
  if(ms(b.exportedAt)>ms(now))throw new Error('Future export');
  if(b.label==='synthetic'&&!allowSimulated)throw new Error('Synthetic export requires isolated demo');
  for(const s of b.sources){assertReceipt(s.receipt,now,allowSimulated);if((b.label==='synthetic')!==s.receipt.simulated)throw new Error('Export/source simulation label mismatch');store.receipt(s.receipt,s.body);}
  for(const record of [...b.logs,...b.contexts,...b.terms]){
    assertReceipt(record.source,now,allowSimulated);
    if(!store.hasReceipt(record.source))throw new Error('Evidence body missing');
    if('supportingSources' in record)for(const r of record.supportingSources??[]){assertReceipt(r,now,allowSimulated);if(!store.hasReceipt(r))throw new Error('Supporting source bytes missing');}
    if((b.label==='synthetic')!==record.source.simulated)throw new Error('Record simulation label mismatch');
  }
  const registry=b.registry?verifyRegistry(b.registry,store,now,allowSimulated):emptyRegistry();
  return{inserted:store.ingest(b.logs,now,allowSimulated),evidence:{contexts:b.contexts,terms:b.terms,registry}};
}
export function loadEvidence(path:string,store:Store,now:string,simulated=false):Evidence {
  if(!existsSync(path))return{contexts:[],terms:[],registry:emptyRegistry()};
  return importBundle(JSON.parse(readFileSync(path,'utf8')),store,now,simulated).evidence;
}
export function loadRegistry(path:string,store:Store,now:string,simulated=false):Registry|null {
  if(!existsSync(path))return null;
  return verifyRegistry(JSON.parse(readFileSync(path,'utf8')),store,now,simulated);
}
export type LiveValidation=Validation|ResearchValidation;
export function loadValidations(path:string,store?:Store,at=nowISO()):LiveValidation[] {
  if(!existsSync(path))return[];
  const documents=z.array(z.object({validation:z.unknown(),report:z.record(z.string(),z.unknown())})).parse(JSON.parse(readFileSync(path,'utf8')));
  return documents.map(document=>{
    if(isResearchValidation(document.validation))return validateResearchDocument(document,store,at);
    const validation=validationSchema.parse(document.validation),report=document.report;
    if(hash(report)!==validation.reportHash||report.datasetHash!==validation.datasetHash||report.modelVersion!==validation.modelVersion||report.league!==validation.league||report.prop!==validation.prop||report.selected!==validation.selected)throw new Error('Validation manifest/report integrity mismatch');
    const score=z.object({brier:z.number().min(0).max(1),logLoss:z.number().nonnegative()}).nullable();
    const result=z.object({mode:z.enum(['as-of','retrospective']),simulated:z.boolean(),generatedAt:stamp,testPlayerGames:z.number().int(),testDates:z.number().int(),players:z.number().int(),testMetrics:z.record(z.string(),score),selectionMetrics:z.record(z.string(),score)}).parse(report);
    const selected=result.testMetrics[validation.selected],baseline=result.testMetrics.historical;
    const eligible=result.mode==='as-of'&&!result.simulated&&result.testPlayerGames>=200&&result.testDates>=30&&result.players>=10&&!!selected&&!!baseline&&selected.brier<=baseline.brier&&selected.logLoss<=baseline.logLoss;
    if(validation.generatedAt!==result.generatedAt||validation.asOfVerified!==(result.mode==='as-of')||validation.simulated!==result.simulated||validation.samples!==result.testPlayerGames||validation.dates!==result.testDates||validation.players!==result.players||validation.eligible!==eligible||validation.testBrier!==(selected?.brier??null)||validation.baselineTestBrier!==(baseline?.brier??null)||validation.testLogLoss!==(selected?.logLoss??null)||validation.baselineTestLogLoss!==(baseline?.logLoss??null))throw new Error('Validation eligibility or metric mismatch');
    return validation;
  });
}
export function completeness(logs:GameLog[]) {
  return (['NBA','NBL'] as const).map(league=>{
    const rows=logs.filter(r=>r.event.league===league&&!r.source.simulated),latest=new Map<string,GameLog>();
    rows.forEach(r=>latest.set(`${r.event.id}:${r.playerId}`,r));
    const unique=[...latest.values()];
    return{league,playerGames:unique.length,players:new Set(unique.map(r=>r.playerId)).size,minutes:unique.filter(r=>r.minutes!==null).length,
      points:unique.filter(r=>r.stats.points!==null).length,rebounds:unique.filter(r=>r.stats.rebounds!==null).length,assists:unique.filter(r=>r.stats.assists!==null).length,threes:unique.filter(r=>r.stats.threes!==null).length,
      first:unique.length?unique.map(r=>r.event.startsAt).sort()[0]:null,last:unique.length?unique.map(r=>r.event.startsAt).sort().at(-1):null};
  });
}
