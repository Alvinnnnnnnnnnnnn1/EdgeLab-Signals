import {readFileSync,readdirSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {hash} from '../core/domain';
/** The complete source/runtime dependency closure, including routing, worker,
 * registration, scoring, providers and settlement. Same generator at prepare
 * and verification; deleting a manifest entry cannot weaken verification. */
export function productionManifest(root=process.cwd()){
 const walk=(path:string):string[]=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(path,e.name)):[resolve(path,e.name)]);
 const files=[...walk(resolve(root,'src')),...walk(resolve(root,'scripts')),...['package.json','package-lock.json','tsconfig.json'].map(f=>resolve(root,f))].map(f=>relative(root,f)).sort();
 return Object.fromEntries(files.map(f=>[f,hash(readFileSync(resolve(root,f),'utf8'))]));
}
export function productionCode(){return{commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),files:productionManifest()};}
