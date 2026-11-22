import { snapshot } from '../../../core/snapshot';
import {localOriginAllowed} from '../../../core/local-request';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(request:Request){if(!localOriginAllowed(request))return Response.json({error:'Origin denied'},{status:403});return Response.json(snapshot(),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
