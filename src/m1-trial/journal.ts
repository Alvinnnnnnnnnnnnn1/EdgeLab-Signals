import { hash, ms } from '../core/domain';
import { EngineeringJournal } from '../model-engineering/journal';
import type { ExperimentalForecast } from '../suggestions/forecasts';
import { assertProtocol, type TrialProtocol } from './contracts';

export function installTrial(j:EngineeringJournal,p:TrialProtocol){
  assertProtocol(p);
  j.db.exec(`CREATE TABLE IF NOT EXISTS m1_trial_protocols(id TEXT PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS m1_trial_ready(id TEXT PRIMARY KEY,protocol_id TEXT NOT NULL REFERENCES m1_trial_protocols(id),prediction_id TEXT NOT NULL REFERENCES engineering_predictions(id),event_id TEXT NOT NULL,player_id TEXT NOT NULL,prop TEXT NOT NULL,at TEXT NOT NULL,body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS m1_trial_lookup ON m1_trial_ready(protocol_id,event_id,player_id,prop,at);
    CREATE TABLE IF NOT EXISTS m1_trial_reviews(id TEXT PRIMARY KEY,at TEXT NOT NULL,body TEXT NOT NULL);`);
  for(const t of ['m1_trial_protocols','m1_trial_ready','m1_trial_reviews'])for(const op of ['UPDATE','DELETE'])j.db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${t}_${op} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT,'Trial evidence is immutable'); END;`);
  j.db.prepare('INSERT OR IGNORE INTO m1_trial_protocols VALUES (?,?)').run(p.id,JSON.stringify(p));
  if(String(j.db.prepare('SELECT body FROM m1_trial_protocols WHERE id=?').get(p.id)!.body)!==JSON.stringify(p))throw Error('TRIAL_PROTOCOL_COLLISION');
}
export function ready(j:EngineeringJournal,p:TrialProtocol,prediction:any,f:ExperimentalForecast){
  if(prediction.artifact.id!==p.modelId||prediction.featureHash!==(f.inputs as any).featureHash||prediction.registeredAt!==f.at||hash(prediction.distribution)!==hash(f.distribution)||prediction.state.event.id!==f.event.id||prediction.state.playerId!==f.playerId||prediction.prop!==f.prop||f.prop==='threes'||ms(f.at)>=ms(f.event.startsAt)-120000||f.inputHash!==hash(f.inputs))throw Error('EXACT_M1_PRODUCTION_BINDING_REQUIRED');
  const body={protocolId:p.id,predictionId:prediction.id,predictionBodyHash:prediction.bodyHash,forecast:f,bodyHash:hash(f),classification:p.classification,formalPromotion:false},id=hash(body);
  j.db.prepare('INSERT OR IGNORE INTO m1_trial_ready VALUES (?,?,?,?,?,?,?,?)').run(id,p.id,prediction.id,f.event.id,f.playerId,f.prop,f.at,JSON.stringify({...body,id}));return id;
}
