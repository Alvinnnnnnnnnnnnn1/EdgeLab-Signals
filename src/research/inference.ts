import { z } from 'zod';
import { hash, ms, ev, type Quote, type Context, type Forecast, type GameLog } from '../core/domain';
import { probabilities } from '../core/models';
import { features } from './features';
import { unknownMetadata } from './dataset';
import { predict, RESEARCH_VERSION, type ModelSpec,researchCandidateSchema } from './models';
import { calibrateCDF, type Calibration } from './calibration';
import { summary } from './distributions';
export const CERTIFICATE_VERSION = 'signal-research-validation/1.1.0';
export interface ResearchArtifact {
  protocol: string; modelVersion: string; datasetId: string; generatedAt: string; trainedBefore: string;
  bestSimple: ModelSpec; selected: ModelSpec; calibration: Calibration; featureNames: string[]; selectedAt: string; calibrationBefore: string; testIds: string;
}
const boostedSchema=z.object({base:z.number(),learningRate:z.number().gt(0).max(1),stumps:z.array(z.object({feature:z.number().int().min(0).max(9),threshold:z.number(),left:z.number(),right:z.number()}).strict()).max(500),features:z.array(z.number().int().min(0).max(9)).min(1),varianceExcess:z.number().nonnegative()}).strict();
const specSchema:z.ZodType<ModelSpec>=z.lazy(()=>z.object({candidate:researchCandidateSchema,seed:z.number().int(),draws:z.number().int().min(1000).max(100000),priorMinutes:z.number().min(1).max(10000),boosted:boostedSchema.optional(),ensemble:z.object({members:z.array(specSchema).min(2).max(3),weights:z.array(z.number().min(0).max(1)).min(2).max(3)}).strict().optional()}).strict().refine(s=>s.candidate!=='ensemble'||!!s.ensemble&&s.ensemble.members.every(m=>m.candidate!=='ensemble')&&s.ensemble.weights.length===s.ensemble.members.length&&Math.abs(s.ensemble.weights.reduce((a,b)=>a+b,0)-1)<1e-8,'Invalid ensemble specification'));
const calibrationSchema=z.discriminatedUnion('method',[z.object({method:z.literal('raw')}).strict(),z.object({method:z.literal('sigmoid'),a:z.number().min(.05).max(5),b:z.number().min(-5).max(5)}).strict(),z.object({method:z.literal('isotonic'),x:z.array(z.number().min(0).max(1)).min(2).max(200000),y:z.array(z.number().min(0).max(1)).min(2).max(200000)}).strict().refine(c=>c.x.length===c.y.length&&c.x[0]===0&&c.y[0]===0&&c.x.at(-1)===1&&c.y.at(-1)===1&&c.x.every((v,i)=>i===0||v>=c.x[i-1])&&c.y.every((v,i)=>i===0||v>=c.y[i-1]),'Calibration must be a monotone bounded CDF')]);
export const artifactSchema=z.object({protocol:z.literal('chronological-challenge/1.1.0'),modelVersion:z.literal(RESEARCH_VERSION),datasetId:z.string().regex(/^[a-f0-9]{64}$/),generatedAt:z.iso.datetime({offset:true}),trainedBefore:z.iso.date(),bestSimple:specSchema,selected:specSchema,calibration:calibrationSchema,featureNames:z.array(z.string()).length(10),selectedAt:z.iso.date(),calibrationBefore:z.iso.date(),testIds:z.string().regex(/^[a-f0-9]{64}$/)}).strict().refine(a=>a.trainedBefore<a.selectedAt&&a.selectedAt<a.calibrationBefore,'Artifact stage boundaries must be chronological');
export const researchValidationSchema = z.object({
  kind: z.literal(CERTIFICATE_VERSION), modelVersion: z.literal(RESEARCH_VERSION), league: z.enum(['NBA', 'NBL']), prop: z.enum(['points', 'rebounds', 'assists', 'threes']),
  generatedAt: z.iso.datetime({ offset: true }), datasetHash: z.string().regex(/^[a-f0-9]{64}$/), reportHash: z.string().regex(/^[a-f0-9]{64}$/),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/), artifact: artifactSchema,
  selected: z.string(), eligible: z.boolean(), asOfVerified: z.boolean(), simulated: z.literal(false), samples: z.number().int().nonnegative(), dates: z.number().int().nonnegative(), players: z.number().int().nonnegative(),
  monitoringHash: z.string().nullable(),
}).strict();
export type ResearchValidation = z.infer<typeof researchValidationSchema>;
export function isResearchValidation(v: unknown): v is ResearchValidation { return !!v && typeof v === 'object' && 'kind' in v && v.kind === CERTIFICATE_VERSION; }
export function researchForecast(logs: GameLog[], q: Quote, context: Context, at: string, validation: ResearchValidation, minGames: number): Forecast | null {
  const artifact = validation.artifact;
  if (artifact.modelVersion !== RESEARCH_VERSION || hash(artifact) !== validation.artifactHash || ms(artifact.generatedAt) > ms(at)) throw new Error('Frozen research artifact/version invalid');
  const rows = logs.map(log => ({ log, metadata: log.research ?? unknownMetadata() })).filter(r=>['regular','playoffs'].includes(r.metadata.phase));
  const f = features(rows, { event: q.event, playerId: q.playerId, teamId: q.teamId }, q.prop, 'as-of', at);
  if (!f || f.history.length < minGames) return null;
  if(hash(f.names)!==hash(artifact.featureNames))throw new Error('Frozen research feature contract changed');
  const raw = predict(f, artifact.selected), baseline = predict(f, artifact.bestSimple);
  if (!raw || !baseline) return null;
  const distribution = calibrateCDF(raw.pmf, artifact.calibration), p = probabilities(distribution, q.line, q.side), play = f.participation;
  if (play === null) return null; // A missing participation denominator never becomes certainty.
  const win = play * p.win, push = play * p.push, voidProbability = 1 - play;
  const penalty = 1.64 * Math.sqrt(win * (1 - win) / f.history.length);
  const stress = [raw.scenarios.low, raw.scenarios.high].map(minutes => {
    const adjusted = { ...f, minutes }, prediction = predict(adjusted, artifact.selected);
    if (!prediction) throw new Error('Missing stressed prediction');
    const p = probabilities(calibrateCDF(prediction.pmf, artifact.calibration), q.line, q.side);
    return ev(Math.max(0, play * p.win - penalty), play * p.push + voidProbability, q.decimalOdds);
  });
  const inputs = { logs: f.history.map(r => r.log), context, quote: q,research:{artifactHash:validation.artifactHash,features:f.values,featureNames:f.names,leagueLogs:f.leagueHistory.map(r=>r.log),participationLogs:f.opportunities.map(r=>r.log)} }, limitations = [...raw.limitations, 'Conservative sensitivity diagnostic is not a calibrated probability bound.'];
  if (context.expectedMinutes !== null && Math.abs(context.expectedMinutes - f.minutes) > 3) limitations.push('Verified projected minutes differ materially from the validated historical projector.');
  return { model: validation.selected, version: RESEARCH_VERSION, league: q.event.league, prop: q.prop, at, cutoff: at, inputHash: hash(inputs), n: f.history.length, expectedMinutes: f.minutes, minutesSD: f.minutesSD,
    mean: summary(distribution).mean, win, push, voidProbability, loss: play * p.loss, empiricalWin: win, gammaWin: play * probabilities(baseline.pmf, q.line, q.side).win,
    lowerWin: Math.max(0, win - penalty), robustEV: Math.min(...stress), limitations, inputs, distribution, benchmarkDistribution: baseline.pmf, artifactHash: validation.artifactHash };
}
