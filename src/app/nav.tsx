'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export function Nav(){const path=usePathname();return<nav aria-label="Main navigation">{[['/opportunities','◈','NBA Picks'],['/ledger','≡','Signals Ledger'],['/performance','▥','Performance'],['/status','◎','System Status']].map(([href,icon,label])=><Link key={href} href={href} aria-current={path===href?'page':undefined}><span aria-hidden="true">{icon}</span>{label}</Link>)}</nav>;}
