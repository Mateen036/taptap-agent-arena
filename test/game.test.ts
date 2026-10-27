import {test} from 'node:test';import assert from 'node:assert/strict';
import {tickPlan,energyAt,parseCommand,canonical} from '../lib/game';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';import {verifyTypedData} from 'viem';import {actionData,sessionData} from '../lib/protocol';
const a={power_level:1,tank_level:1,speed_level:1,energy:1000,points:0,updated_at:1000};
test('time and energy bound every tap; no offline accrual',()=>{const c={last_tick:1000,status:'running',target:10000,done:0};assert.equal(tickPlan(a,c,100,2000).taps,5);assert.equal(tickPlan(a,c,100,1000000).taps,50);assert.equal(tickPlan({...a,energy:2},c,100,11000).taps,2);assert.throws(()=>tickPlan(a,c,100,1000));assert.throws(()=>tickPlan(a,c,-1,5000));assert.throws(()=>tickPlan(a,c,Infinity,5000));assert.equal(energyAt({...a,energy:50},11000),100);assert.equal(energyAt({...a,energy:50},11000,true),50);assert.equal(energyAt(a,1000000),1000);});
test('commands have bounded valid targets',()=>{assert.equal(parseCommand('Tap 100 times'),100);assert.equal(parseCommand('Use 500 energy'),500);assert.throws(()=>parseCommand('tap -1 times'));assert.throws(()=>parseCommand('tap 10001 times'));assert.throws(()=>parseCommand('hello'));});
test('signatures bind session, origin, payload, timestamp and nonce',async()=>{const key=privateKeyToAccount(generatePrivateKey()),e={sessionId:'test',nonce:0,timestamp:1000,action:'tap',payload:{taps:5,commandId:'c'}};const d=actionData('https://game.test',e),signature=await key.signTypedData(d as any);assert.equal(await verifyTypedData({address:key.address,...d,signature} as any),true);for(const changed of [{...e,nonce:1},{...e,payload:{taps:10,commandId:'c'}},{...e,action:'start'}])assert.equal(await verifyTypedData({address:key.address,...actionData('https://game.test',changed),signature} as any),false);assert.equal(await verifyTypedData({address:key.address,...actionData('https://evil.test',e),signature} as any),false);assert.equal(canonical({b:1,a:2}),canonical({a:2,b:1}));});

test('wallet session domain omits salt while signatures bind the origin and challenge',async()=>{
 const wallet=privateKeyToAccount(generatePrivateKey()),sessionKey=privateKeyToAccount(generatePrivateKey());
 const challenge={id:'challenge-one',session_key:sessionKey.address,expires_at:1800000000000};
 const typed=sessionData('https://game.test',challenge);
 assert.deepEqual(Object.keys(typed.domain).sort(),['chainId','name','version']);
 assert.equal(typed.domain.version,'2');
 const signature=await wallet.signTypedData(typed as any);
 assert.equal(await verifyTypedData({address:wallet.address,...typed,signature} as any),true);
 for(const changed of [sessionData('https://other.test',challenge),sessionData('https://game.test',{...challenge,id:'challenge-two'}),sessionData('https://game.test',{...challenge,session_key:wallet.address}),sessionData('https://game.test',{...challenge,expires_at:challenge.expires_at+1})]){
  assert.equal(await verifyTypedData({address:wallet.address,...changed,signature} as any),false);
 }
 const saltedSignature=await wallet.signTypedData({...typed,domain:{...typed.domain,salt:'0x'+'11'.repeat(32)}} as any);
 assert.equal(await verifyTypedData({address:wallet.address,...typed,signature:saltedSignature} as any),false);
});
