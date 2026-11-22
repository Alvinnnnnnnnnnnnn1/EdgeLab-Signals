// Next may expose its internal listener hostname in request.url. The browser's
// authority is the original Host, which must independently remain loopback-only.
export function localOriginAllowed(request:Request,required=false){
  try{const internal=new URL(request.url),target=new URL(`${internal.protocol}//${request.headers.get('host')??internal.host}`);
    if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.username||target.password||target.pathname!=='/'||target.search||target.hash)return false;
    const origin=request.headers.get('origin');return origin===null?!required:origin===target.origin;
  }catch{return false;}
}
