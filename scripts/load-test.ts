// Synthetic, in-memory verification only. Never points this workload at production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {handle} from '../lib/api';
import {actionData} from '../lib/protocol';
import {databaseFixture} from '../test/helpers/database';

const backend=process.env.TAPTAP_LOAD_DB==='postgres'?'postgres':'sqlite';
const db=await databaseFixture(backend),env:any={DB:db};
const originalNow=Date.now;let now=Date.parse('2026-10-29T12:00:00Z');Date.now=()=>now;
const timings:number[]=[];let requests=0;
const request=async(path:string,body:any,user?:string)=>{
 const start=performance.now();
 const response=await handle(new Request('https://load.test/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(user?{'oai-authenticated-user-id':user}:{})},body:JSON.stringify(body)}),env);
 const result=await response.json() as any;timings.push(performance.now()-start);requests++;
 assert.ok(response.ok,JSON.stringify({path,status:response.status,error:result.error}));return result;
};
try{
 const started=performance.now(),players=[];
 // Fixture sessions bypass Binance identity enrollment, not signature verification.
 // No external RPC, live wallets, real points, or production database are used.
 for(let i=0;i<100;i++){
  const account=privateKeyToAccount(generatePrivateKey()),key=privateKeyToAccount(generatePrivateKey());
  const wallet=account.address.toLowerCase(),user='synthetic-'+i,sessionId=crypto.randomUUID();let nonce=0;
  await db.prepare('INSERT INTO agents(wallet,user_id,name,updated_at,created_at) VALUES(?,?,?,?,?)').bind(wallet,user,'Synthetic '+i,now,now).run();
  await db.prepare('INSERT INTO sessions(id,wallet,session_key,expires_at,verified_at) VALUES(?,?,?,?,?)').bind(sessionId,wallet,key.address.toLowerCase(),now+3600000,now).run();
  players.push({wallet,user,async act(action:string,payload:any={}){const envelope={sessionId,nonce:nonce++,timestamp:now,action,payload};return request('agent/action',{...envelope,signature:await key.signTypedData(actionData('https://load.test',envelope) as any)});}});
 }
 await Promise.all(players.map(p=>p.act('season-join')));
 const commands=await Promise.all(players.map(p=>request('commands',{prompt:'Tap 25 times'},p.user)));
 await Promise.all(players.map((p,i)=>p.act('start',{commandId:commands[i].id})));
 now+=5000;
 await Promise.all(players.map((p,i)=>p.act('tap',{commandId:commands[i].id,taps:25})));
 const totals=await db.prepare('SELECT COUNT(*) AS wallets,SUM(points) AS points,SUM(taps) AS taps,SUM(runs) AS runs FROM agents').first<any>();
 for(const k of Object.keys(totals))totals[k]=Number(totals[k]);
 assert.deepEqual({...totals},{wallets:100,points:2500,taps:2500,runs:100});
 const cohort=await db.prepare("SELECT enrolled FROM seasons WHERE id='season-0'").first<any>();assert.equal(cohort.enrolled,100);
 const scores=await db.prepare('SELECT SUM(score) AS score FROM season_scores').first<any>();assert.equal(Number(scores.score),2500);
 timings.sort((a,b)=>a-b);
 const report={kind:'synthetic-local-integration-load',backend,concurrency:100,requests,p50ms:Math.round(timings[Math.floor(timings.length*.5)]),p95ms:Math.round(timings[Math.floor(timings.length*.95)]),elapsedMs:Math.round(performance.now()-started),totals,cohort:cohort.enrolled,limitations:'In-process fixture with one database connection. Not a production capacity benchmark or proof of 100 Binance users.'};
 fs.mkdirSync('docs/verification',{recursive:true});fs.writeFileSync('docs/verification/load-'+backend+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{Date.now=originalNow;await db.close();}
