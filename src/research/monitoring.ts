import { hash, ms, quoteFresh, type Decision,nowISO } from '../core/domain';
import { Store } from '../core/store';
import { pairedDifference, scoreRows, type ScoredPrediction } from './scoring';
import { thresholds, type Experiment } from './experiment';
import { utcDay } from './dataset';
import {artifactSchema,researchValidationSchema,type ResearchArtifact,type ResearchValidation} from './inference';
import { RESEARCH_VERSION } from './models';
export function monitor(store: Store, artifact: ResearchArtifact, artifactHash: string, league: ResearchValidation['league'], prop: ResearchValidation['prop'], at: string) {
  const scores = new Map<string, { selected: ScoredPrediction; baseline: ScoredPrediction }>(),participations=new Map<string,{p:number;y:number}>(), finals = store.logs();
  for (const entry of store.screenings()) {
    const d = entry.decision, q = d.quote, f = d.forecast;
    if (entry.simulated || !f?.distribution || !f.benchmarkDistribution || f.artifactHash !== artifactHash || q.event.league !== league || q.prop !== prop ||q.bookmaker!=='sportsbet'|| ms(entry.at) < ms(artifact.generatedAt) || ms(entry.at) >= ms(q.event.startsAt) || !quoteFresh(q, entry.at)) continue;
    const featureLogs=[...f.inputs.logs,...(f.inputs.research?.leagueLogs??[]),...(f.inputs.research?.participationLogs??[])];
    if(featureLogs.some(l=>l.source.simulated||(l.supportingSources??[]).some(s=>s.simulated)||!store.hasReceipt(l.source)))continue;
    if(hash(f.inputs)!==f.inputHash)continue;
    if (!store.hasReceipt(q.source) || !d.evidence.terms || !store.hasReceipt(d.evidence.terms.source) || f.inputs.context.status !== 'available' || !f.inputs.context.rosterVerified || !store.hasReceipt(f.inputs.context.source)) continue;
    if([q.source,d.evidence.terms!.source,f.inputs.context.source].some(s=>s.simulated))continue;
    if (ms(f.inputs.context.observedAt) > ms(entry.at) || ms(entry.at) - ms(f.inputs.context.observedAt) > 1800000) continue;
    const log = finals.filter(r => r.final && !r.source.simulated && r.event.id === q.event.id && r.playerId === q.playerId && r.teamId === q.teamId && r.event.league === league && r.event.homeId === q.event.homeId && r.event.awayId === q.event.awayId && r.participated !== null && ms(r.observedAt) <= ms(at) && ms(r.observedAt) > ms(q.event.startsAt) && [r.source,...(r.supportingSources??[])].every(s=>store.hasReceipt(s))).sort((a, b) => ms(b.observedAt) - ms(a.observedAt))[0];
    if (!log) continue;
    const id = `${q.event.id}:${q.playerId}`;
    if(!participations.has(id)&&f.voidProbability!==undefined)participations.set(id,{p:1-f.voidProbability,y:Number(log.participated)});
    if(log.participated!==true||log.stats[prop]===null||scores.has(id))continue;
    const common = { id, date: utcDay(q.event.startsAt), fixture: q.event.id, season: q.event.season, player: q.playerId, team: q.teamId, lowMinute: f.expectedMinutes < 15, y: log.stats[prop]! };
    scores.set(id, { selected: { ...common, pmf: f.distribution }, baseline: { ...common, pmf: f.benchmarkDistribution } });
  }
  const rows = [...scores.values()], lines = thresholds[league][prop], selected = rows.map(r => r.selected), baseline = rows.map(r => r.baseline), metrics = scoreRows(selected, lines), baselineMetrics = scoreRows(baseline, lines);
  const paired = rows.length ? pairedDifference(selected, baseline, lines) : null;
  const opportunities=[...participations.values()],participationBias=opportunities.length?opportunities.reduce((n,p)=>n+p.p-p.y,0)/opportunities.length:null;
  const reasons: string[] = [];
  if(opportunities.length<200||participationBias===null||Math.abs(participationBias)>.05)reasons.push('Prospective participation calibration not established.');
  if (!metrics || metrics.playerGames < 200 || metrics.players < 10 || metrics.dates < 30) reasons.push('Insufficient genuinely frozen prospective player-games/players/dates.');
  if (!metrics || metrics.ece > .05 || metrics.maxCalibrationGap===null || metrics.maxCalibrationGap>.08 || metrics.coverage80 < .70 || metrics.coverage80 > .90) reasons.push('Prospective probability/interval reliability insufficient.');
  if (!metrics || !baselineMetrics || !paired || paired.interval95.crps[1] > 0 || metrics.brier > baselineMetrics.brier || metrics.logLoss > baselineMetrics.logLoss) reasons.push('Prospective paired benchmark gate not passed.');
  const result = { artifactHash, league, prop, at, sampleIds: selected.map(r => r.id),participation:{opportunities:opportunities.length,bias:participationBias}, metrics, baselineMetrics, paired, eligible: reasons.length === 0, reasons, scope: 'All first eligible genuine market screenings, including unissued and losing candidates; one row per player-game.' };
  return { ...result, hash: hash(result) };
}
export function certificate(report: Experiment, store: Store, at: string): ResearchValidation | null {
  if (report.state !== 'evaluated' || !report.artifact) return null;
  const monitored = monitor(store, report.artifact, report.artifactHash!, report.league, report.prop, at);
  const selected=report.models.find(m=>m.id===report.selected)!,baseline=report.baselineMetrics,m=selected.metrics;
  const statistical = report.mode==='as-of'&&m.playerGames>=200&&m.players>=10&&m.dates>=30&&report.stageCounts.calibrationFit>=200&&report.stageCounts.calibrationChoose>=200&&m.ece<=.05&&m.maxCalibrationGap!==null&&m.maxCalibrationGap<=.08&&m.coverage80>=.70&&m.coverage80<=.90&&selected.pairDate.interval95.crps[1]<=0&&m.brier<=baseline.brier&&m.logLoss<=baseline.logLoss&&report.quality.unknownOvertime===0&&report.quality.unknownParticipation===0&&report.participation.eligibleOpportunities>=200&&report.participation.bias!==null&&Math.abs(report.participation.bias)<=.05;
  if(statistical!==report.promotion.statisticalEligible)throw new Error('Research statistical gate mismatch');
  return { kind: 'signal-research-validation/1.1.0', modelVersion: RESEARCH_VERSION, league: report.league, prop: report.prop, generatedAt: at, datasetHash: report.datasetId,
    reportHash: hash(report), artifact: artifactSchema.parse(report.artifact), artifactHash: report.artifactHash!, selected: report.selected!, eligible: statistical && monitored.eligible, asOfVerified: report.mode === 'as-of', simulated: false,
    samples: report.models.find(m => m.id === report.selected)!.metrics.playerGames, players: report.models.find(m => m.id === report.selected)!.metrics.players, dates: report.models.find(m => m.id === report.selected)!.metrics.dates,
    monitoringHash: monitored.hash };
}
export function validateResearchDocument(raw: unknown, store?: Store,at=nowISO()): ResearchValidation {
  const input = raw as { validation: ResearchValidation; report: Experiment };
  const v = researchValidationSchema.parse(input.validation), r = input.report;
  if (!r || r.state !== 'evaluated' || !r.artifact || hash(r) !== v.reportHash || hash(r.artifact) !== v.artifactHash || r.datasetId !== v.datasetHash || r.artifactHash !== v.artifactHash || r.league !== v.league || r.prop !== v.prop || r.selected !== v.selected || hash(r.artifact) !== hash(v.artifact)) throw new Error('V1.1 report/artifact identity mismatch');
  if (!store) throw new Error('V1.1 validation needs its retained prospective evidence store');
  const expected = certificate(r, store, v.generatedAt);
  if (!expected || hash(expected) !== hash(v)) throw new Error('V1.1 promotion or prospective evidence mismatch');
  if(v.eligible&&(ms(at)-ms(v.artifact.generatedAt)>90*86400000||!monitor(store,v.artifact,v.artifactHash,v.league,v.prop,at).eligible))return{...v,eligible:false};
  return v;
}
