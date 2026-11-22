import {Store} from '../core/store';
import {hash} from '../core/domain';

// Installed only by the new issuance/delivery path, never by Store construction
// or a dashboard read. Preparing this release does not migrate the live DB.
const ready=new WeakSet<Store['db']>();
export function ensureSuggestionFamilies(store:Store){
 if(ready.has(store.db))return;
 store.transaction(()=>{
  store.db.exec(`CREATE TABLE IF NOT EXISTS experimental_suggestion_families(
    family TEXT PRIMARY KEY, first_id TEXT NOT NULL UNIQUE REFERENCES experimental_suggestions(id), issued_at TEXT NOT NULL
  );`);
  // No grading/delivery/supersession filter: every immutable issue consumes its
  // family. Existing duplicate rows survive; earliest at/id represents them.
  const history=store.db.prepare("SELECT id,at,family,json_extract(body,'$.quote.event.id') AS event,json_extract(body,'$.quote.playerId') AS player,json_extract(body,'$.quote.prop') AS prop FROM experimental_suggestions ORDER BY at,id").all();
  const insert=store.db.prepare('INSERT OR IGNORE INTO experimental_suggestion_families VALUES (?,?,?)');
  for(const row of history){if(typeof row.event!=='string'||typeof row.player!=='string'||typeof row.prop!=='string'||hash([row.event,row.player,row.prop])!==row.family)throw new Error('HISTORICAL_SUGGESTION_FAMILY_MISMATCH');insert.run(row.family!,row.id!,row.at!);}
  store.db.exec(`
   CREATE TRIGGER IF NOT EXISTS suggestion_family_once BEFORE INSERT ON experimental_suggestions
    WHEN EXISTS(SELECT 1 FROM experimental_suggestion_families WHERE family=NEW.family)
    BEGIN SELECT RAISE(ABORT,'Recommendation family already issued'); END;
   CREATE TRIGGER IF NOT EXISTS suggestion_family_claim AFTER INSERT ON experimental_suggestions
    BEGIN INSERT INTO experimental_suggestion_families VALUES(NEW.family,NEW.id,NEW.at); END;
   CREATE TRIGGER IF NOT EXISTS immutable_suggestion_family_update BEFORE UPDATE ON experimental_suggestion_families
    BEGIN SELECT RAISE(ABORT,'Recommendation family claims are permanent'); END;
   CREATE TRIGGER IF NOT EXISTS immutable_suggestion_family_delete BEFORE DELETE ON experimental_suggestion_families
    BEGIN SELECT RAISE(ABORT,'Recommendation family claims are permanent'); END;
  `);
 });
 ready.add(store.db);
}

/** Called in the same transaction as the outbox sending claim. It also fences
 * legacy duplicate IDs/batches: accepted, interrupted and uncertain submissions
 * consume delivery; a known rejection may retry the original outbox as before. */
export function duplicateFamilyDelivery(store:Store,outboxId:string,ids:string[]){
 if(!ids.length)return true;
 const families:string[]=[];
 for(const id of ids){const row=store.db.prepare('SELECT s.family,c.first_id FROM experimental_suggestions s LEFT JOIN experimental_suggestion_families c ON c.family=s.family WHERE s.id=?').get(id)as{family:string;first_id:string}|undefined;if(!row||row.first_id!==id||families.includes(row.family))return true;families.push(row.family);}
 return!!store.db.prepare(`SELECT o.id FROM experimental_outbox o,json_each(o.body,'$.ids') item
   JOIN experimental_suggestions s ON s.id=item.value
   WHERE o.id<>? AND (o.state IN ('accepted','sending','uncertain') OR o.message_id IS NOT NULL)
   AND s.family IN (SELECT value FROM json_each(?)) LIMIT 1`).get(outboxId,JSON.stringify(families));
}
