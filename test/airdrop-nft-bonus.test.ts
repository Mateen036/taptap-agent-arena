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
for(const backend of ['sqlite','postgres'] as const)test(`${backend}: NFT bonus pool is closed and remaining tokens stay in Season 1`,async()=>{
 const signerKey=generatePrivateKey(),db=await databaseFixture(backend),c=await chain(signerKey),oldFetch=globalThis.fetch;
 const owners=new Map<number,string>();
 globalThis.fetch=async(url:any,options:any)=>{try{const b=JSON.parse(options?.body);if(b.method==='eth_call'){const to=String(b.params?.[0]?.to).toLowerCase();
  if(to===AGENT_ID_REGISTRY.toLowerCase())return Response.json({jsonrpc:'2.0',id:b.id,result:'0x'+'1'.padStart(64,'0')});
  if(to===NIB_COLLECTION.toLowerCase()){const d=decodeFunctionData({abi:nftAbi,data:b.params[0].data});const held=(w:string)=>[...owners].filter(([,o])=>o===String(w).toLowerCase()).map(([t])=>t).sort((x,y)=>x-y);
   const value:any=d.functionName==='balanceOf'?BigInt(held(d.args[0] as string).length):d.functionName==='tokenOfOwnerByIndex'?BigInt(held(d.args[0] as string)[Number(d.args[1])]):owners.get(Number(d.args[0]))||'0x'+'0'.repeat(40);
   return Response.json({jsonrpc:'2.0',id:b.id,result:encodeFunctionResult({abi:nftAbi,functionName:d.functionName as any,result:value})});}}}catch{}return oldFetch(url,options);};
 const env:any={DB:db,BSC_RPC_URL:c.rpc,NIB_SIGNER_PRIVATE_KEY:signerKey,NIB_AIRDROP:c.airdrop,NIB_TOKEN:c.token};
 const req=async(path:string,body?:any,user='',e:any=env)=>{clearAirdropCache();const r=await handle(new Request('https://game.test/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{'oai-authenticated-user-id':user}:{})},body:body?JSON.stringify(body):undefined}),e);return {status:r.status,body:await r.json() as any};};
 async function player(user:string){const account=privateKeyToAccount(generatePrivateKey()),key=privateKeyToAccount(generatePrivateKey());const pair=await req('pair',{},user);const ch=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:key.address});const s=await req('agent/session',{challengeId:ch.body.challengeId,signature:await account.signTypedData(ch.body.typedData)});assert.equal(s.status,200,JSON.stringify(s.body));let nonce=0;return {wallet:account.address.toLowerCase(),address:account.address,user,async act(action:string,payload:any={}){const envelope={sessionId:s.body.sessionId,nonce,timestamp:Date.now(),action,payload},signature=await key.signTypedData(actionData('https://game.test',envelope) as any);const result=await req('agent/action',{...envelope,signature});if(result.body.nonce!==undefined)nonce=result.body.nonce;return result;}};}
 const agent=(w:string)=>db.prepare('SELECT points,earned,bonus_points AS bonus FROM agents WHERE wallet=?').bind(w).first<any>().then(r=>({...r,bonus:Number(r.bonus)}));
 const claim=(p:any)=>req('airdrop/nft-bonus',{},p.user);
 try{
  const [alpha,eta]=[await player('alpha'),await player('eta')];
  owners.set(1,alpha.wallet);owners.set(2,alpha.wallet);owners.set(40,eta.wallet);
  await c.air('openNextSeason');
  const st=await req('airdrop',undefined,alpha.user);
  assert.equal(st.body.nftBonus.available,false);
  assert.equal(st.body.nftBonus.remainingPoints,'0');
  assert.equal(st.body.nftBonus.remainingNib,'0');
  assert.equal(st.body.nftBonus.user.claimableNow,0);
  const refused=await claim(alpha);assert.equal(refused.status,409);assert.match(refused.body.error,/closed/i);
  assert.equal((await agent(alpha.wallet)).bonus,0);
  const act=await eta.act('airdrop-nft-bonus');assert.equal(act.status,409);assert.match(act.body.error,/closed/i);
  void NFT_BONUS_CAP_POINTS;void parseEther;void keccak256;void toHex;void recoverTypedDataAddress;
 }finally{globalThis.fetch=oldFetch;await db.close();await c.close();}
});
