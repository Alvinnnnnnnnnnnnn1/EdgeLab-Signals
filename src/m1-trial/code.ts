import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve,dirname } from 'node:path';
import { hash } from '../core/domain';
import { engineeringFiles } from '../model-engineering/code';
import { productionManifest } from '../production/manifest';
import type { TrialProtocol } from './contracts';
export const trialRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const statisticalHash=()=>hash(Object.fromEntries(engineeringFiles.map(p=>[p,hash(readFileSync(resolve(trialRoot,p),'utf8'))])));
const codes=new Map<string,string>();
export function trialCodeHash(root=trialRoot){let code=codes.get(root);if(!code){code=hash(productionManifest(root));codes.set(root,code);}return code;}
export function assertFrozenConfiguration(p:TrialProtocol){for(const [path,digest]of Object.entries(p.configurationHashes))if(hash(readFileSync(path,'utf8'))!==digest)throw Error('TRIAL_FROZEN_CONFIGURATION_CHANGED');}
