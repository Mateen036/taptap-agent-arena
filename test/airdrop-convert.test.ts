import {test} from 'node:test';import assert from 'node:assert/strict';import ganache from 'ganache';import fs from 'node:fs';
import {createWalletClient,createPublicClient,http,keccak256,toHex,recoverTypedDataAddress,parseEther} from 'viem';import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {handle} from '../lib/api';import {actionData,AGENT_ID_REGISTRY} from '../lib/protocol';import {resolve,clearAirdropCache} from '../lib/airdrop';
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
for(const backend of ['sqlite','postgres'] as const)test(`${backend}: NIB convert issues vouchers, deducts atomically, settles, refunds partial fills and expired vouchers`,async()=>{
 const signerKey=generatePrivateKey(),db=await databaseFixture(backend),c=await chain(signerKey),oldFetch=globalThis.fetch;
 // The Agent ID registry is a fixed mainnet address; answer it locally and send every other RPC call to the local chain.
 globalThis.fetch=async(url:any,options:any)=>{try{const b=JSON.parse(options?.body);if(b.method==='eth_call'&&String(b.params?.[0]?.to).toLowerCase()===AGENT_ID_REGISTRY.toLowerCase())return Response.json({jsonrpc:'2.0',id:b.id,result:'0x'+'1'.padStart(64,'0')});}catch{}return oldFetch(url,options);};
 const env:any={DB:db,BSC_RPC_URL:c.rpc,NIB_SIGNER_PRIVATE_KEY:signerKey,NIB_AIRDROP:c.airdrop,NIB_TOKEN:c.token};
 const req=async(path:string,body?:any,user='',e:any=env)=>{clearAirdropCache();const r=await handle(new Request('https://game.test/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{'oai-authenticated-user-id':user}:{})},body:body?JSON.stringify(body):undefined}),e);return {status:r.status,body:await r.json() as any};};
 async function player(user:string){const account=privateKeyToAccount(generatePrivateKey()),key=privateKeyToAccount(generatePrivateKey());const pair=await req('pair',{},user);const ch=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:key.address});const s=await req('agent/session',{challengeId:ch.body.challengeId,signature:await account.signTypedData(ch.body.typedData)});assert.equal(s.status,200,JSON.stringify(s.body));let nonce=0;return {wallet:account.address.toLowerCase(),address:account.address,user,async act(action:string,payload:any={}){const envelope={sessionId:s.body.sessionId,nonce,timestamp:Date.now(),action,payload},signature=await key.signTypedData(actionData('https://game.test',envelope) as any);const result=await req('agent/action',{...envelope,signature});if(result.body.nonce!==undefined)nonce=result.body.nonce;return result;}};}
 const points=async(w:string)=>(await db.prepare('SELECT points FROM agents WHERE wallet=?').bind(w).first<any>()).points as number;
 const give=(w:string,n:number)=>db.prepare('UPDATE agents SET points=?,earned=? WHERE wallet=?').bind(n,n,w).run();
 const send=async(t:any)=>{const h=await c.wallet.sendTransaction({to:t.to,data:t.data,value:0n} as any);return c.client.waitForTransactionReceipt({hash:h});};
 const row=(id:string)=>db.prepare('SELECT * FROM airdrop_conversions WHERE id=?').bind(id).first<any>();
 try{
  const alpha=await player('alpha'),beta=await player('beta'),gamma=await player('gamma');
  await give(alpha.wallet,1000);await give(beta.wallet,4_000_000_500);await give(gamma.wallet,500);
  // Season 1 is not open: clean, specific refusals and nothing deducted.
  const closed=await req('airdrop',undefined,alpha.user);assert.equal(closed.status,200);assert.equal(closed.body.open,false);assert.equal(closed.body.message,'No airdrop season is open yet.');assert.equal(closed.body.user.convertible,'0');
  assert.equal(closed.body.airdrop.toLowerCase(),c.airdrop.toLowerCase());
  const notOpen=await req('airdrop/voucher',{},alpha.user);assert.equal(notOpen.status,409);assert.match(notOpen.body.error,/season 1 is not open yet/);assert.equal(await points(alpha.wallet),1000);
  assert.equal((await req('airdrop/voucher',{})).status,401,'anonymous callers cannot request vouchers');
  assert.equal((await req('airdrop/voucher',{},'stranger')).status,409,'a user without a paired agent is refused');
  await c.air('openNextSeason');
  const open=await req('airdrop',undefined,alpha.user);assert.equal(open.body.open,true);assert.equal(open.body.season.pointsPerNib,'10');assert.equal(open.body.season.remaining,parseEther('400000000').toString());assert.equal(open.body.user.estimatedNib,parseEther('100').toString());assert.equal(open.body.user.convertible,'1000');
  // Validation.
  assert.equal((await req('airdrop/voucher',{points:5},alpha.user)).status,400,'below 1 NIB');
  assert.equal((await req('airdrop/voucher',{points:5000},alpha.user)).status,409,'more than the balance');
  assert.equal((await req('airdrop/voucher',{points:'1.5'},alpha.user)).status,400);
  assert.equal((await req('airdrop/voucher',{season:3},alpha.user)).status,409,'season 3 is not open');
  assert.equal((await req('airdrop/voucher',{season:9},alpha.user)).status,400);
  // The configured signer must match the contract and the key must exist, or nothing is deducted.
  assert.equal((await req('airdrop/voucher',{},alpha.user,{...env,NIB_SIGNER_PRIVATE_KEY:undefined})).status,503);
  assert.equal((await req('airdrop/voucher',{},alpha.user,{...env,NIB_SIGNER_PRIVATE_KEY:generatePrivateKey()})).status,503);
  assert.equal(await points(alpha.wallet),1000);
  // NFT gate fails closed (no collection configured) and leaves points alone.
  const gated=await req('airdrop/voucher',{},alpha.user,{...env,NFT_GAME_UTILITY:'true'});assert.notEqual(gated.status,200);assert.equal(await points(alpha.wallet),1000);
  // Issue: whole balance by default.
  const issued=await req('airdrop/voucher',{},alpha.user);assert.equal(issued.status,200,JSON.stringify(issued.body));
  const v=issued.body.conversion;assert.equal(v.points,'1000');assert.equal(v.status,'pending');assert.equal(v.voucher.cumulativePoints,'1000');assert.equal(v.voucher.wallet.toLowerCase(),alpha.wallet);assert.equal(await points(alpha.wallet),0,'points are deducted at issuance');
  assert.equal(v.deadline-Math.floor(Date.now()/1000)<=900,true);assert.equal(v.deadline-Math.floor(Date.now()/1000)>=895,true,'15 minute deadline');
  const recovered=await recoverTypedDataAddress({domain:{name:'NibAirdrop',version:'1',chainId:56,verifyingContract:c.airdrop},types:{Voucher:[{name:'wallet',type:'address'},{name:'season',type:'uint256'},{name:'cumulativePoints',type:'uint256'},{name:'deadline',type:'uint256'},{name:'voucherId',type:'bytes32'}]},primaryType:'Voucher',message:{wallet:v.voucher.wallet,season:BigInt(v.voucher.season),cumulativePoints:BigInt(v.voucher.cumulativePoints),deadline:BigInt(v.voucher.deadline),voucherId:v.voucher.voucherId},signature:v.signature});assert.equal(recovered.toLowerCase(),c.signer.address.toLowerCase());
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE wallet=? AND kind='convert'").bind(alpha.wallet).first<any>()).n,1);
  // One pending per wallet+season: asking again returns the same voucher and does not deduct twice.
  await give(alpha.wallet,300);const again=await req('airdrop/voucher',{},alpha.user);assert.equal(again.status,200);assert.equal(again.body.reused,true);assert.equal(again.body.conversion.id,v.id);assert.equal(await points(alpha.wallet),300);
  const st=await req('airdrop',undefined,alpha.user);assert.equal(st.body.user.pending.id,v.id);assert.match(st.body.user.pending.baw,/baw contract-call preview/);
  // The agent submits the claim; any relayer works and the NIB goes to the voucher wallet.
  const rc=await send(v.transaction);assert.equal(rc.status,'success');assert.equal(await c.nib(alpha.address),parseEther('100'));
  const done=await req('airdrop',undefined,alpha.user);assert.equal(done.body.user.pending,null);assert.equal(done.body.user.history[0].status,'settled');assert.equal(done.body.user.history[0].paidPoints,'1000');assert.equal(done.body.user.history[0].refundPoints,'0');assert.equal(await points(alpha.wallet),300,'a fully paid voucher refunds nothing');
  // Next voucher is cumulative from what the chain already converted.
  const second=await req('airdrop/voucher',{points:100},alpha.user);assert.equal(second.body.conversion.voucher.cumulativePoints,'1100');assert.equal(await points(alpha.wallet),200);
  await send(second.body.conversion.transaction);assert.equal(await c.nib(alpha.address),parseEther('110'));
  // Signed agent actions mirror the browser API.
  const viaAgent=await alpha.act('airdrop-state');assert.equal(viaAgent.status,200,JSON.stringify(viaAgent.body));assert.equal(viaAgent.body.airdrop.season.season,1);assert.equal(viaAgent.body.airdrop.user.balance,'200');
  const agentVoucher=await alpha.act('airdrop-voucher',{points:50});assert.equal(agentVoucher.status,200,JSON.stringify(agentVoucher.body));assert.equal(agentVoucher.body.airdrop.conversion.voucher.cumulativePoints,'1150');await send(agentVoucher.body.airdrop.conversion.transaction);assert.equal(await points(alpha.wallet),150);
  // Two simultaneous requests cannot double-spend the same points.
  await give(beta.wallet,4_000_000_500);
  const race=await Promise.all([req('airdrop/voucher',{points:2000},beta.user),req('airdrop/voucher',{points:2000},beta.user)]);
  assert.equal(race.filter(r=>r.status===200).length>=1,true);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM airdrop_conversions WHERE wallet=? AND status='pending'").bind(beta.wallet).first<any>()).n,1);assert.equal(await points(beta.wallet),4_000_000_500-2000,'deducted exactly once');
  // Settle that small one, then exhaust the pool: the last claimer is partly filled and the rest is refunded.
  for(const r of race)if(r.status===200){await send(r.body.conversion.transaction);break;}
  await req('airdrop',undefined,beta.user);
  const remainingPoints=4_000_000_000-1000-100-50-2000;// 400M NIB * 10, minus everything converted so far
  const big=await req('airdrop/voucher',{points:remainingPoints+700},beta.user);assert.equal(big.status,200,JSON.stringify(big.body));
  assert.equal(await points(beta.wallet),4_000_000_500-2000-(remainingPoints+700));
  await send(big.body.conversion.transaction);
  assert.equal(await c.client.readContract({address:c.airdrop,abi:art('NibAirdrop').abi,functionName:'remaining',args:[1n]}),0n);
  const afterBig=await req('airdrop',undefined,beta.user);assert.equal(afterBig.body.open,false,'season 1 is exhausted');
  const bigRow=await row(big.body.conversion.id);assert.equal(bigRow.status,'settled');assert.equal(bigRow.paid_points,String(remainingPoints));assert.equal(bigRow.refund_points,'700');
  assert.equal(await points(beta.wallet),4_000_000_500-2000-remainingPoints,'the 700 unpaid points came back');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE wallet=? AND kind='convert-refund'").bind(beta.wallet).first<any>()).n,1);
  await req('airdrop',undefined,beta.user);assert.equal(await points(beta.wallet),4_000_000_500-2000-remainingPoints,'refund is applied once');
  assert.equal((await req('airdrop/voucher',{},beta.user)).status,409,'no voucher once the season is exhausted');
  // Season 2: an unclaimed voucher expires and its points return after the deadline passes on-chain.
  await c.air('openNextSeason');
  const g=await req('airdrop/voucher',{},gamma.user);assert.equal(g.status,200,JSON.stringify(g.body));assert.equal(g.body.conversion.season,2);assert.equal(await points(gamma.wallet),0);
  const early=await req('airdrop',undefined,gamma.user);assert.equal(early.body.user.pending.id,g.body.conversion.id);assert.equal(await points(gamma.wallet),0,'still pending before the deadline');
  await c.warp(901);
  assert.equal((await req('airdrop',undefined,gamma.user)).body.user.pending?.id,g.body.conversion.id,'a minute of grace after the deadline avoids a race with a late claim');
  await c.warp(120);
  const late=await req('airdrop',undefined,gamma.user);assert.equal(late.body.user.pending,null);assert.equal(await points(gamma.wallet),500);assert.equal((await row(g.body.conversion.id)).status,'released');
  await assert.rejects(send(g.body.conversion.transaction),undefined,'an expired voucher cannot be claimed');
  const g2=await req('airdrop/voucher',{},gamma.user);assert.equal(g2.status,200);assert.equal(g2.body.conversion.voucher.cumulativePoints,'500');
  // Global sweep releases expired vouchers for wallets that never come back.
  await c.warp(1000);await req('airdrop',undefined);assert.equal(await points(gamma.wallet),500);
 }finally{globalThis.fetch=oldFetch;await db.close();await c.close();}
});
test('resolve(): settle, partial fill, release and wait decisions',()=>{
 const r={delta_points:'1000',base_converted:'200',deadline:1000};
 assert.deepEqual(resolve(r,1200n,'open',0),{status:'settled',paid:1000n,refund:0n});
 assert.equal(resolve(r,200n,'open',1000+59),null,'inside the grace window');
 assert.deepEqual(resolve(r,200n,'open',1000+61),{status:'released',paid:0n,refund:1000n});
 assert.deepEqual(resolve(r,200n,'ended',0),{status:'released',paid:0n,refund:1000n},'ended season: no claim can land');
 assert.deepEqual(resolve(r,900n,'ended',0),{status:'settled',paid:700n,refund:300n},'partial fill refunds the unpaid part');
 assert.equal(resolve(r,900n,'open',10),null);
 assert.deepEqual(resolve(r,99999n,'open',0),{status:'settled',paid:1000n,refund:0n},'paid is capped at the voucher size');
});
