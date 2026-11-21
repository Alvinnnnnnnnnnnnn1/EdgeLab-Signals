'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export function Refresh(){const router=useRouter();useEffect(()=>{const id=setInterval(()=>{if(document.visibilityState==='visible')router.refresh();},30000);return()=>clearInterval(id);},[router]);return null;}
