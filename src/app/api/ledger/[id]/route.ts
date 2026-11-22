import {loadConfig} from '../../../../core/config';import {Store} from '../../../../core/store';import {annotateSuggestion,readLedger} from '../../../../suggestions/ledger';
import {localOriginAllowed} from '../../../../core/local-request';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!localOriginAllowed(request,true)||request.headers.get('content-type')?.split(';')[0]!=='application/json')return Response.json({error:'Same-origin JSON request required'},{status:403});
 const text=await request.text();if(text.length>4096)return Response.json({error:'Request too large'},{status:413});const config=loadConfig(),store=new Store(process.env.EDGELAB_DB||config.database);
 try{const {id}=await params;const annotation=annotateSuggestion(store,id,JSON.parse(text),new Date().toISOString());return Response.json({saved:true,annotation,row:readLedger(store,config).rows.find(row=>row.id===id)},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Unknown suggestion or invalid placement fields'},{status:400});}finally{store.close();}
}
