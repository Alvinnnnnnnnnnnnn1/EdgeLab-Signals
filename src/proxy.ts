import { NextResponse, type NextRequest } from 'next/server';
export function proxy(request:NextRequest){
  let hostname='';try{hostname=new URL(`http://${request.headers.get('host')??''}`).hostname;}catch{/* Refuse malformed Host. */}
  if(!['127.0.0.1','localhost','[::1]'].includes(hostname))return new NextResponse('Local workspace only',{status:403});
  const response=NextResponse.next();
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Referrer-Policy','no-referrer');
  response.headers.set('X-Frame-Options','DENY');
  response.headers.set('Content-Security-Policy',"frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
