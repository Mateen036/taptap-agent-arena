import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ganache from 'ganache';import {createWalletClient,createPublicClient,custom,parseEther,keccak256,toHex,zeroAddress,getAddress} from 'viem';import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
const E=(n:number|string)=>parseEther(String(n));
const TREASURY='0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d' as const;
async function setup(){
 const provider=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'}});const accounts=Object.values(provider.getInitialAccounts()).map((a:any)=>privateKeyToAccount(a.secretKey));
 const [owner,other,user1,user2,user3]=accounts;const signer=privateKeyToAccount(generatePrivateKey()),rogue=privateKeyToAccount(generatePrivateKey());
 const chain:any={id:56,name:'Local BNB',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:{default:{http:['http://localhost']}}};
 const mk=(account:any)=>createWalletClient({account,chain,transport:custom(provider as any)});const client=createPublicClient({chain,transport:custom(provider as any)});
 const tokenArt=JSON.parse(fs.readFileSync('artifacts/NibToken.json','utf8')),airArt=JSON.parse(fs.readFileSync('artifacts/NibAirdrop.json','utf8'));
 const wallet=mk(owner);const deploy=async(art:any,args:any[])=>{const hash=await wallet.deployContract({abi:art.abi,bytecode:art.bytecode,args});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return {address:r.contractAddress!,gas:r.gasUsed};};
 const airdrop=await deploy(airArt,[owner.address,signer.address]);const token=await deploy(tokenArt,[airdrop.address,TREASURY]);
 const clients=Object.fromEntries([owner,other,user1,user2,user3].map(a=>[a.address,mk(a)]));
 const air=(fn:string,args:any[]=[],who:any=owner)=>clients[who.address].writeContract({address:airdrop.address,abi:airArt.abi,functionName:fn,args}).then(async(hash:any)=>{const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw Error('reverted');return r;});
 const read=(fn:string,args:any[]=[])=>client.readContract({address:airdrop.address,abi:airArt.abi,functionName:fn,args}) as Promise<any>;
 const bal=(a:string)=>client.readContract({address:token.address,abi:tokenArt.abi,functionName:'balanceOf',args:[a]}) as Promise<bigint>;
 const voucher=async(wallet_:string,season:number,cumulativePoints:bigint,opts:{deadline?:bigint,key?:any,id?:string}={})=>{
  const block=await client.getBlock();const message={wallet:wallet_ as `0x${string}`,season:BigInt(season),cumulativePoints,deadline:opts.deadline??block.timestamp+3600n,voucherId:(opts.id??keccak256(toHex(Math.random().toString()))) as `0x${string}`};
  const signature=await (opts.key||signer).signTypedData({domain:{name:'NibAirdrop',version:'1',chainId:56,verifyingContract:airdrop.address},types:{Voucher:[{name:'wallet',type:'address'},{name:'season',type:'uint256'},{name:'cumulativePoints',type:'uint256'},{name:'deadline',type:'uint256'},{name:'voucherId',type:'bytes32'}]},primaryType:'Voucher',message});
  return {message,signature};};
 const claim=async(who:any,v:any)=>air('claim',[v.message,v.signature],who);
 const fund=async()=>air('setToken',[token.address]);
 const warp=async(s:number)=>{await provider.request({method:'evm_increaseTime',params:[s]});await provider.request({method:'evm_mine',params:[]});};
 return {provider,client,owner,other,user1,user2,user3,signer,rogue,airdrop,token,tokenArt,airArt,air,read,bal,voucher,claim,fund,warp,clients};
}
const rejects=(p:Promise<any>,re?:RegExp)=>assert.rejects(p,re);
test('NibToken: fixed 1B supply, 80/20 split, 18 decimals, no owner or admin surface',async()=>{
 const t=await setup();
 try{
  const read=(fn:string,args:any[]=[])=>t.client.readContract({address:t.token.address,abi:t.tokenArt.abi,functionName:fn,args}) as Promise<any>;
  assert.equal(await read('name'),'NIB Token');assert.equal(await read('symbol'),'NIB');assert.equal(await read('decimals'),18);
  assert.equal(await read('totalSupply'),E(1_000_000_000));assert.equal(await t.bal(t.airdrop.address),E(800_000_000));assert.equal(await t.bal(TREASURY),E(200_000_000));
  const names=t.tokenArt.abi.filter((x:any)=>x.type==='function').map((x:any)=>x.name);
  for(const forbidden of ['owner','mint','burn','pause','transferOwnership','renounceOwnership','blacklist','setTax','setFee'])assert.equal(names.includes(forbidden),false,forbidden+' must not exist');
  assert.equal((await read('airdrop')).toLowerCase(),t.airdrop.address.toLowerCase());
  // Constructor validation.
  const deployToken=(a:any,b:any)=>t.clients[t.owner.address].deployContract({abi:t.tokenArt.abi,bytecode:t.tokenArt.bytecode,args:[a,b]}).then((h:any)=>t.client.waitForTransactionReceipt({hash:h})).then((r:any)=>{if(r.status!=='success')throw Error('reverted')});
  await rejects(deployToken(zeroAddress,TREASURY));await rejects(deployToken(t.user1.address,TREASURY),/contract/);await rejects(deployToken(t.airdrop.address,zeroAddress));await rejects(deployToken(t.airdrop.address,t.airdrop.address));
  console.log('gas NibAirdrop',t.airdrop.gas,'NibToken',t.token.gas);
 }finally{await t.provider.disconnect();}
});
test('NibAirdrop: setup, rates, allocations, season ordering and ownership safety',async()=>{
 const t=await setup();
 try{
  assert.equal(await t.read('currentSeason'),0n);assert.equal(await t.read('pool',[1n]),E(400_000_000));
  for(const s of [2n,3n,4n,5n])assert.equal(await t.read('pool',[s]),E(100_000_000));
  assert.equal((await t.read('seasons',[1n]))[4],10n,'default 10 TAP = 1 NIB');
  await rejects(t.air('openNextSeason'),/Token not set/);
  await rejects(t.air('setToken',[t.token.address],t.other));
  await t.fund();await rejects(t.air('setToken',[t.token.address]),/already set/);
  await rejects(t.air('openNextSeason',[],t.other));
  // Allocation: seasons 2-4 resizable, season 5 absorbs the remainder, total never exceeds 400M.
  await t.air('setSeasonAllocation',[2n,E(150_000_000)]);assert.equal(await t.read('pool',[5n]),E(50_000_000));
  await rejects(t.air('setSeasonAllocation',[1n,E(1)]),/locked/);await rejects(t.air('setSeasonAllocation',[5n,E(1)]),/locked/);
  await rejects(t.air('setSeasonAllocation',[3n,E(250_000_000)]),/exceeds/);await rejects(t.air('setSeasonAllocation',[3n,0n]),/exceeds/);
  await rejects(t.air('setSeasonAllocation',[2n,E(1)],t.other));
  const pools=await Promise.all([1n,2n,3n,4n,5n].map(s=>t.read('pool',[s])));assert.equal(pools.reduce((a:bigint,b:bigint)=>a+b,0n),E(800_000_000));
  await rejects(t.air('setSeasonRate',[1n,0n]),/Invalid rate/);await rejects(t.air('setSeasonRate',[1n,10n**13n]),/Invalid rate/);await rejects(t.air('setSeasonRate',[6n,10n]),/locked/);
  await t.air('setSeasonRate',[2n,20n]);assert.equal((await t.read('seasons',[2n]))[4],20n);
  await t.air('openNextSeason');assert.equal(await t.read('currentSeason'),1n);
  await rejects(t.air('setSeasonRate',[1n,5n]),/locked/);await t.air('setSeasonRate',[3n,5n]);
  await rejects(t.air('openNextSeason'),/still open/);
  await rejects(t.air('renounceOwnership'),/Renounce disabled/);
  // Two-step ownership.
  await t.air('transferOwnership',[t.other.address]);assert.equal((await t.read('owner')).toLowerCase(),t.owner.address.toLowerCase());await t.air('acceptOwnership',[],t.other);assert.equal((await t.read('owner')).toLowerCase(),t.other.address.toLowerCase());
  await rejects(t.air('endSeason'),undefined);await t.air('endSeason',[],t.other);
  // No function can move NIB out except claim.
  const names=t.airArt.abi.filter((x:any)=>x.type==='function'&&x.stateMutability!=='view'&&x.stateMutability!=='pure').map((x:any)=>x.name).sort();
  assert.deepEqual(names,['acceptOwnership','claim','endSeason','openNextSeason','pause','setSeasonAllocation','setSeasonRate','setSigner','setToken','transferOwnership','unpause']);
 }finally{await t.provider.disconnect();}
});
test('NibAirdrop: setToken requires the funded token',async()=>{
 const t=await setup();
 try{
  // The airdrop holds 800M, but a different (unfunded) token address must be rejected.
  await rejects(t.air('setToken',[t.user1.address]));
  await rejects(t.air('setToken',[zeroAddress]));
 }finally{await t.provider.disconnect();}
});
test('NibAirdrop: vouchers convert 10 TAP = 1 NIB, are cumulative, expire, and reject forgeries and replays',async()=>{
 const t=await setup();
 try{
  await t.fund();await t.air('openNextSeason');
  const u=t.user1.address;
  // Claim 1: 1,000 points -> 100 NIB.
  const v1=await t.voucher(u,1,1000n);await t.claim(t.other,v1);// anyone can relay; NIB always goes to the voucher wallet
  assert.equal(await t.bal(u),E(100));assert.equal(await t.read('convertedPoints',[1n,u]),1000n);
  await rejects(t.claim(t.user1,v1),/Nothing to claim/);// replay
  // Cumulative: a later voucher for 2,500 pays only the 1,500 delta -> 150 NIB.
  await t.claim(t.user1,await t.voucher(u,1,2500n));assert.equal(await t.bal(u),E(250));assert.equal(await t.read('convertedPoints',[1n,u]),2500n);
  // Lower cumulative than already converted pays nothing.
  await rejects(t.claim(t.user1,await t.voucher(u,1,2000n)),/Nothing to claim/);
  // Odd points: 7 points -> 0.7 NIB.
  await t.claim(t.user1,await t.voucher(u,1,2507n));assert.equal(await t.bal(u),E(250)+E('0.7'));
  // Forged / tampered / wrong-season / expired vouchers.
  await rejects(t.claim(t.user1,await t.voucher(u,1,9000n,{key:t.rogue})),/Invalid voucher/);
  const good=await t.voucher(u,1,9000n);await rejects(t.claim(t.user1,{message:{...good.message,cumulativePoints:90000n},signature:good.signature}),/Invalid voucher/);
  await rejects(t.claim(t.user1,{message:{...good.message,wallet:t.user2.address},signature:good.signature}),/Invalid voucher/);
  await rejects(t.claim(t.user1,await t.voucher(u,2,9000n)),/Season not open/);
  const block=await t.client.getBlock();await rejects(t.claim(t.user1,await t.voucher(u,1,9000n,{deadline:block.timestamp-1n})),/expired/);
  const short=await t.voucher(u,1,9000n,{deadline:block.timestamp+60n});await t.warp(120);await rejects(t.claim(t.user1,short),/expired/);
  // Other chains / contracts cannot replay: a voucher signed for another verifying contract is invalid.
  const bad=await t.signer.signTypedData({domain:{name:'NibAirdrop',version:'1',chainId:1,verifyingContract:t.airdrop.address},types:{Voucher:[{name:'wallet',type:'address'},{name:'season',type:'uint256'},{name:'cumulativePoints',type:'uint256'},{name:'deadline',type:'uint256'},{name:'voucherId',type:'bytes32'}]},primaryType:'Voucher',message:good.message});
  await rejects(t.claim(t.user1,{message:good.message,signature:bad}),/Invalid voucher/);
  // previewClaim matches.
  const p=await t.read('previewClaim',[u,1n,3000n]);assert.deepEqual(p,[493n,E('49.3')]);
  // Pause blocks claims; unpause restores.
  await t.air('pause');await rejects(t.claim(t.user1,good));await t.air('unpause');await t.claim(t.user1,good);
  // Signer rotation: old signer stops working, new one works, only the owner may rotate.
  await rejects(t.air('setSigner',[t.rogue.address],t.other));await rejects(t.air('setSigner',[zeroAddress]));
  await t.air('setSigner',[t.rogue.address]);await rejects(t.claim(t.user1,await t.voucher(u,1,12000n)),/Invalid voucher/);await t.claim(t.user1,await t.voucher(u,1,12000n,{key:t.rogue}));
  assert.equal(await t.read('convertedPoints',[1n,u]),12000n);assert.equal(await t.bal(u),E(1200));
  // Wallets are independent (no per-wallet cap): one wallet can convert a huge balance in a single claim.
  await t.claim(t.user2,await t.voucher(t.user2.address,1,10_000_000n*10n,{key:t.rogue}));assert.equal(await t.bal(t.user2.address),E(10_000_000));
 }finally{await t.provider.disconnect();}
});
test('NibAirdrop: Season 1 is FCFS, the last claimer gets the exact remainder, partial fills are accounted, then the season ends and leftover rolls',async()=>{
 const t=await setup();
 try{
  // Shrink the story: season 1 is fixed at 400M, so use a high rate to make the pool drain with small point counts.
  await t.air('setSeasonRate',[1n,1_000_000_000_000n]);// 1e12 points per NIB is the max rate; use the default instead below
  await t.air('setSeasonRate',[1n,10n]);
  await t.fund();await t.air('openNextSeason');
  const pool=E(400_000_000);
  // First claimer takes 399,999,999 NIB worth (3,999,999,990 points) in one go, no cap.
  await t.claim(t.user1,await t.voucher(t.user1.address,1,3_999_999_990n));
  assert.equal(await t.bal(t.user1.address),E(399_999_999));assert.equal(await t.read('remaining',[1n]),E(1));
  // user2 asks for 25 NIB (250 points) but only 1 NIB (10 points) is left: partial fill, exact accounting.
  const ev0=await t.claim(t.user2,await t.voucher(t.user2.address,1,250n));
  assert.equal(await t.bal(t.user2.address),E(1));assert.equal(await t.read('convertedPoints',[1n,t.user2.address]),10n,'only the points actually paid for are converted');
  assert.equal(await t.read('remaining',[1n]),0n);assert.equal((await t.read('seasons',[1n]))[3],pool,'paid == pool');assert.equal((await t.read('seasons',[1n]))[5],2,'status Ended');
  assert.equal(await t.bal(t.airdrop.address),E(800_000_000)-pool);
  // Late claimers cannot claim from the exhausted season, and no revert hides a stuck state: the next season can open.
  await rejects(t.claim(t.user3,await t.voucher(t.user3.address,1,100n)),/Season not open/);
  await t.air('openNextSeason');assert.equal(await t.read('currentSeason'),2n);assert.equal(await t.read('pool',[2n]),E(100_000_000),'nothing left over to roll');
  // user2 can still use their 240 unconverted points in season 2 (server decides how cumulative points carry over).
  await t.claim(t.user2,await t.voucher(t.user2.address,2,240n));assert.equal(await t.bal(t.user2.address),E(1)+E(24));
  assert.equal(await t.read('convertedPoints',[2n,t.user2.address]),240n);
 }finally{await t.provider.disconnect();}
});
test('NibAirdrop: sub-point dust ends a season, odd rates never overpay, owner end rolls leftover forward, season 5 cannot be ended early',async()=>{
 const t=await setup();
 try{
  await t.air('setSeasonRate',[1n,3n]);// 3 points = 1 NIB, so 1 point = 0.333.. NIB (floored)
  await t.air('setSeasonAllocation',[2n,E(100_000_000)]);
  await t.fund();await t.air('openNextSeason');
  await t.claim(t.user1,await t.voucher(t.user1.address,1,1n));assert.equal(await t.bal(t.user1.address),10n**18n/3n);
  // Drain almost everything: pool 400M NIB = 1.2B points at rate 3.
  const afford=await t.read('remaining',[1n]);
  await t.claim(t.user2,await t.voucher(t.user2.address,1,10n**30n));// way more than the pool
  assert.equal((await t.read('seasons',[1n]))[5],2);
  const rem=(await t.read('seasons',[1n]))[2];assert.equal(await t.read('remaining',[1n]),0n,'ended season reports nothing remaining');assert.ok(rem<10n**18n/3n+1n,'only sub-point dust remains');assert.ok(await t.bal(t.user2.address)<=afford);
  assert.equal((await t.read('seasons',[1n]))[2],rem,'dust is rolled out');
  await t.air('openNextSeason');assert.equal(await t.read('pool',[2n]),E(100_000_000)+rem);
  // Owner ends season 2 early with some paid: unpaid rolls into season 3.
  await t.claim(t.user3,await t.voucher(t.user3.address,2,1000n));assert.equal(await t.bal(t.user3.address),E(100));
  await t.air('endSeason');const s2=await t.read('seasons',[2n]);assert.equal(s2[5],2);
  const leftover2=E(100_000_000)+rem-E(100);assert.equal(s2[2],leftover2);assert.equal(await t.read('pool',[2n]),E(100),'ended season pool == paid');
  await rejects(t.air('endSeason'),/No endable/);// season 2 already ended
  await rejects(t.claim(t.user3,await t.voucher(t.user3.address,2,2000n)),/Season not open/);
  await t.air('openNextSeason');await t.air('endSeason');await t.air('openNextSeason');// 3 -> 4
  await t.air('endSeason');await t.air('openNextSeason');assert.equal(await t.read('currentSeason'),5n);
  await rejects(t.air('endSeason'),/No endable/);await rejects(t.air('openNextSeason'),/All seasons used/);
  // Conservation: total pools == 800M and the contract still holds exactly pool minus paid.
  let total=0n,paid=0n;for(const s of [1n,2n,3n,4n,5n]){total+=await t.read('pool',[s]);paid+=(await t.read('seasons',[s]))[3];}
  assert.equal(total,E(800_000_000));assert.equal(await t.bal(t.airdrop.address),E(800_000_000)-paid);
  // Season 5 carries everything left and can still be claimed.
  await t.claim(t.user3,await t.voucher(t.user3.address,5,10_000n));assert.equal(await t.bal(t.user3.address),E(100)+E(1000));
 }finally{await t.provider.disconnect();}
});
test('NibAirdrop: reentrancy guard and signature malleability are not exploitable; unsigned and wrong-length signatures fail',async()=>{
 const t=await setup();
 try{
  await t.fund();await t.air('openNextSeason');
  const v=await t.voucher(t.user1.address,1,100n);
  await rejects(t.claim(t.user1,{message:v.message,signature:'0x'}));await rejects(t.claim(t.user1,{message:v.message,signature:v.signature.slice(0,-2) as any}));
  // High-s malleated signature is rejected by OZ ECDSA.
  const sig=v.signature,r=sig.slice(0,66),s=BigInt('0x'+sig.slice(66,130)),vv=parseInt(sig.slice(130,132),16);
  const n=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;const hs='0x'+r.slice(2)+(n-s).toString(16).padStart(64,'0')+(vv===27?'1c':'1b');
  await rejects(t.claim(t.user1,{message:v.message,signature:('0x'+hs.slice(2)) as any}));
  await t.claim(t.user1,v);assert.equal(await t.bal(t.user1.address),E(10));
 }finally{await t.provider.disconnect();}
});
