import { snapshot } from '../../../core/snapshot';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origin denied'},{status:403});return Response.json(snapshot(),{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
