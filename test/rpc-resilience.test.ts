import {test} from 'node:test';import assert from 'node:assert/strict';
import {createPublicClient} from 'viem';import {bsc} from 'viem/chains';
import {bscTransport,mapLimit,errorSummary,PUBLIC_BSC_RPCS} from '../lib/rpc';
// Regression: the web Convert tab (and the NFT / game-gate checks) failed intermittently because every chain read went through ONE rate-limited public RPC endpoint.
const rpcMock=(handler:(url:string,b:any)=>Response|null)=>{const old=globalThis.fetch,calls:string[]=[];globalThis.fetch=(async(url:any,o:any)=>{const u=String(url).replace(/\/$/,'');calls.push(u);const b=JSON.parse(o?.body||'{}');return handler(u,b)||old(url,o);}) as any;return {calls,restore:()=>{globalThis.fetch=old;}};};
const ok=(b:any,result:any)=>Response.json({jsonrpc:'2.0',id:b.id,result});
test('default RPC: a rate-limited first endpoint (HTTP 429) falls through to the next one instead of failing the request',async()=>{
 const m=rpcMock((url,b)=>url===PUBLIC_BSC_RPCS[0]?new Response('Too Many Requests',{status:429}):ok(b,'0x10'));
 try{const c=createPublicClient({chain:bsc,transport:bscTransport()});assert.equal(await c.getBlockNumber({cacheTime:0}),16n);assert.equal(m.calls[0],PUBLIC_BSC_RPCS[0]);assert.ok(m.calls.length>=2&&m.calls.at(-1)!==PUBLIC_BSC_RPCS[0]);}finally{m.restore();}
});
test('default RPC: two endpoints failing in a row still resolve on a later one; all failing surfaces an error',async()=>{
 let m=rpcMock((url,b)=>PUBLIC_BSC_RPCS.slice(0,2).includes(url as any)?new Response('nope',{status:503}):ok(b,'0x11'));
 try{const c=createPublicClient({chain:bsc,transport:bscTransport()});assert.equal(await c.getBlockNumber({cacheTime:0}),17n);}finally{m.restore();}
 m=rpcMock(()=>new Response('down',{status:503}));
 try{const c=createPublicClient({chain:bsc,transport:bscTransport()});await assert.rejects(c.getBlockNumber({cacheTime:0}));}finally{m.restore();}
});
test('a configured RPC URL is used on its own and retried on a transient failure',async()=>{
 let n=0;const m=rpcMock((url,b)=>url==='https://rpc.example.test'?(n++===0?new Response('busy',{status:429}):ok(b,'0x12')):null);
 try{const c=createPublicClient({chain:bsc,transport:bscTransport('https://rpc.example.test')});assert.equal(await c.getBlockNumber({cacheTime:0}),18n);assert.ok(m.calls.every(u=>u==='https://rpc.example.test'));}finally{m.restore();}
});
test('mapLimit keeps order and never exceeds the concurrency limit (a 190-NFT wallet no longer bursts 380 RPC calls)',async()=>{
 let live=0,peak=0;const out=await mapLimit(Array.from({length:190},(_,i)=>i),16,async i=>{live++;peak=Math.max(peak,live);await new Promise(r=>setTimeout(r,2));live--;return i*2;});
 assert.equal(out.length,190);assert.deepEqual(out.slice(0,4),[0,2,4,6]);assert.equal(out[189],378);assert.ok(peak<=16,'peak '+peak);assert.deepEqual(await mapLimit([],4,async x=>x),[]);
});
test('error logs carry a short cause but never an RPC URL (which can embed a provider key)',()=>{
 const e:any=new Error('HTTP request failed.\nURL: https://bsc.example/v1/SECRETKEY\nBody: x');e.name='ContractFunctionExecutionError';e.cause={shortMessage:'HTTP request to https://bsc.example/v1/SECRETKEY failed: 429'};
 const s=errorSummary(e);assert.match(s,/^ContractFunctionExecutionError: /);assert.match(s,/429/);assert.ok(!s.includes('SECRETKEY')&&!s.includes('https://'));
});
