import {test} from 'node:test';import assert from 'node:assert/strict';import ganache from 'ganache';import fs from 'node:fs';
import {createWalletClient,createPublicClient,http,keccak256,toHex,recoverTypedDataAddress,parseEther} from 'viem';import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {handle} from '../lib/api';import {actionData,AGENT_ID_REGISTRY} from '../lib/protocol';import {clearAirdropCache,NFT_BONUS_CAP_POINTS,NIB_COLLECTION} from '../lib/airdrop';import {parseAbi,decodeFunctionData,encodeFunctionResult} from 'viem';
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
const nftAbi=parseAbi(['function balanceOf(address) view returns (uint256)','function tokenOfOwnerByIndex(address,uint256) view returns (uint256)','function ownerOf(uint256) view returns (address)']);
for(const backend of ['sqlite','postgres'] as const)test(`${backend}: NFT bonus is once per token id, capped, owner-only, season-1-only and convertible-only`,async()=>{
 const signerKey=generatePrivateKey(),db=await databaseFixture(backend),c=await chain(signerKey),oldFetch=globalThis.fetch;
 const owners=new Map<number,string>();// in-memory Nib collection answering the ERC-721 reads
 globalThis.fetch=async(url:any,options:any)=>{try{const b=JSON.parse(options?.body);if(b.method==='eth_call'){const to=String(b.params?.[0]?.to).toLowerCase();
  if(to===AGENT_ID_REGISTRY.toLowerCase())return Response.json({jsonrpc:'2.0',id:b.id,result:'0x'+'1'.padStart(64,'0')});
  if(to===NIB_COLLECTION.toLowerCase()){const d=decodeFunctionData({abi:nftAbi,data:b.params[0].data});const held=(w:string)=>[...owners].filter(([,o])=>o===String(w).toLowerCase()).map(([t])=>t).sort((x,y)=>x-y);
   const value:any=d.functionName==='balanceOf'?BigInt(held(d.args[0] as string).length):d.functionName==='tokenOfOwnerByIndex'?BigInt(held(d.args[0] as string)[Number(d.args[1])]):owners.get(Number(d.args[0]))||'0x'+'0'.repeat(40);
   return Response.json({jsonrpc:'2.0',id:b.id,result:encodeFunctionResult({abi:nftAbi,functionName:d.functionName as any,result:value})});}}}catch{}return oldFetch(url,options);};
 const env:any={DB:db,BSC_RPC_URL:c.rpc,NIB_SIGNER_PRIVATE_KEY:signerKey,NIB_AIRDROP:c.airdrop,NIB_TOKEN:c.token};
 const req=async(path:string,body?:any,user='',e:any=env)=>{clearAirdropCache();const r=await handle(new Request('https://game.test/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{'oai-authenticated-user-id':user}:{})},body:body?JSON.stringify(body):undefined}),e);return {status:r.status,body:await r.json() as any};};
 async function player(user:string){const account=privateKeyToAccount(generatePrivateKey()),key=privateKeyToAccount(generatePrivateKey());const pair=await req('pair',{},user);const ch=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:key.address});const s=await req('agent/session',{challengeId:ch.body.challengeId,signature:await account.signTypedData(ch.body.typedData)});assert.equal(s.status,200,JSON.stringify(s.body));let nonce=0;return {wallet:account.address.toLowerCase(),address:account.address,user,async act(action:string,payload:any={}){const envelope={sessionId:s.body.sessionId,nonce,timestamp:Date.now(),action,payload},signature=await key.signTypedData(actionData('https://game.test',envelope) as any);const result=await req('agent/action',{...envelope,signature});if(result.body.nonce!==undefined)nonce=result.body.nonce;return result;}};}
 const agent=(w:string)=>db.prepare('SELECT points,earned,bonus_points AS bonus FROM agents WHERE wallet=?').bind(w).first<any>().then(r=>({...r,bonus:Number(r.bonus)}));
 const total=async()=>Number((await db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM nft_bonus_claims').first<any>()).t);
 const give=(t:number,w:string)=>owners.set(t,w);
 const claim=(p:any)=>req('airdrop/nft-bonus',{},p.user);
 try{
  const [alpha,beta,gamma,delta,eps,zeta,eta,theta]=[await player('alpha'),await player('beta'),await player('gamma'),await player('delta'),await player('eps'),await player('zeta'),await player('eta'),await player('theta')];
  give(1,alpha.wallet);give(2,alpha.wallet);give(3,beta.wallet);give(4,beta.wallet);give(40,eta.wallet);give(50,delta.wallet);give(51,delta.wallet);give(60,eps.wallet);give(61,zeta.wallet);give(70,theta.wallet);
  // Season 1 not open: refused, nothing credited, status explains.
  const closed=await req('airdrop',undefined,alpha.user);assert.equal(closed.body.nftBonus.available,false);assert.equal(closed.body.nftBonus.seasonOpen,false);assert.equal(closed.body.nftBonus.pointsPerNft,'100000');assert.equal(closed.body.nftBonus.nibPerNft,parseEther('10000').toString());assert.equal(closed.body.nftBonus.capPoints,NFT_BONUS_CAP_POINTS.toString());
  const early=await claim(alpha);assert.equal(early.status,409);assert.match(early.body.error,/season 1 is open/);assert.equal((await agent(alpha.wallet)).points,0);
  assert.equal((await req('airdrop/nft-bonus',{})).status,401,'anonymous callers cannot claim');
  await c.air('openNextSeason');
  // Status lists each NFT.
  const st=await req('airdrop',undefined,alpha.user);assert.equal(st.body.nftBonus.available,true);assert.deepEqual(st.body.nftBonus.user.owned,[{tokenId:1,claimed:false},{tokenId:2,claimed:false}]);assert.equal(st.body.nftBonus.user.claimableNow,2);assert.equal(st.body.nftBonus.remainingPoints,NFT_BONUS_CAP_POINTS.toString());assert.equal(st.body.nftBonus.remainingNib,parseEther('200000000').toString());
  // Not an owner.
  const none=await claim(gamma);assert.equal(none.status,403);assert.equal((await agent(gamma.wallet)).points,0);assert.equal(await total(),0);
  // Claim: convertible balance only, earned and rankings untouched.
  const ok=await claim(alpha);assert.equal(ok.status,200,JSON.stringify(ok.body));assert.equal(ok.body.pointsCredited,'200000');assert.deepEqual(ok.body.claimed.map((x:any)=>x.tokenId),[1,2]);assert.equal(ok.body.estimatedNib,parseEther('20000').toString());
  const a1=await agent(alpha.wallet);assert.equal(a1.bonus,200000,'credited to the separate bonus balance');assert.equal(a1.points,0,'ordinary points untouched');assert.equal(a1.earned,0,'bonus never counts as earned');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE wallet=? AND kind='nft-bonus'").bind(alpha.wallet).first<any>()).n,1);
  // Once per token id: claiming again is refused, status shows claimed.
  const again=await claim(alpha);assert.equal(again.status,409);assert.equal((await agent(alpha.wallet)).bonus,200000);
  const st2=await req('airdrop',undefined,alpha.user);assert.deepEqual(st2.body.nftBonus.user.owned.map((x:any)=>x.claimed),[true,true]);assert.equal(st2.body.nftBonus.user.claimableNow,0);assert.equal(st2.body.nftBonus.creditedPoints,'200000');
  // The bonus converts through the normal voucher flow.
  const v=await req('airdrop/voucher',{},alpha.user);assert.equal(v.status,200,JSON.stringify(v.body));assert.equal(v.body.conversion.points,'200000');assert.equal(v.body.conversion.bonusPoints,'200000');assert.equal(v.body.conversion.normalPoints,'0');assert.equal(v.body.estimatedNib,parseEther('20000').toString());assert.equal((await agent(alpha.wallet)).bonus,0);assert.equal((await agent(alpha.wallet)).points,0);
  // Transfer then reclaim: token 1 moves to gamma, who cannot claim it again; neither can the new owner of a claimed token via another path.
  give(1,gamma.wallet);const re=await claim(gamma);assert.equal(re.status,409);assert.match(re.body.error,/already claimed/);assert.equal((await agent(gamma.wallet)).points,0);assert.equal(await total(),200000);
  const sold=await req('airdrop',undefined,gamma.user);assert.deepEqual(sold.body.nftBonus.user.owned,[{tokenId:1,claimed:true}]);
  // Signed agent action mirrors the endpoint.
  const act=await eta.act('airdrop-nft-bonus');assert.equal(act.status,200,JSON.stringify(act.body));assert.equal(act.body.airdrop.pointsCredited,'100000');assert.equal((await agent(eta.wallet)).bonus,100000);assert.equal((await agent(eta.wallet)).points,0);
  const actState=await eta.act('airdrop-state');assert.equal(actState.body.airdrop.nftBonus.user.claimableNow,0);
  // Race: the same wallet claiming twice at once credits once.
  const [r1,r2]=await Promise.all([claim(delta),claim(delta)]);assert.deepEqual([r1.status,r2.status].sort(),[200,409]);assert.equal((await agent(delta.wallet)).bonus,200000);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM nft_bonus_claims WHERE wallet=?').bind(delta.wallet).first<any>()).n,2);
  // Cap: leave room for exactly one token; a two-NFT holder gets one, then the pool reports exhausted.
  const filler=async(roomPoints:bigint)=>{await db.prepare('DELETE FROM nft_bonus_claims WHERE token_id=9999999').run();const t=BigInt(await total());await db.prepare('INSERT INTO nft_bonus_claims(token_id,wallet,agent,amount,claimed_at) VALUES(?,?,?,?,?)').bind(9999999,'0xfiller','filler',Number(NFT_BONUS_CAP_POINTS-roomPoints-t),Date.now()).run();};
  await filler(100000n);
  const partial=await claim(beta);assert.equal(partial.status,200,JSON.stringify(partial.body));assert.deepEqual(partial.body.claimed.map((x:any)=>x.tokenId),[3]);assert.equal((await agent(beta.wallet)).bonus,100000);assert.equal(await total(),Number(NFT_BONUS_CAP_POINTS));
  const full=await claim(beta);assert.equal(full.status,409);assert.match(full.body.error,/exhausted/);assert.equal((await agent(beta.wallet)).bonus,100000);
  const fs2=await req('airdrop',undefined,beta.user);assert.equal(fs2.body.nftBonus.remainingPoints,'0');assert.equal(fs2.body.nftBonus.available,false);
  // Cross-wallet race for the last slot: exactly one wins and the cap holds.
  await filler(100000n);
  const [e1,e2]=await Promise.all([claim(eps),claim(zeta)]);assert.deepEqual([e1.status,e2.status].sort(),[200,409]);assert.equal(await total(),Number(NFT_BONUS_CAP_POINTS),'cap is never exceeded');
  assert.equal((await agent(eps.wallet)).bonus+(await agent(zeta.wallet)).bonus,100000);
  // Season 1 ended: no more claims.
  await filler(1_000_000n);await c.air('endSeason');
  const late=await claim(theta);assert.equal(late.status,409);assert.match(late.body.error,/season 1 is open/);assert.equal((await agent(theta.wallet)).points,0);
  assert.equal(await total()<=Number(NFT_BONUS_CAP_POINTS),true);
 }finally{globalThis.fetch=oldFetch;await db.close();await c.close();}
});
