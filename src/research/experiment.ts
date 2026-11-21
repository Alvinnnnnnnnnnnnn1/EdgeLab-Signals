import { hash, ms, type League, type Prop } from '../core/domain';
import { auditDataset, rowKey, utcDay, validateRows, type Dataset, type ResearchRow } from './dataset';
import { preparedFeatures, type FeatureSet, type KnowledgeMode } from './features';
import { fitBoosted } from './boost';
import { controls, modelSpec, predict, RESEARCH_VERSION, type ModelSpec } from './models';
import { calibrateCDF, fitCalibration, type Calibration } from './calibration';
import { pairedDifference, scoreRows, type ScoredPrediction } from './scoring';
import {artifactSchema} from './inference';
import { average, mixPMFs, summary } from './distributions';
export const PROTOCOL = 'chronological-challenge/1.1.0';
export const thresholds: Record<League, Record<Prop, number[]>> = {
  NBA: { points: [10.5, 20.5, 30.5], rebounds: [3.5, 6.5, 9.5], assists: [2.5, 4.5, 6.5], threes: [.5, 1.5, 2.5] },
  NBL: { points: [8.5, 15.5, 22.5], rebounds: [2.5, 4.5, 6.5], assists: [1.5, 3.5, 5.5], threes: [.5, 1.5, 2.5] },
};
export function chronologicalSplit(dates: string[]) {
  const unique = [...new Set(dates)].sort();
  if (unique.length < 20) return null;
  return { trainEnd: unique[Math.floor(unique.length * .50)], selectionEnd: unique[Math.floor(unique.length * .65)], calibrationEnd: unique[Math.floor(unique.length * .80)], testEnd: unique.at(-1)!, dates: unique.length };
}
interface Example { row: ResearchRow; features: FeatureSet; }
const specID = (s: ModelSpec) => s.candidate === 'hierarchical-nb' ? `${s.candidate}:prior${s.priorMinutes}` : s.candidate;
const predictionCache=new WeakMap<ModelSpec,WeakMap<Example,ReturnType<typeof predict>>>();
function frozenRows(examples: Example[], spec: ModelSpec, calibration: Calibration = { method: 'raw' }): ScoredPrediction[] {
  return examples.map(example => {
    const {row,features:f}=example;
    let cache=predictionCache.get(spec);if(!cache){cache=new WeakMap();predictionCache.set(spec,cache);}let p=cache.get(example);if(p===undefined){p=predict(f,spec);cache.set(example,p);} if (!p) throw new Error(`Missing ${specID(spec)} prediction on common row`);
    return { id: rowKey(row), date: utcDay(row.log.event.startsAt), fixture: row.log.event.id, season: row.log.event.season, player: row.log.playerId, team: row.log.teamId,
      lowMinute: f.minutes < 15, y: row.log.stats[f.prop]!, pmf: calibrateCDF(p.pmf, calibration) };
  });
}
export function fitEnsemble(specs: ModelSpec[], selection: Example[], lines: number[]): ModelSpec | null {
  if (specs.length < 2 || selection.length < 200) return null;
  const ranked = specs.map(s => ({ spec: s, rows: frozenRows(selection, s) })).sort((a, b) => scoreRows(a.rows, lines)!.crps - scoreRows(b.rows, lines)!.crps);
  const members = ranked.slice(0, 3), bestScore = scoreRows(members[0].rows, lines)!.crps; let best: ModelSpec | null = null, score = bestScore;
  for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10 - a; b++) {
    const weights = members.length === 2 ? [a / 10, 1 - a / 10] : [a / 10, b / 10, (10 - a - b) / 10];
    if (weights.filter(w => w > 0).length < 2) continue;
    const rows = members[0].rows.map((r, i) => ({ ...r, pmf: mixPMFs(members.map(m => m.rows[i].pmf), weights) }));
    const candidate = scoreRows(rows, lines)!.crps;
    if (candidate < score - 1e-8) { score = candidate; best = { ...modelSpec('ensemble'), ensemble: { members: members.map(m => m.spec), weights } }; }
  }
  return best;
}
export function runExperiment(dataset: Dataset, league: League, prop: Prop, at: string, mode: KnowledgeMode = 'as-of',targetSeasons?:string[]) {
  if(targetSeasons&&(!targetSeasons.length||targetSeasons.some(s=>!/^\d{4}$/.test(s))))throw new Error('Target seasons must be explicit source season start years');
  if (ms(at) < ms(dataset.createdAt)) throw new Error('Dataset created after experiment clock');
  const all = validateRows(dataset.rows, at), source = all.filter(r => r.log.event.league === league && ['regular', 'playoffs'].includes(r.metadata.phase));
  const latest = new Map<string, ResearchRow>(); for (const r of source) latest.set(rowKey(r), r);
  const examples: Example[] = [], participation: { date: string; probability: number; y: number }[] = [];
  const getFeatures=preparedFeatures(source,mode);
  for (const row of latest.values()) {
    if(targetSeasons&&!targetSeasons.includes(row.log.event.season))continue;
    const f = getFeatures(row.log, prop); if (!f) continue;
    if (row.metadata.rosterOpportunityVerified && row.log.participated !== null && f.participation !== null) participation.push({ date: utcDay(row.log.event.startsAt), probability: f.participation, y: Number(row.log.participated) });
    if (row.log.participated === true && row.log.stats[prop] !== null && row.log.minutes !== null) examples.push({ row, features: f });
  }
  examples.sort((a, b) => ms(a.row.log.event.startsAt) - ms(b.row.log.event.startsAt) || rowKey(a.row).localeCompare(rowKey(b.row)));
  const split = chronologicalSplit(examples.map(e => utcDay(e.row.log.event.startsAt)));
  const base = { protocol: PROTOCOL, modelVersion: RESEARCH_VERSION, datasetId: dataset.id, league, prop, generatedAt: at, mode, genuine: true, audit: auditDataset(all), thresholds: thresholds[league][prop],cohort:{targetSeasons:targetSeasons??null,history:'All earlier source-qualified rows; target-season filtering never removes prior history.'} };
  if (!split || !examples.length) return { ...base, state: 'blocked' as const, reasons: ['Insufficient genuine, source-qualified chronological rows; no models trained or tested.'], split: null, models: [], selected: null, artifact: null, promotion: { eligible: false, reasons: ['No genuine benchmark'] } };
  const day = (e: Example) => utcDay(e.row.log.event.startsAt);
  const train = examples.filter(e => day(e) < split.trainEnd), selection = examples.filter(e => day(e) >= split.trainEnd && day(e) < split.selectionEnd);
  const calibration = examples.filter(e => day(e) >= split.selectionEnd && day(e) < split.calibrationEnd), test = examples.filter(e => day(e) >= split.calibrationEnd);
  if (![train, selection, calibration, test].every(r => r.length)) return { ...base, state: 'blocked' as const, reasons: ['An ordered experiment stage is empty.'], split, models: [], selected: null, artifact: null, promotion: { eligible: false, reasons: ['Empty experiment stage'] } };
  const specs: ModelSpec[] = [...controls.map(c => modelSpec(c)), ...[60, 120, 240].map(m => modelSpec('hierarchical-nb', m)), modelSpec('minutes-mc')], excluded: string[] = [];
  if (prop === 'threes') {
    if (examples.every(e => e.features.history.every(r => r.metadata.threeAttempts !== null) && e.features.leagueHistory.some(r => (r.metadata.threeAttempts ?? 0) > 0))) specs.push(modelSpec('attempts-beta-binomial'));
    else excluded.push('Attempts beta-binomial: missing genuine attempt history; not evaluated on a different cohort.');
  }
  if (train.length >= 200) {
    const x = train.map(e => e.features.values), y = train.map(e => e.row.log.stats[prop]!);
    specs.push({ ...modelSpec('boosted-stumps-nb'), boosted: fitBoosted(x, y, x[0].map((_, i) => i)) });
    specs.push({ ...modelSpec('boosted-form-only'), boosted: fitBoosted(x, y, [0, 1, 2, 3]) });
  } else excluded.push('Boosted challenger: fewer than 200 complete earlier training examples.');
  const lines = thresholds[league][prop];
  const ranked = specs.map(spec => ({ spec, metrics: scoreRows(frozenRows(selection, spec), lines)! })).sort((a, b) => a.metrics.crps - b.metrics.crps || a.metrics.brier - b.metrics.brier);
  const bestSimple = ranked.filter(r => controls.includes(r.spec.candidate))[0].spec;
  const ensemble = fitEnsemble(ranked.map(r => r.spec), selection, lines); if (ensemble) specs.push(ensemble);
  const selected = [...specs].sort((a, b) => scoreRows(frozenRows(selection, a), lines)!.crps - scoreRows(frozenRows(selection, b), lines)!.crps)[0];
  const calibrationDays = [...new Set(calibration.map(day))].sort(), midpoint = calibrationDays[Math.floor(calibrationDays.length / 2)];
  const calibrationFit = calibration.filter(e => day(e) < midpoint), calibrationChoose = calibration.filter(e => day(e) >= midpoint);
  const methods: Calibration[] = [{ method: 'raw' }], rawFit = frozenRows(calibrationFit, selected);
  for (const method of ['sigmoid', 'isotonic'] as const) { const c = fitCalibration(rawFit, method); if (c) methods.push(c); }
  const methodScores = methods.map(method => ({ method, metrics: scoreRows(frozenRows(calibrationChoose, selected, method), lines) }));
  const rawChoice = methodScores[0].metrics;
  const fitted = methodScores.filter(c => c.metrics && rawChoice && c.metrics.brier <= rawChoice.brier && c.metrics.logLoss <= rawChoice.logLoss).sort((a, b) => a.metrics!.brier - b.metrics!.brier)[0]?.method ?? methods[0];
  const models = specs.map(spec => {
    const raw = frozenRows(test, spec), calibrated = frozenRows(test, spec, spec === selected ? fitted : { method: 'raw' });
    const metrics = scoreRows(calibrated, lines)!, baseline = frozenRows(test, bestSimple);
    return { id: specID(spec), spec, rawMetrics: scoreRows(raw, lines), metrics, pairDate: pairedDifference(calibrated, baseline, lines), pairFixture: pairedDifference(calibrated, baseline, lines, 912, 500, 'fixture'),
      seasons: Object.fromEntries([...new Set(calibrated.map(r => r.season))].map(s => [s, scoreRows(calibrated.filter(r => r.season === s), lines)])),
      roles: { lowMinute: scoreRows(calibrated.filter(r => r.lowMinute), lines), regularRotation: scoreRows(calibrated.filter(r => !r.lowMinute), lines) } };
  });
  const selectedResult = models.find(m => m.id === specID(selected))!, baselineMetrics=scoreRows(frozenRows(test,bestSimple),lines)!;
  const selectedRows = frozenRows(test, selected, fitted), minutes = test.map(e => ({ prediction: e.features.minutes, actual: e.row.log.minutes! }));
  const targetIds = hash(test.map(e => rowKey(e.row))), baselineIds = hash(frozenRows(test, bestSimple).map(e => e.id));
  if (targetIds !== baselineIds) throw new Error('Model cohorts differ');
  const reasons: string[] = [], metrics = selectedResult.metrics;
  const participationTest=participation.filter(p=>p.date>=split.calibrationEnd),participationBias=participationTest.length?average(participationTest.map(p=>p.probability-p.y)):null;
  if (mode !== 'as-of') reasons.push('Historical publication availability unverified; retrospective research cannot activate.');
  if (metrics.playerGames < 200 || metrics.players < 10 || metrics.dates < 30) reasons.push('Engineering sample floor not met.');
  if (calibrationFit.length < 200 || calibrationChoose.length < 200) reasons.push('Independent calibration fit/selection samples insufficient.');
  if (metrics.ece > .05 || metrics.maxCalibrationGap===null || metrics.maxCalibrationGap>.08 || metrics.coverage80 < .70 || metrics.coverage80 > .90) reasons.push('Calibration or interval reliability gate failed.');
  if (selectedResult.pairDate.interval95.crps[1] > 0 || metrics.brier > baselineMetrics.brier || metrics.logLoss > baselineMetrics.logLoss) reasons.push('No robust paired improvement over strongest earlier-selected simple control.');
  if(test.some(e=>e.row.metadata.overtimePeriods===null))reasons.push('Overtime/duration coverage incomplete.');
  if(participationTest.length<200||participationBias===null||Math.abs(participationBias)>.05)reasons.push('Held-out participation probability calibration insufficient.');
  if (test.some(e => e.features.participation === null)) reasons.push('Participation probabilities lack a verified opportunity denominator.');
  // No historical-only statistical result authorizes live recommendations. Prospective evidence is a separate artifact.
  const statisticalReasons=[...reasons];
  reasons.push('Later prospective monitoring, permitted availability archive and real Sportsbet quote comparison are not attached.');
  const artifact = artifactSchema.parse({ protocol: PROTOCOL, modelVersion: RESEARCH_VERSION, datasetId: dataset.id, trainedBefore: split.trainEnd, generatedAt:at, bestSimple, selected, calibration: fitted, featureNames: test[0].features.names, selectedAt: split.selectionEnd, calibrationBefore: split.calibrationEnd, testIds: targetIds });
  return { ...base, state: 'evaluated' as const, split, stageCounts: { train: train.length, selection: selection.length, calibrationFit: calibrationFit.length, calibrationChoose: calibrationChoose.length, test: test.length }, excluded, models,
    selected: specID(selected), bestSimple: specID(bestSimple),baselineMetrics, artifact, artifactHash: hash(artifact), calibrationMethods: methodScores,
    quality:{unknownOvertime:test.filter(e=>e.row.metadata.overtimePeriods===null).length,unknownParticipation:test.filter(e=>e.features.participation===null).length},
    predictiveScope: 'Count distribution conditional on participating. DNP is a separately modelled void; not a zero-production count.',
    minutes: { mae: average(minutes.map(m => Math.abs(m.prediction - m.actual))), bias: average(minutes.map(m => m.prediction - m.actual)), actualTargetMinutesUsedAsInput: false },
    participation: {eligibleOpportunities:participationTest.length,bias:participationBias,brier:participationTest.length?average(participationTest.map(p=>(p.probability-p.y)**2)):null},
    ensemble: ensemble ? { selectedByEarlierWindow: selected.candidate === 'ensemble', testComparisonWithStrongestEarlierIndividual: pairedDifference(frozenRows(test, ensemble), frozenRows(test, ranked[0].spec), lines), warning: 'Members share data; correlation is not independent corroboration.' } : { state: 'not_selected', reason: 'Earlier window did not support an ensemble or was too small.' },
    ablations: { minutesVsFixed: pairedDifference(frozenRows(test, modelSpec('minutes-mc')), frozenRows(test, modelSpec('hierarchical-nb')), lines),
      boostedContext: specs.some(s => s.candidate === 'boosted-stumps-nb') ? pairedDifference(frozenRows(test, specs.find(s => s.candidate === 'boosted-stumps-nb')!), frozenRows(test, specs.find(s => s.candidate === 'boosted-form-only')!), lines) : null },
    frozenPredictions: selectedRows, promotion: { eligible: false, statisticalEligible:statisticalReasons.length===0, statisticalReasons, reasons }, limitations: ['Statistical thresholds are predefined analysis targets, not historical bookmaker quotes.', 'No ROI is calculated.', 'No missing context is encoded as an observed zero.'] };
}
export type Experiment = ReturnType<typeof runExperiment>;
