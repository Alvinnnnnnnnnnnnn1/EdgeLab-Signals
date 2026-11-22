import test from 'node:test';import assert from 'node:assert/strict';import {localOriginAllowed} from '../src/core/local-request';
test('same-origin ledger writes use the original loopback authority when Next exposes localhost internally',()=>{
 const url='http://localhost:3077/api/ledger/test';assert.equal(localOriginAllowed(new Request(url,{headers:{host:'127.0.0.1:3077',origin:'http://127.0.0.1:3077'}}),true),true);
 for(const origin of ['https://foreign.invalid','http://127.0.0.1:9999','null','http://localhost:3077'])assert.equal(localOriginAllowed(new Request(url,{headers:{host:'127.0.0.1:3077',origin}}),true),false);
 assert.equal(localOriginAllowed(new Request(url,{headers:{host:'127.0.0.1:3077'}}),true),false);assert.equal(localOriginAllowed(new Request(url,{headers:{host:'127.0.0.1:3077'}})),true);
 assert.equal(localOriginAllowed(new Request(url,{headers:{host:'foreign.invalid',origin:'http://foreign.invalid'}}),true),false);
});
