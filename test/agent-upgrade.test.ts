import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';import {handle} from '../lib/api';import {actionData} from '../lib/protocol';import {upgradeCost} from '../lib/game';
import {runDo,status,parseDoArgs,cheapestAffordable,DoError,type Ctx} from '../agent/do';

class D1{
 db=new DatabaseSync(':memory:');constructor(){for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())this.db.exec(fs.readFileSync('drizzle/'+file,'utf8'));}
 prepare(sql:string){const db=this.db;return {args:[] as any[],bind(...args:any[]){this.args=args;return this;},async first(){return db.prepare(sql).get(...this.args)||null;},async all(){return {results:db.prepare(sql).all(...this.args)};},async run(){const r=db.prepare(sql).run(...this.args);return {meta:{changes:Number(r.changes)},success:true};}};}
 tail:Promise<any>=Promise.resolve();async batch(statements:any[]){const job=this.tail.then(async()=>{this.db.exec('BEGIN IMMEDIATE');try{const out=[];for(const s of statements)out.push(await s.run());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}});this.tail=job.catch(()=>{});return job;}
}

async function fixture(){
 const db=new D1(),env:any={DB:db,BSC_RPC_URL:'https://rpc.test'},originalFetch=globalThis.fetch,originalNow=Date.now;const clock={now:1800000000000};Date.now=()=>clock.now;
 globalThis.fetch=async(_url:any,opt:any)=>{const req=JSON.parse(opt.body);const result=req.method==='eth_chainId'?'0x38':req.method==='eth_getCode'?'0x':('0x'+1n.toString(16).padStart(64,'0'));return Response.json({jsonrpc:'2.0',id:req.id,result});};
 const req=async(p:string,body?:any,user='owner')=>{const r=await handle(new Request('https://game.test/api/'+p,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{'oai-authenticated-user-id':user}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json() as any};};
 const pair=await req('pair',{}),wallet=privateKeyToAccount(generatePrivateKey()),key=privateKeyToAccount(generatePrivateKey());
 const challenge=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:wallet.address,sessionKey:key.address},''),signed=await req('agent/session',{challengeId:challenge.body.challengeId,signature:await wallet.signTypedData(challenge.body.typedData)},'');
 const s:any={sessionId:signed.body.sessionId,wallet:wallet.address,nonce:0,expiresAt:clock.now+3600000};
 const rawAction=async(st:any,kind:string,payload:any={})=>{const envelope={sessionId:st.sessionId,nonce:st.nonce,timestamp:Date.now(),action:kind,payload},signature=await key.signTypedData(actionData('https://game.test',envelope) as any),r=await req('agent/action',{...envelope,signature},'');if(Number.isSafeInteger(r.body.nonce))st.nonce=r.body.nonce;if(r.status!==200)throw Object.assign(new Error(r.body.error||'failed'),{status:r.status});return r.body;};
 const setPoints=(n:number)=>db.db.prepare('UPDATE agents SET points=?').run(n);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'taptap-up-')),out:string[]=[];
 const ctx:Ctx={s,origin:'https://game.test',journalFile:path.join(dir,'j.json'),rawAction,baw:(()=>{throw Error('no baw expected for off-chain upgrades');}) as any,out:x=>out.push(x),sleep:async ms=>{clock.now+=ms;}};
 const agentRow=()=>db.db.prepare('SELECT * FROM agents').get() as any;
 return {db,env,req,s,rawAction,setPoints,ctx,out,clock,agentRow,close:()=>{Date.now=originalNow;globalThis.fetch=originalFetch;db.db.close();}};
}

test('signed upgrade action: same rules as the dashboard (cost, level 20, points, bad index, frozen)',async()=>{
 const f=await fixture();
 try{
  await f.req('bootstrap');
  await assert.rejects(f.rawAction(f.s,'upgrade',{index:3}),/Invalid upgrade/);await assert.rejects(f.rawAction(f.s,'upgrade',{}),/Invalid upgrade/);
  await assert.rejects(f.rawAction(f.s,'upgrade',{index:0}),/Not enough TAP/);
  f.setPoints(100000);
  const base=f.agentRow();
  const r=await f.rawAction(f.s,'upgrade',{index:0});assert.equal(r.upgraded.level,2);assert.equal(r.upgraded.cost,1500);assert.equal(r.agent.levels[0],2);assert.equal(r.agent.points,100000-1500);assert.equal(r.agent.power,3);
  const r2=await f.rawAction(f.s,'upgrade',{index:1});assert.equal(r2.upgraded.cost,2500);assert.equal(r2.agent.capacity,2000);assert.equal(f.agentRow().energy,base.energy+1000,'the tank upgrade adds 1,000 energy');
  const r3=await f.rawAction(f.s,'upgrade',{index:2});assert.equal(r3.upgraded.cost,4000);assert.equal(r3.agent.speed,7);
  const ledger=f.db.db.prepare("SELECT SUM(delta) AS d,COUNT(*) AS n FROM ledger WHERE kind='upgrade'").get() as any;assert.equal(ledger.n,3);assert.equal(ledger.d,-(1500+2500+4000));
  // level 20 cap
  f.db.db.prepare('UPDATE agents SET power_level=20,points=?').run(10**12);
  await assert.rejects(f.rawAction(f.s,'upgrade',{index:0}),/Maximum upgrade level/);
  // the dashboard endpoint is unchanged and still agrees on price
  f.db.db.prepare('UPDATE agents SET power_level=1,points=?').run(10**9);const expected=upgradeCost({power_level:1},0);assert.equal((await f.req('upgrades',{index:0})).status,200);assert.equal(f.agentRow().points,10**9-expected);
  // frozen season refuses upgrades
  f.db.db.prepare("INSERT INTO game_settings(key,value) VALUES('season_phase_v3','frozen') ON CONFLICT(key) DO UPDATE SET value='frozen'").run();
  await assert.rejects(f.rawAction(f.s,'upgrade',{index:1}),/frozen/);
 }finally{f.close();}
});

test('signed upgrade pauses a running command; the dashboard endpoint still refuses while running',async()=>{
 const f=await fixture();
 try{
  await f.req('bootstrap');f.setPoints(50000);
  const created=await f.rawAction(f.s,'command-create',{target:500});const id=created.command.id;
  await f.rawAction(f.s,'start',{commandId:id});f.clock.now+=2000;await f.rawAction(f.s,'tap',{commandId:id,taps:10});
  assert.equal((await f.req('upgrades',{index:0})).status,409,'the browser path must still be paused first');
  const energyBefore=f.agentRow().energy;
  const r=await f.rawAction(f.s,'upgrade',{index:1});assert.equal(r.upgraded.paused,id);
  assert.equal((f.db.db.prepare('SELECT status FROM commands WHERE id=?').get(id) as any).status,'paused');
  assert.equal(f.agentRow().energy,energyBefore+1000,'a running command keeps its stored energy; the tank adds 1,000');
  await assert.rejects(f.rawAction(f.s,'tap',{commandId:id,taps:5}),/not running/);
  await f.rawAction(f.s,'start',{commandId:id});f.clock.now+=2000;const t=await f.rawAction(f.s,'tap',{commandId:id,taps:5});assert.ok(t.agent.points>0,'the same command can be restarted after the upgrade');
 }finally{f.close();}
});

test('connector: do upgrade <name> / all buys the cheapest affordable upgrade until nothing is affordable',async()=>{
 const f=await fixture();
 try{
  await f.req('bootstrap');
  assert.deepEqual(cheapestAffordable({points:'1499',upgrades:[{cost:1500,level:1},{cost:2500,level:1},{cost:4000,level:1}]}),null);
  assert.equal(cheapestAffordable({points:'3000',upgrades:[{cost:1500,level:20},{cost:2500,level:1},{cost:4000,level:1}]})!.index,1,'skips maxed upgrades');
  assert.equal(cheapestAffordable({points:'99999',upgrades:[{cost:5000,level:3},{cost:2500,level:1},{cost:4000,level:1}]})!.index,1,'cheapest wins');
  await assert.rejects(runDo(f.ctx,['upgrade']),/multitap, tank, overclock or all/);await assert.rejects(runDo(f.ctx,['upgrade','banana']),DoError);
  await assert.rejects(runDo(f.ctx,['upgrade','tank']),/Not enough TAP/);
  assert.equal(parseDoArgs(['upgrade','all']).rest[0],'all');
  f.setPoints(2600);
  const one:any=await runDo(f.ctx,['upgrade','tank']);assert.equal(one.levels[1],2);assert.equal(one.pointsLeft,'100');
  f.setPoints(5000);f.out.length=0;
  const all:any=await runDo(f.ctx,['upgrade','all']);
  // costs: multitap 1500 (L1) → 2475 (L2); tank 4125 (L2); overclock 4000. Cheapest-first with 5000: multitap 1500 (3500 left), multitap 2475 (1025 left), nothing else.
  assert.deepEqual(all.bought.map((x:string)=>x.split(' (')[0]),['Multitap → L2','Multitap → L3']);assert.equal(all.pointsLeft,'1025');assert.equal(all.levels.multitap,3);
  assert.match(f.out.join('\n'),/Levels: Multitap L3/);assert.match(f.out.join('\n'),/TAP left: 1025/);
  const none:any=await runDo(f.ctx,['upgrade','all']);assert.deepEqual(none.bought,[]);assert.match(f.out.join('\n'),/Nothing is affordable/);
  f.setPoints(10**11);const maxed:any=await runDo(f.ctx,['upgrade','all']);assert.deepEqual([maxed.levels.multitap,maxed.levels.energyTank,maxed.levels.agentOverclock],[20,20,20],'stops at level 20 for all three');
  assert.ok((await status(f.ctx,true) as any).game.levels.every((l:number)=>l===20));
 }finally{f.close();}
});

test('connector: earn-max --upgrade keeps earning after buying upgrades while a command is running',async()=>{
 const f=await fixture();
 try{
  await f.req('bootstrap');f.setPoints(1400);
  const result:any=await runDo(f.ctx,['earn-max','--upgrade','--minutes','2']);
  assert.ok(Number(result.earnedTap)>0,JSON.stringify(result));assert.ok(result.levels.some((l:number)=>l>1),'bought at least one upgrade: '+JSON.stringify(result)+f.out.join('\n'));
  assert.match(f.out.join('\n'),/Auto-upgrade: /);assert.equal(result.spentOnUpgrades,'1500');assert.ok(Number(result.earnedTap)>=1500,'earned counts gross TAP, not net of the spend');
  const afterFirstUpgrade=f.out.findIndex(l=>/Auto-upgrade/.test(l));assert.ok(afterFirstUpgrade>=0);
  assert.ok(f.agentRow().taps>0);
  // without --upgrade nothing is bought
  const f2=await fixture();try{await f2.req('bootstrap');f2.setPoints(100000);const plain:any=await runDo(f2.ctx,['earn-max','--minutes','0.5']);assert.equal(plain.levels,undefined);assert.equal(f2.agentRow().power_level,1);}finally{f2.close();}
 }finally{f.close();}
});
