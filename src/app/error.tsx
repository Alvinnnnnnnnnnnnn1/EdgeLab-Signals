'use client';
export default function Error({reset}:{reset:()=>void}){return<div className="panel padded"><h1>Workspace data unavailable</h1><p className="muted">The private database or configuration could not be read. Check the local configuration, permissions and database integrity, then retry.</p><p className="note"><button onClick={reset}>Retry</button></p></div>;}
