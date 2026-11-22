import {ledgerSnapshot,ledgerCSV} from '../../../suggestions/ledger';
import {localOriginAllowed} from '../../../core/local-request';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(request:Request){if(!localOriginAllowed(request))return new Response('Origin denied',{status:403});return new Response(ledgerCSV(ledgerSnapshot()),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="edgelab-signals-ledger.csv"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
