import { Store } from '../core/store';
import { hash,type GameLog } from '../core/domain';
import { bdlPhase } from '../providers/balldontlie';
import { unknownMetadata,type ResearchRow } from './dataset';
export const METADATA_VERSION='bdl-derived-metadata/1.4.0';
/** Derive current research metadata from exact original bytes; never rewrite a
 * normalized log, receipt or historical dataset to correct Cup classification. */
export function researchRows(store:Store,logs=store.logs()):ResearchRow[]{
  const bodies=new Map<string,unknown>(),verified=new Set<string>();
  return logs.filter(l=>!l.source.simulated).map(log=>{
    const metadata={...(log.research??unknownMetadata())};
    if(log.source.provider==='balldontlie'){
      const native=Number(log.event.id.split(':').at(-1));
      for(const source of [...(log.supportingSources??[]),log.source]){
        const key=hash(source);if(!verified.has(key)){if(!store.hasReceipt(source))throw new Error('Original metadata source missing');verified.add(key);}
        let raw=bodies.get(source.hash);
        if(!raw){const entry=store.db.prepare('SELECT body FROM receipts WHERE hash=?').get(source.hash) as {body:string};raw=JSON.parse(entry.body);bodies.set(source.hash,raw);}
        const data=(raw as {data?:unknown[]}).data??[];
        const game=data.map(r=>{const x=r as {game?:unknown};return x.game??r;}).find(g=>(g as {id?:number}).id===native);
        if(game){metadata.phase=bdlPhase(game);break;}
      }
    }
    return{log,metadata};
  });
}
export function metadataDiff(rows:ResearchRow[]){return{version:METADATA_VERSION,changed:rows.filter(r=>r.metadata.phase!==r.log.research?.phase).length,hash:hash(rows.map(r=>[r.log.event.id,r.log.playerId,r.log.source.hash,r.metadata]))};}
