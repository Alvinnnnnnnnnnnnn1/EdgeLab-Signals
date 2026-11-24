import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { engineeringReport } from './report';
const path = process.argv[2];
if (!path || !resolve(path).includes('/.local/') || !path.endsWith('/engineering-shadow.sqlite')) throw Error('Usage: report-cli PRIVATE_ENGINEERING_JOURNAL');
const db = new DatabaseSync(path, { readOnly: true });
try { console.log(JSON.stringify(engineeringReport(db), null, 2)); } finally { db.close(); }
