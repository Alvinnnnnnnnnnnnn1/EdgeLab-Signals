import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from './nav';
import { Refresh } from './refresh';
import './style.css';
export const metadata:Metadata={title:'EdgeLab Signals',description:'Independent NBA and NBL player-prop research.'};
export default function Layout({children}:{children:React.ReactNode}) {
  return<html lang="en-AU"><body><a href="#main" className="skip">Skip to content</a><div className="app-shell"><aside className="sidebar"><Link href="/opportunities" className="brand"><span className="brand-mark" aria-hidden="true">E<span>╱</span></span><span>EDGELAB<small>SIGNALS</small></span></Link><div className="sidebar-label">RESEARCH WORKSPACE</div><Nav/><div className="sidebar-foot"><span className="league-label">NBA <i/> NBL</span><p>Independent research.<br/>Evidence before opportunity.</p><span className="version">V1 · PRIVATE WORKSPACE</span></div></aside><div className="workspace"><header className="topbar"><span>Basketball intelligence</span><span className="topbar-meta">PLAYER PROPS <span>/</span> RESEARCH ONLY</span></header><main id="main">{children}</main><footer>EdgeLab Signals · Recommendations are recorded automatically. Performance uses hypothetical units.</footer></div></div><Refresh/></body></html>;
}
