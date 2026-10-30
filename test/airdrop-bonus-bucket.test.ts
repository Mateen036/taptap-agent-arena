import {test} from 'node:test';import assert from 'node:assert/strict';import ganache from 'ganache';import fs from 'node:fs';
import {createWalletClient,createPublicClient,http,keccak256,toHex,recoverTypedDataAddress,parseEther} from 'viem';import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {handle} from '../lib/api';import {actionData,AGENT_ID_REGISTRY} from '../lib/protocol';import {refundBonus,clearAirdropCache} from '../lib/airdrop';
import {databaseFixture} from './helpers/database';
const art=(n:string)=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json','utf8'));
const TREASURY='0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d';
async function chain(signerKey:`0x${string}`){
 const server=ganache.server({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:4}});await server.listen(0,'127.0.0.1');
 const rpc='http://127.0.0.1:'+(server.address() as any).port,cfg:any={id:56,name:'Local BNB',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:{default:{http:[rpc]}}};
 const accounts=Object.values(server.provider.getInitialAccounts()).map((a:any)=>privateKeyToAccount(a.secretKey));const wallet=createWalletClient({account:accounts[0],chain:cfg,transport:http(rpc)}),client=createPublicClient({chain:cfg,transport:http(rpc)});
 const signer=privateKeyToAccount(signerKey);
 const deploy=async(a:any,args:any[])=>{const h=await wallet.deployContract({abi:a.abi,bytecode:a.bytecode,args});const r=await client.waitForTransactionReceipt({hash:h});assert.equal(r.status,'success');return r.contractAddress!;};
 const airdrop=await deploy(art('NibAirdrop'),[accounts[0].address,signer.address]),token=await deploy(art('NibToken'),[airdrop,TREASURY]);
 const air=async(fn:string,args:any[]=[])=>{const h=await wallet.writeContract({address:airdrop,abi:art('NibAirdrop').abi,functionName:fn,args} as any);const r=await client.waitForTransactionReceipt({hash:h});assert.equal(r.status,'success');};
 await air('setToken',[token]);
 const warp=async(s:number)=>{await server.provider.request({method:'evm_increaseTime',params:[s]} as any);await server.provider.request({method:'evm_mine',params:[]} as any);};
 const nib=(a:string)=>client.readContract({address:token,abi:art('NibToken').abi,functionName:'balanceOf',args:[a]}) as Promise<bigint>;
 return {server,rpc,wallet,client,signer,airdrop,token,air,warp,nib,close:()=>server.close()};
}
const E18=10n**18n;
function setup(db:any,c:any,signerKey:`0x${string}`,oldFetch:typeof fetch){
 globalThis.fetch=async(url:any,options:any)=>{try{const b=JSON.parse(options?.body);if(b.method==='eth_call'&&String(b.params?.[0]?.to).toLowerCase()===AGENT_ID_REGISTRY.toLowerCase())return Response.json({jsonrpc:'2.0',id:b.id,result:'0x'+'1'.padStart(64,'0')});}catch{}return oldFetch(url,options);};
 const env:any={DB:db,BSC_RPC_URL:c.rpc,NIB_SIGNER_PRIVATE_KEY:signerKey,NIB_AIRDROP:c.airdrop,NIB_TOKEN:c.token};
 const req=async(path:string,body?:any,user='')=>{clearAirdropCache();const r=await handle(new Request('https://game.test/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{'oai-authenticated-user-id':user}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json() as any};};
 async function player(user:string){const account=privateKeyToAccount(generatePrivateKey()),key=privateKeyToAccount(generatePrivateKey());const pair=await req('pair',{},user);const ch=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:key.address});const s=await req('agent/session',{challengeId:ch.body.challengeId,signature:await account.signTypedData(ch.body.typedData)});assert.equal(s.status,200,JSON.stringify(s.body));return {wallet:account.address.toLowerCase(),user};}
 const bal=async(w:string)=>{const r=await db.prepare('SELECT points,bonus_points AS bonus,earned FROM agents WHERE wallet=?').bind(w).first();return {points:Number(r.points),bonus:Number(r.bonus),earned:Number(r.earned)};};
 const give=(w:string,normal:number,bonus:number)=>db.prepare('UPDATE agents SET points=?,earned=?,bonus_points=? WHERE wallet=?').bind(normal,normal,String(bonus),w).run();
 const send=async(t:any)=>{const h=await c.wallet.sendTransaction({to:t.to,data:t.data,value:0n} as any);return c.client.waitForTransactionReceipt({hash:h});};
 const row=(id:string)=>db.prepare('SELECT * FROM airdrop_conversions WHERE id=?').bind(id).first();
 const remainingPoints=async()=>Number((await c.client.readContract({address:c.airdrop,abi:art('NibAirdrop').abi,functionName:'remaining',args:[1n]}) as bigint)*10n/E18);
 // Simulate demand the server never sees (a voucher issued before any bonus existed): sign for a throwaway wallet and claim on-chain so the pool is left with exactly `left` points.
 const drainTo=async(left:number)=>{const ghost=privateKeyToAccount(generatePrivateKey()),take=BigInt(await remainingPoints()-left),id=keccak256(toHex(crypto.getRandomValues(new Uint8Array(32)))) as `0x${string}`,deadline=(await c.client.getBlock()).timestamp+3600n;
  const signature=await c.signer.signTypedData({domain:{name:'NibAirdrop',version:'1',chainId:56,verifyingContract:c.airdrop},types:{Voucher:[{name:'wallet',type:'address'},{name:'season',type:'uint256'},{name:'cumulativePoints',type:'uint256'},{name:'deadline',type:'uint256'},{name:'voucherId',type:'bytes32'}]},primaryType:'Voucher',message:{wallet:ghost.address,season:1n,cumulativePoints:take,deadline,voucherId:id}});
  const h=await c.wallet.writeContract({address:c.airdrop,abi:art('NibAirdrop').abi,functionName:'claim',args:[{wallet:ghost.address,season:1n,cumulativePoints:take,deadline,voucherId:id},signature]} as any);assert.equal((await c.client.waitForTransactionReceipt({hash:h})).status,'success');assert.equal(await remainingPoints(),left);};
 return {req,player,bal,give,send,row,remainingPoints,drainTo};
}
test('refundBonus splits a refund between the buckets',()=>{
 assert.equal(refundBonus({delta_points:'4000',bonus_points:'3000'},2000n),1500n,'partial fill returns the bonus share pro rata');
 assert.equal(refundBonus({delta_points:'4000',bonus_points:'3000'},4000n),3000n,'a full release returns exactly what the bonus bucket gave');
 assert.equal(refundBonus({delta_points:'4000',bonus_points:'3000'},0n),0n);
 assert.equal(refundBonus({delta_points:'3',bonus_points:'1'},1n),0n,'rounds down, the remainder goes to ordinary points');
 assert.equal(refundBonus({delta_points:'500',bonus_points:'0'},500n),0n,'no bonus drawn, no bonus refunded');
 assert.equal(refundBonus({delta_points:'500'},250n),0n,'legacy rows without a bonus column');
});
for(const backend of ['sqlite','postgres'] as const)test(`${backend}: NFT bonus bucket: season-1-only, reserve, bucket refunds, forfeit after season 1`,async()=>{
 const signerKey=generatePrivateKey(),db=await databaseFixture(backend),c=await chain(signerKey),oldFetch=globalThis.fetch,t=setup(db,c,signerKey,oldFetch);
 try{
  const [alpha,beta,gamma,delta,eps,zeta]=[await t.player('alpha'),await t.player('beta'),await t.player('gamma'),await t.player('delta'),await t.player('eps'),await t.player('zeta')];
  await c.air('openNextSeason');await t.drainTo(20000);// 20,000 points (2,000 NIB) left in season 1
  const base=await t.req('airdrop',undefined,alpha.user);assert.equal(base.body.reservedForBonus.active,true);assert.equal(base.body.reservedForBonus.points,'0');assert.equal(base.body.reservedForBonus.normalCapacityPoints,'20000');assert.equal(base.body.reservedForBonus.appliesToSeason,1);
  // Bonus balance is separate: shown apart from normal TAP and convertible in season 1 together with it.
  await t.give(gamma.wallet,700,1300);await t.give(alpha.wallet,1000,3000);await t.give(delta.wallet,5000,6000);await t.give(zeta.wallet,12000,0);await t.give(eps.wallet,100,0);
  const gs=await t.req('airdrop',undefined,gamma.user);assert.equal(gs.body.user.balance,'700');assert.equal(gs.body.user.bonusBalance,'1300');assert.equal(gs.body.user.bonusConvertible,'1300');assert.equal(gs.body.user.convertible,'2000');assert.equal(gs.body.user.bonusForfeited,false);
  assert.equal(gs.body.reservedForBonus.points,'10300');assert.equal(gs.body.reservedForBonus.bonusBalancesPoints,'10300');assert.equal(gs.body.reservedForBonus.normalCapacityPoints,'9700');assert.equal(gs.body.reservedForBonus.nib,(10300n*E18/10n).toString());
  // Expiry returns each bucket exactly: gamma draws 1300 bonus + 700 normal, the voucher expires unclaimed.
  const g=await t.req('airdrop/voucher',{},gamma.user);assert.equal(g.status,200,JSON.stringify(g.body));assert.equal(g.body.conversion.points,'2000');assert.equal(g.body.conversion.bonusPoints,'1300');assert.equal(g.body.conversion.normalPoints,'700');assert.equal(g.body.conversion.voucher.cumulativePoints,'2000','on-chain cumulative counts both buckets');
  assert.deepEqual(await t.bal(gamma.wallet),{points:0,bonus:0,earned:700});
  const pendingStatus=await t.req('airdrop',undefined,gamma.user);assert.equal(pendingStatus.body.reservedForBonus.points,'10300','a pending bonus voucher keeps its reservation');assert.equal(pendingStatus.body.reservedForBonus.pendingBonusPoints,'1300');
  await db.prepare('UPDATE airdrop_conversions SET deadline=1 WHERE id=?').bind(g.body.conversion.id).run();
  const rel=await t.req('airdrop',undefined,gamma.user);assert.equal(rel.body.user.pending,null);assert.deepEqual(await t.bal(gamma.wallet),{points:700,bonus:1300,earned:700},'bonus back in the bonus bucket, normal in normal');
  assert.equal((await t.row(g.body.conversion.id)).status,'released');await t.req('airdrop',undefined,gamma.user);assert.deepEqual(await t.bal(gamma.wallet),{points:700,bonus:1300,earned:700},'refund applied once');
  // useBonus:false leaves the bonus alone.
  const only=await t.req('airdrop/voucher',{useBonus:false,points:300},gamma.user);assert.equal(only.status,200,JSON.stringify(only.body));assert.equal(only.body.conversion.bonusPoints,'0');assert.deepEqual(await t.bal(gamma.wallet),{points:400,bonus:1300,earned:700});
  await db.prepare('UPDATE airdrop_conversions SET deadline=1 WHERE id=?').bind(only.body.conversion.id).run();await t.req('airdrop',undefined,gamma.user);assert.deepEqual(await t.bal(gamma.wallet),{points:700,bonus:1300,earned:700});
  // Alpha: mixed voucher (3000 bonus + 1000 normal) while there is plenty of room.
  const a=await t.req('airdrop/voucher',{},alpha.user);assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(a.body.conversion.points,'4000');assert.equal(a.body.conversion.bonusPoints,'3000');assert.equal(a.body.conversion.voucher.cumulativePoints,'4000');
  assert.deepEqual(await t.bal(alpha.wallet),{points:0,bonus:0,earned:1000});
  // Reserve: bonus liability is 10,300 of the 20,000 left and 1,000 normal is pending, so only 8,700 of normal TAP can convert.
  const big=await t.req('airdrop/voucher',{points:12000},zeta.user);assert.equal(big.status,409);assert.match(big.body.error,/reserved for NFT bonus holders/);assert.match(big.body.error,/8700/);assert.deepEqual(await t.bal(zeta.wallet),{points:12000,bonus:0,earned:12000},'refused, nothing deducted');
  const z=await t.req('airdrop/voucher',{},zeta.user);assert.equal(z.status,200,JSON.stringify(z.body));assert.equal(z.body.conversion.points,'8700','"all" is clamped to the capacity that is not reserved');assert.deepEqual(await t.bal(zeta.wallet),{points:3300,bonus:0,earned:12000});
  const full=await t.req('airdrop/voucher',{points:100},eps.user);assert.equal(full.status,409);assert.match(full.body.error,/reserved for NFT bonus holders/);assert.deepEqual(await t.bal(eps.wallet),{points:100,bonus:0,earned:100});
  const cap=await t.req('airdrop',undefined,eps.user);assert.equal(cap.body.reservedForBonus.normalCapacityPoints,'0');assert.equal(cap.body.user.normalConvertible,'0');assert.equal(cap.body.user.convertible,'0','a normal-only user sees nothing convertible');
  // Bonus conversions may use the reserve: delta's 6000 bonus goes through, its 5000 normal does not (clamped by "all").
  const d=await t.req('airdrop/voucher',{},delta.user);assert.equal(d.status,200,JSON.stringify(d.body));assert.equal(d.body.conversion.points,'6000');assert.equal(d.body.conversion.bonusPoints,'6000');assert.deepEqual(await t.bal(delta.wallet),{points:5000,bonus:0,earned:5000});
  const dn=await t.req('airdrop',undefined,delta.user);assert.equal(dn.body.reservedForBonus.points,'10300');
  // Demand the server never saw leaves only 2,000 points. Alpha claims first and is partly filled (2000 of 4000): the refund is split pro rata between the buckets.
  await t.drainTo(2000);
  assert.equal((await t.send(a.body.conversion.transaction)).status,'success');assert.equal(await t.remainingPoints(),0);
  const asettled=await t.req('airdrop',undefined,alpha.user);assert.equal(asettled.body.user.history[0].status,'settled');assert.equal(asettled.body.user.history[0].bonusPoints,'3000');
  const ar=await t.row(a.body.conversion.id);assert.equal(ar.status,'settled');assert.equal(ar.paid_points,'2000');assert.equal(ar.refund_points,'2000');
  assert.deepEqual(await t.bal(alpha.wallet),{points:500,bonus:1500,earned:1000},'2000 refunded: 1500 to bonus (3/4), 500 to normal (1/4)');
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE wallet=? AND kind='convert-refund'").bind(alpha.wallet).first()).n),1);await t.req('airdrop',undefined,alpha.user);assert.deepEqual(await t.bal(alpha.wallet),{points:500,bonus:1500,earned:1000},'refund applied once');
  // The pool is now empty: every voucher still pending is released to the exact bucket it came from.
  const zr=await t.req('airdrop',undefined,zeta.user);assert.equal(zr.body.user.pending,null);assert.deepEqual(await t.bal(zeta.wallet),{points:12000,bonus:0,earned:12000});
  const dr=await t.req('airdrop',undefined,delta.user);assert.equal(dr.body.user.pending,null);assert.deepEqual(await t.bal(delta.wallet),{points:5000,bonus:6000,earned:5000},'unfilled bonus voucher goes back to bonus, not to ordinary points');
  assert.equal((await t.row(d.body.conversion.id)).status,'released');
  // Season 2: bonus is ignored (forfeited), normal TAP converts without any reserve.
  await c.air('openNextSeason');
  const ds=await t.req('airdrop',undefined,delta.user);assert.equal(ds.body.season.season,2);assert.equal(ds.body.reservedForBonus.active,false);assert.equal(ds.body.user.bonusBalance,'6000');assert.equal(ds.body.user.bonusConvertible,'0');assert.equal(ds.body.user.bonusForfeited,true);assert.equal(ds.body.user.convertible,'5000');
  const over=await t.req('airdrop/voucher',{points:5001},delta.user);assert.equal(over.status,409);assert.match(over.body.error,/after season 1/);
  const s2=await t.req('airdrop/voucher',{},delta.user);assert.equal(s2.status,200,JSON.stringify(s2.body));assert.equal(s2.body.conversion.season,2);assert.equal(s2.body.conversion.points,'5000');assert.equal(s2.body.conversion.bonusPoints,'0');assert.equal(s2.body.conversion.voucher.cumulativePoints,'5000');
  assert.deepEqual(await t.bal(delta.wallet),{points:0,bonus:6000,earned:5000},'bonus untouched and unconvertible');
  const bonusOnly=await t.req('airdrop/voucher',{points:100},gamma.user);assert.equal(bonusOnly.status,200);assert.equal(bonusOnly.body.conversion.bonusPoints,'0');assert.deepEqual(await t.bal(gamma.wallet),{points:600,bonus:1300,earned:700});
  const explicit=await t.req('airdrop/voucher',{points:700},beta.user);assert.equal(explicit.status,409);
 }finally{globalThis.fetch=oldFetch;await db.close();await c.close();}
});
for(const backend of ['sqlite','postgres'] as const)test(`${backend}: concurrent vouchers cannot jointly dip into the NFT bonus reserve`,async()=>{
 const signerKey=generatePrivateKey(),db=await databaseFixture(backend),c=await chain(signerKey),oldFetch=globalThis.fetch,t=setup(db,c,signerKey,oldFetch);
 try{
  const ps=[await t.player('p1'),await t.player('p2'),await t.player('p3'),await t.player('p4')],holder=await t.player('holder'),twin=await t.player('twin');
  await c.air('openNextSeason');await t.drainTo(10000);
  for(const p of ps)await t.give(p.wallet,4000,0);
  await t.give(holder.wallet,0,4000);await t.give(twin.wallet,0,1000);// liability 5000 of 10000: 5000 of normal capacity
  // Hold every request just after it has measured the reserve, so all four see 5,000 of capacity before any of them commits: only the SQL guard can stop the overspend.
  const prepare=db.prepare.bind(db);let arrived=0,open!:()=>void;const gate=new Promise<void>(r=>{open=r;});
  db.prepare=(sql:string)=>{const st=prepare(sql);if(!sql.includes('AS b, COALESCE'))return st;const bind=st.bind.bind(st);st.bind=(...a:any[])=>{const b=bind(...a),first=b.first.bind(b);b.first=async()=>{const r=await first();if(++arrived>=4)open();await Promise.race([gate,new Promise(r=>setTimeout(r,3000))]);return r;};return b;};return st;};
  const res=await Promise.all(ps.map(p=>t.req('airdrop/voucher',{points:4000},p.user)));db.prepare=prepare;assert.equal(arrived>=4,true,'all four requests passed the application check together');
  assert.equal(res.filter(r=>r.status===200).length,1,JSON.stringify(res.map(r=>r.status)+JSON.stringify(res.map(r=>r.body.error))));
  for(const r of res.filter(r=>r.status!==200)){assert.equal(r.status,409);assert.match(r.body.error,/reserved for NFT bonus holders/);}
  const pend=await db.prepare("SELECT COALESCE(SUM(CAST(delta_points AS bigint)-CAST(bonus_points AS bigint)),0) AS n FROM airdrop_conversions WHERE season=1 AND status='pending'").first();assert.equal(Number(pend.n)<=5000,true,'normal vouchers never exceed capacity');
  for(const p of ps){const b=await t.bal(p.wallet);assert.equal(b.points===0||b.points===4000,true);}
  // Bonus holders can still convert their full bonus out of the reserve, even while normal users are shut out.
  const h=await t.req('airdrop/voucher',{},holder.user);assert.equal(h.status,200,JSON.stringify(h.body));assert.equal(h.body.conversion.points,'4000');assert.equal(h.body.conversion.bonusPoints,'4000');
  assert.equal((await t.send(h.body.conversion.transaction)).status,'success');await t.req('airdrop',undefined,holder.user);assert.deepEqual(await t.bal(holder.wallet),{points:0,bonus:0,earned:0});
  // Same wallet racing itself with its bonus: one voucher, one deduction, never negative.
  const twins=await Promise.all([t.req('airdrop/voucher',{},twin.user),t.req('airdrop/voucher',{},twin.user)]);
  assert.equal(twins.filter(r=>r.status===200).length>=1,true);assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM airdrop_conversions WHERE wallet=? AND status='pending'").bind(twin.wallet).first()).n),1);assert.deepEqual(await t.bal(twin.wallet),{points:0,bonus:0,earned:0});
 }finally{globalThis.fetch=oldFetch;await db.close();await c.close();}
});
for(const backend of ['sqlite','postgres'] as const)test(`${backend}: source option issues bonus-only and normal-only vouchers`,async()=>{
 const signerKey=generatePrivateKey(),db=await databaseFixture(backend),c=await chain(signerKey),oldFetch=globalThis.fetch,t=setup(db,c,signerKey,oldFetch);
 try{
  const [a,b,n]=[await t.player('src-a'),await t.player('src-b'),await t.player('src-none')];
  await c.air('openNextSeason');
  await t.give(a.wallet,500,3000);await t.give(b.wallet,500,3000);await t.give(n.wallet,900,0);
  assert.equal((await t.req('airdrop/voucher',{source:'nonsense'},a.user)).status,400);
  assert.equal((await t.req('airdrop/voucher',{source:'bonus'},n.user)).status,409,'no bonus balance');assert.deepEqual(await t.bal(n.wallet),{points:900,bonus:0,earned:900});
  assert.equal((await t.req('airdrop/voucher',{source:'bonus',points:3001},a.user)).status,409,'cannot exceed the bonus balance');assert.deepEqual(await t.bal(a.wallet),{points:500,bonus:3000,earned:500});
  const part=await t.req('airdrop/voucher',{source:'bonus',points:1000},a.user);assert.equal(part.status,200,JSON.stringify(part.body));assert.equal(part.body.conversion.points,'1000');assert.equal(part.body.conversion.bonusPoints,'1000');assert.equal(part.body.conversion.normalPoints,'0');
  assert.deepEqual(await t.bal(a.wallet),{points:500,bonus:2000,earned:500},'normal TAP untouched');
  const all=await t.req('airdrop/voucher',{source:'bonus'},b.user);assert.equal(all.status,200,JSON.stringify(all.body));assert.equal(all.body.conversion.points,'3000');assert.equal(all.body.conversion.bonusPoints,'3000');assert.deepEqual(await t.bal(b.wallet),{points:500,bonus:0,earned:500});
  await db.prepare('UPDATE airdrop_conversions SET deadline=1 WHERE id=?').bind(all.body.conversion.id).run();await t.req('airdrop',undefined,b.user);assert.deepEqual(await t.bal(b.wallet),{points:500,bonus:3000,earned:500},'an expired bonus voucher returns to the bonus balance');
  const norm=await t.req('airdrop/voucher',{source:'normal'},b.user);assert.equal(norm.status,200,JSON.stringify(norm.body));assert.equal(norm.body.conversion.points,'500');assert.equal(norm.body.conversion.bonusPoints,'0');assert.deepEqual(await t.bal(b.wallet),{points:0,bonus:3000,earned:500});
  await c.air('endSeason');await c.air('openNextSeason');
  assert.equal((await t.req('airdrop/voucher',{source:'bonus',season:2},a.user)).status,409,'bonus converts in season 1 only');
 }finally{globalThis.fetch=oldFetch;await db.close();await c.close();}
});
