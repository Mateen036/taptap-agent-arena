import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import solc from 'solc';import ganache from 'ganache';
import {createWalletClient,createPublicClient,custom,parseEther,zeroAddress} from 'viem';import {privateKeyToAccount} from 'viem/accounts';
const E=(n:number|string)=>parseEther(String(n));const BPS=10000n;
const mocks=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract MockNib is ERC20 {constructor() ERC20("NIB Token","NIB"){} function mint(address a,uint256 n) external {_mint(a,n);}}
interface IMkt {function placeBid(uint256,uint256,uint256) external payable returns(uint256);function cancelBid(uint256) external;function acceptBid(uint256,uint256,uint256,uint256) external;function withdrawCredit(address payable) external;}
contract Actor {
 IMkt public m;IERC20 public t;bool public reject;uint8 public mode;uint256 public targetId;bool public reentered;bool public reentrySucceeded;
 constructor(address m_,address t_){m=IMkt(m_);t=IERC20(t_);}
 function setMarket(address a) external {m=IMkt(a);}
 function configure(bool r,uint8 md,uint256 id) external {reject=r;mode=md;targetId=id;reentered=false;reentrySucceeded=false;}
 function place(uint256 n,uint256 b,uint256 e) external payable returns(uint256){return m.placeBid{value:msg.value}(n,b,e);}
 function cancel(uint256 id) external {m.cancelBid(id);}
 function accept(uint256 id,uint256 amt) external {t.approve(address(m),type(uint256).max);m.acceptBid(id,amt,0,type(uint256).max);}
 function withdrawTo(address payable r) external {m.withdrawCredit(r);}
 function pause(bool v) external {(bool ok,)=address(m).call(abi.encodeWithSignature("setPaused(bool)",v));require(ok);}
 receive() external payable {
  if(reject)revert("no");
  if(mode==1){reentered=true;try m.cancelBid(targetId){reentrySucceeded=true;}catch{}}
  if(mode==2){reentered=true;try m.acceptBid(targetId,1,0,type(uint256).max){reentrySucceeded=true;}catch{}}
  if(mode==3){reentered=true;try m.withdrawCredit(payable(address(this))){reentrySucceeded=true;}catch{}}
  if(mode==4){reentered=true;try m.placeBid{value:0.00102 ether}(1 ether,0.001 ether,0){reentrySucceeded=true;}catch{}}
 }
}
`;
let compiled:any;
function art(){if(compiled)return compiled;const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'M.sol':{content:mocks}},settings:{evmVersion:'paris',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:(p:string)=>({contents:fs.readFileSync('node_modules/'+p,'utf8')})}));if(out.errors?.some((e:any)=>e.severity==='error'))throw Error(out.errors.map((e:any)=>e.formattedMessage).join('\n'));return compiled=out.contracts['M.sol'];}
async function setup(treasuryIsActor=false){
 const provider=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:8}});
 const accounts=Object.values(provider.getInitialAccounts()).map((a:any)=>privateKeyToAccount(a.secretKey));
 const chain:any={id:56,name:'Local BNB',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:{default:{http:['http://localhost']}}};
 const wallets=accounts.map(account=>createWalletClient({account,chain,transport:custom(provider as any)}));const client=createPublicClient({chain,transport:custom(provider as any)});
 const m=art(),mk=JSON.parse(fs.readFileSync('artifacts/NibBidMarket.json','utf8'));
 const [deployer,treasury,alice,bob,carol]=accounts.map(a=>a.address);
 const send=async(hash:any)=>{const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw Error('reverted');return r;};
 const deploy=async(a:any,args:any[]=[],who=0)=>(await send(await wallets[who].deployContract({abi:a.abi,bytecode:a.bytecode||'0x'+a.evm.bytecode.object,args} as any))).contractAddress!;
 const nib=await deploy(m.MockNib);
 let treasuryAddr:any=treasury,market:any,actorT:any;
 if(treasuryIsActor){const tmp=await deploy(mk,[nib,treasury]);actorT=await deploy(m.Actor,[tmp,nib]);market=await deploy(mk,[nib,actorT]);await send(await wallets[0].writeContract({address:actorT,abi:m.Actor.abi,functionName:'setMarket',args:[market]} as any));await send(await wallets[0].writeContract({address:actorT,abi:m.Actor.abi,functionName:'configure',args:[true,0,0n]} as any));treasuryAddr=actorT;}
 else market=await deploy(mk,[nib,treasury]);
 const w=(address:any,abi:any,fn:string,args:any[]=[],who=0,value=0n)=>wallets[who].writeContract({address,abi,functionName:fn,args,value} as any).then(send);
 const r=(address:any,abi:any,fn:string,args:any[]=[])=>client.readContract({address,abi,functionName:fn,args} as any) as Promise<any>;
 const mw=(fn:string,args:any[]=[],who=0,value=0n)=>w(market,mk.abi,fn,args,who,value),mr=(fn:string,args:any[]=[])=>r(market,mk.abi,fn,args);
 const bal=(a:any)=>client.getBalance({address:a});const nibBal=(a:any)=>r(nib,m.MockNib.abi,'balanceOf',[a]) as Promise<bigint>;
 const mint=(to:any,n:bigint)=>w(nib,m.MockNib.abi,'mint',[to,n]);const approve=(who:number,n=2n**256n-1n)=>w(nib,m.MockNib.abi,'approve',[market,n],who);
 const fee=(x:bigint)=>x*200n/BPS;
 const place=async(who:number,nibAmt:bigint,bnb:bigint,exp=0n)=>{await mw('placeBid',[nibAmt,bnb,exp],who,bnb+fee(bnb));return await mr('bidNonce') as bigint;};
 const warp=async(s:number)=>{await provider.request({method:'evm_increaseTime',params:[s]});await provider.request({method:'evm_mine',params:[]});};
 const gasCost=(rc:any)=>rc.gasUsed*rc.effectiveGasPrice;
 const solvent=async()=>assert.equal(await bal(market),(await mr('totalEscrow'))+(await mr('totalCredits')),'balance equals escrow + credits');
 return {provider,client,accounts,wallets,m,mk,deployer,treasury,treasuryAddr,alice,bob,carol,nib,market,actorT,deploy,w,r,mw,mr,bal,nibBal,mint,approve,fee,place,warp,gasCost,solvent,aliceI:2,bobI:3,carolI:4};
}
const rejects=(p:Promise<any>,re?:RegExp)=>assert.rejects(p,re);

test('NibBidMarket: constructor, immutables, 2%+2% fee constants and no owner path to escrow',async()=>{
 const t=await setup();
 try{
  assert.equal((await t.mr('nib')).toLowerCase(),t.nib.toLowerCase());assert.equal((await t.mr('treasury')).toLowerCase(),t.treasury.toLowerCase());
  assert.equal(await t.mr('BUYER_FEE_BPS'),200n);assert.equal(await t.mr('SELLER_FEE_BPS'),200n);assert.equal(await t.mr('MIN_BID_BNB'),E('0.001'));
  assert.deepEqual(await t.mr('quoteBid',[E(1)]),[E('0.02'),E('1.02')]);
  const fns=t.mk.abi.filter((x:any)=>x.type==='function'&&x.stateMutability!=='view'&&x.stateMutability!=='pure').map((x:any)=>x.name).sort();
  assert.deepEqual(fns,['acceptBid','cancelBid','placeBid','setPaused','withdrawCredit'],'the only state-changing surface');
  assert.equal(t.mk.abi.some((x:any)=>['owner','transferOwnership','withdraw','sweep','rescue','setFee','setTreasury'].includes(x.name)),false);
  assert.equal(t.mk.abi.some((x:any)=>x.type==='fallback'||x.type==='receive'),false,'cannot receive stray BNB');
  const dep=(a:any,b:any)=>t.deploy(t.mk,[a,b]);
  await rejects(dep(t.alice,t.treasury));await rejects(dep(t.nib,zeroAddress));await rejects(dep(t.nib,t.nib));
  await rejects(t.wallets[0].sendTransaction({to:t.market,value:1n} as any),/revert/i);// plain BNB transfers are refused
 }finally{await t.provider.disconnect();}
});

test('placeBid: validation, exact deposit, price, expiry, minimum and enumeration',async()=>{
 const t=await setup();
 try{
  const bnb=E('0.01'),nibAmt=E(1000);
  await rejects(t.mw('placeBid',[nibAmt,E('0.00099'),0n],t.aliceI,E('0.00099')+t.fee(E('0.00099'))),/minimum/);
  await rejects(t.mw('placeBid',[nibAmt,bnb,0n],t.aliceI,bnb),/exactly/);await rejects(t.mw('placeBid',[nibAmt,bnb,0n],t.aliceI,bnb+t.fee(bnb)+1n),/exactly/);
  await rejects(t.mw('placeBid',[0n,bnb,0n],t.aliceI,bnb+t.fee(bnb)),/Invalid NIB/);await rejects(t.mw('placeBid',[E(1_000_000_001),bnb,0n],t.aliceI,bnb+t.fee(bnb)),/Invalid NIB/);
  const now=BigInt((await t.client.getBlock()).timestamp);
  await rejects(t.mw('placeBid',[nibAmt,bnb,now-1n],t.aliceI,bnb+t.fee(bnb)),/expiry/);await rejects(t.mw('placeBid',[nibAmt,bnb,now+366n*86400n],t.aliceI,bnb+t.fee(bnb)),/expiry/);
  
  const before=await t.bal(t.alice);const rc=await t.mw('placeBid',[nibAmt,bnb,now+3600n],t.aliceI,bnb+t.fee(bnb));
  assert.equal(before-await t.bal(t.alice)-t.gasCost(rc),bnb+t.fee(bnb));
  const b=await t.mr('getBid',[1n]);assert.equal(b.bidder.toLowerCase(),t.alice.toLowerCase());assert.equal(b.nibRemaining,nibAmt);assert.equal(b.bnbRemaining,bnb);assert.equal(b.feeRemaining,t.fee(bnb));assert.equal(b.priceE18,bnb*10n**18n/nibAmt);
  assert.equal(await t.mr('totalEscrow'),bnb+t.fee(bnb));await t.solvent();assert.equal(await t.mr('activeCount'),1n);assert.equal(await t.mr('bidderBidAt',[t.alice,0n]),1n);
  const id2=await t.place(t.bobI,E(10),E('0.5'));assert.equal(id2,2n);const page=await t.mr('activeBids',[0n,10n]);assert.equal(page.length,2);assert.equal((await t.mr('activeBids',[5n,10n])).length,0);assert.equal((await t.mr('bidderBids',[t.bob,0n,10n])).length,1);
  console.log('gas placeBid',rc.gasUsed);
 }finally{await t.provider.disconnect();}
});

test('acceptBid: full fill pays exactly 2%+2%, NIB goes to buyer, bid removed',async()=>{
 const t=await setup();
 try{
  const bnb=E('0.5'),nibAmt=E(5000),id=await t.place(t.aliceI,nibAmt,bnb);await t.mint(t.bob,E(10000));
  const dl=2n**60n;
  await rejects(t.mw('acceptBid',[id,nibAmt,0n,dl],t.bobI),/revert/i);// not approved (custom ERC20 error, no reason string)
  await t.approve(t.bobI);
  await rejects(t.mw('acceptBid',[id,nibAmt+1n,0n,dl],t.bobI),/Invalid NIB/);await rejects(t.mw('acceptBid',[id,0n,0n,dl],t.bobI),/Invalid NIB/);
  await rejects(t.mw('acceptBid',[id,nibAmt,bnb,dl],t.bobI),/Below minimum/);// seller cannot get the full 0.5 after 2%
  await rejects(t.mw('acceptBid',[id,nibAmt,0n,1n],t.bobI),/expired/);await rejects(t.mw('acceptBid',[99n,nibAmt,0n,dl],t.bobI),/missing/);
  const [sb,tb]=[await t.bal(t.bob),await t.bal(t.treasury)];
  const q=await t.mr('quoteAccept',[id,nibAmt]);assert.deepEqual([...q],[bnb,t.fee(bnb),t.fee(bnb),bnb-t.fee(bnb)]);
  const rc=await t.mw('acceptBid',[id,nibAmt,bnb-t.fee(bnb),dl],t.bobI);
  assert.equal(await t.bal(t.bob)-sb+t.gasCost(rc),bnb-t.fee(bnb),'seller gets price minus 2%');assert.equal(await t.bal(t.treasury)-tb,2n*t.fee(bnb),'treasury gets 2% buyer + 2% seller');
  assert.equal(await t.nibBal(t.alice),nibAmt);assert.equal(await t.nibBal(t.bob),E(5000));
  assert.equal(await t.mr('totalEscrow'),0n);assert.equal(await t.bal(t.market),0n);assert.equal(await t.mr('activeCount'),0n);assert.equal((await t.mr('getBid',[id])).bidder,zeroAddress);
  assert.equal(await t.mr('fills'),1n);assert.equal(await t.mr('volumeBNB'),bnb);assert.equal(await t.mr('volumeNIB'),nibAmt);assert.equal(await t.mr('feesCollected'),2n*t.fee(bnb));
  await rejects(t.mw('acceptBid',[id,1n,0n,dl],t.bobI),/missing/);await rejects(t.mw('cancelBid',[id],t.aliceI),/missing/);
  console.log('gas acceptBid full',rc.gasUsed);
 }finally{await t.provider.disconnect();}
});

test('partial fills: pro-rata rounding never overpays or strands BNB, fills sum exactly to the deposit',async()=>{
 const t=await setup();
 try{
  // Awkward numbers: odd BNB wei and an amount of NIB that does not divide it.
  const bnb=1_234_567_891_234_567n,nibAmt=7n*10n**18n+3n,deposit=bnb+t.fee(bnb);
  const id=await t.place(t.aliceI,nibAmt,bnb);await t.mint(t.bob,E(100));await t.approve(t.bobI);
  let paidSeller=0n,paidFees=0n,left=nibAmt;const tb0=await t.bal(t.treasury),sb0=await t.bal(t.bob);let gas=0n;
  for(const part of [1n,10n**18n,2n*10n**18n+7n,3n]){
   const bid=await t.mr('getBid',[id]);const q=await t.mr('quoteAccept',[id,part]);
   assert.equal(q[0],bid.bnbRemaining*part/bid.nibRemaining,'seller BNB rounds down, never above bid price');
   if(q[0]===0n){await rejects(t.mw('acceptBid',[id,part,0n,2n**60n],t.bobI),/too small/);continue;}
   const rc=await t.mw('acceptBid',[id,part,0n,2n**60n],t.bobI);gas+=t.gasCost(rc);left-=part;paidSeller+=q[3];paidFees+=q[1]+q[2];
   const after=await t.mr('getBid',[id]);assert.equal(after.nibRemaining,left);assert.equal(after.bnbRemaining,bid.bnbRemaining-q[0]);assert.equal(after.feeRemaining,bid.feeRemaining-q[1]);await t.solvent();
   assert.ok(after.priceE18>=bid.priceE18-1n,'price per NIB does not drop for later sellers (beyond 1 wei rounding)');
  }
  // Final fill takes whatever is left: nothing stranded.
  const rest=(await t.mr('getBid',[id])).nibRemaining;const q=await t.mr('quoteAccept',[id,rest]);const rc=await t.mw('acceptBid',[id,rest,0n,2n**60n],t.bobI);gas+=t.gasCost(rc);paidSeller+=q[3];paidFees+=q[1]+q[2];
  assert.equal(await t.mr('totalEscrow'),0n);assert.equal(await t.bal(t.market),0n,'no BNB stuck');assert.equal(await t.nibBal(t.alice),nibAmt,'buyer gets every NIB');
  assert.equal(paidSeller+paidFees,deposit,'seller proceeds + treasury fees equal the buyer deposit exactly');
  assert.equal(await t.bal(t.bob)-sb0+gas,paidSeller);assert.equal(await t.bal(t.treasury)-tb0,paidFees);
 }finally{await t.provider.disconnect();}
});

test('randomised partial fills and cancels keep the contract exactly solvent and conserve every wei',async()=>{
 const t=await setup();
 try{
  let seed=12345n;const rnd=(n:bigint)=>{seed=(seed*6364136223846793005n+1442695040888963407n)&((1n<<64n)-1n);return seed%n;};
  await t.mint(t.bob,E(1_000_000));await t.approve(t.bobI);
  const tb0=await t.bal(t.treasury),sb0=await t.bal(t.bob),ab0=await t.bal(t.alice);let gas=0n,aliceGas=0n;
  for(let round=0;round<12;round++){
   const bnb=E('0.001')+rnd(10n**17n),nibAmt=1n+rnd(10n**22n);
   const rc0=await t.mw('placeBid',[nibAmt,bnb,0n],t.aliceI,bnb+t.fee(bnb));aliceGas+=t.gasCost(rc0);const id=await t.mr('bidNonce') as bigint;
   let n=nibAmt;
   for(let k=0;k<4&&n>0n;k++){
    const part=k===3?n:1n+rnd(n);const q=await t.mr('quoteAccept',[id,part]).catch(()=>null);if(!q||q[0]===0n)continue;
    const rc=await t.mw('acceptBid',[id,part,0n,2n**60n],t.bobI);gas+=t.gasCost(rc);n-=part;await t.solvent();
   }
   if(n>0n){const rc=await t.mw('cancelBid',[id],t.aliceI);aliceGas+=t.gasCost(rc);}
   assert.equal((await t.mr('getBid',[id])).bidder,zeroAddress);
  }
  assert.equal(await t.mr('totalEscrow'),0n);assert.equal(await t.bal(t.market),0n);assert.equal(await t.mr('activeCount'),0n);
  // Conservation: everything alice put in went to seller, treasury, or back to her; the market keeps nothing.
  const aliceNet=ab0-await t.bal(t.alice)-aliceGas,sellerNet=await t.bal(t.bob)-sb0+gas,treasuryNet=await t.bal(t.treasury)-tb0;
  assert.equal(aliceNet,sellerNet+treasuryNet,'alice spent exactly what seller and treasury received');
  assert.equal(await t.mr('feesCollected'),treasuryNet);
 }finally{await t.provider.disconnect();}
});

test('cancelBid: refunds remaining BNB plus unspent fee, no fee, only the bidder, works when paused or expired',async()=>{
 const t=await setup();
 try{
  const bnb=E('0.2'),nibAmt=E(1000),now=BigInt((await t.client.getBlock()).timestamp);
  const id=await t.place(t.aliceI,nibAmt,bnb,now+600n);await t.mint(t.bob,E(1000));await t.approve(t.bobI);
  await t.mw('acceptBid',[id,E(250),0n,2n**60n],t.bobI);// 25% filled
  const bid=await t.mr('getBid',[id]);assert.equal(bid.bnbRemaining,E('0.15'));
  await rejects(t.mw('cancelBid',[id],t.bobI),/not yours/);await rejects(t.mw('cancelBid',[id],0),/not yours/);
  await t.mw('setPaused',[true],1);await t.warp(1200);// paused AND expired
  await rejects(t.mw('acceptBid',[id,1n,0n,2n**60n],t.bobI),/expired/);
  const [ab,tb]=[await t.bal(t.alice),await t.bal(t.treasury)];const rc=await t.mw('cancelBid',[id],t.aliceI);
  assert.equal(await t.bal(t.alice)-ab+t.gasCost(rc),bid.bnbRemaining+bid.feeRemaining);assert.equal(await t.bal(t.treasury),tb,'no fee on cancel');
  assert.equal(await t.bal(t.market),0n);assert.equal(await t.mr('totalEscrow'),0n);assert.equal(await t.mr('activeCount'),0n);assert.equal(await t.mr('bidderBidCount',[t.alice]),0n);
  await rejects(t.mw('cancelBid',[id],t.aliceI),/missing/);
  console.log('gas cancelBid',rc.gasUsed);
 }finally{await t.provider.disconnect();}
});

test('self-accept, expiry, tiny fills and failed NIB transfers are all rejected atomically',async()=>{
 const t=await setup();
 try{
  const id=await t.place(t.aliceI,E(1000),E('0.1'));await t.mint(t.alice,E(1000));await t.approve(t.aliceI);
  await rejects(t.mw('acceptBid',[id,E(1),0n,2n**60n],t.aliceI),/own bid/);
  // Seller without NIB or allowance: whole call reverts, bid untouched.
  await rejects(t.mw('acceptBid',[id,E(1),0n,2n**60n],t.bobI));await t.approve(t.bobI);await rejects(t.mw('acceptBid',[id,E(1),0n,2n**60n],t.bobI));
  assert.equal((await t.mr('getBid',[id])).nibRemaining,E(1000));await t.solvent();
  await t.mint(t.bob,E(10));await t.approve(t.bobI,E(1));await rejects(t.mw('acceptBid',[id,E(2),0n,2n**60n],t.bobI));await t.mw('acceptBid',[id,E(1),0n,2n**60n],t.bobI);
  // Zero-BNB dust fill: huge NIB amount at the minimum BNB means 1 wei of NIB is worth < 1 wei of BNB.
  const id2=await t.place(t.carolI,E(1_000_000_000),E('0.001'));await t.mint(t.bob,E(10));await t.approve(t.bobI);
  await rejects(t.mw('acceptBid',[id2,1n,0n,2n**60n],t.bobI),/too small/);
  const now=BigInt((await t.client.getBlock()).timestamp),id3=await t.place(t.carolI,E(10),E('0.01'),now+60n);await t.warp(120);
  await rejects(t.mw('acceptBid',[id3,E(1),0n,2n**60n],t.bobI),/Bid expired/);await t.mw('cancelBid',[id3],t.carolI);await t.solvent();
 }finally{await t.provider.disconnect();}
});

test('pause: only the treasury, blocks new bids only; accept and cancel keep working; escrow untouched',async()=>{
 const t=await setup();
 try{
  const id=await t.place(t.aliceI,E(100),E('0.05'));await t.mint(t.bob,E(100));await t.approve(t.bobI);
  await rejects(t.mw('setPaused',[true],0),/treasury/);await rejects(t.mw('setPaused',[true],t.aliceI),/treasury/);
  await t.mw('setPaused',[true],1);assert.equal(await t.mr('paused'),true);
  await rejects(t.mw('placeBid',[E(1),E('0.01'),0n],t.aliceI,E('0.0102')),/paused/);
  await t.mw('acceptBid',[id,E(40),0n,2n**60n],t.bobI);assert.equal((await t.mr('getBid',[id])).nibRemaining,E(60));
  const ab=await t.bal(t.alice);const rc=await t.mw('cancelBid',[id],t.aliceI);assert.ok(await t.bal(t.alice)>ab-t.gasCost(rc));
  await t.solvent();assert.equal(await t.bal(t.market),0n);
  await t.mw('setPaused',[false],1);await t.place(t.aliceI,E(1),E('0.01'));
 }finally{await t.provider.disconnect();}
});

test('reentrancy: bidder, seller and withdrawal callbacks cannot re-enter; hostile receivers cannot block trades',async()=>{
 const t=await setup();
 try{
  const A=t.m.Actor,actor=await t.deploy(A,[t.market,t.nib]);const aw=(fn:string,args:any[]=[],value=0n,who=0)=>t.w(actor,A.abi,fn,args,who,value);const ar=(fn:string)=>t.r(actor,A.abi,fn);
  const bnb=E('0.05');
  // 1. Bidder contract re-enters cancelBid from its refund callback.
  await aw('place',[E(100),bnb,0n],bnb+t.fee(bnb));const id1=await t.mr('bidNonce') as bigint;await aw('configure',[false,1,id1]);
  const other=await t.place(t.carolI,E(100),bnb);// another live bid: a successful re-entry would be able to drain this escrow
  await aw('cancel',[id1]);assert.equal(await ar('reentered'),true);assert.equal(await ar('reentrySucceeded'),false);assert.equal(await t.bal(actor),bnb+t.fee(bnb),'refunded exactly once');
  assert.equal((await t.mr('getBid',[other])).bnbRemaining,bnb);await t.solvent();
  // 2. Seller contract re-enters acceptBid from its proceeds callback.
  await t.mint(actor,E(1000));await aw('configure',[false,2,other]);await t.approve(t.carolI);
  const before=await t.bal(actor);await aw('accept',[other,E(40)]);assert.equal(await ar('reentered'),true);assert.equal(await ar('reentrySucceeded'),false);
  assert.equal((await t.mr('getBid',[other])).nibRemaining,E(60),'only the intended 40 NIB were sold');assert.ok(await t.bal(actor)>before);await t.solvent();
  // 3. Rejecting bidder: cancel still succeeds, BNB becomes a credit, withdrawable to another address by the owner of the credit only.
  await aw('configure',[true,0,0n]);await aw('place',[E(100),bnb,0n],bnb+t.fee(bnb));const id3=await t.mr('bidNonce') as bigint;await aw('cancel',[id3]);
  assert.equal(await t.mr('credits',[actor]),bnb+t.fee(bnb));assert.equal(await t.mr('totalCredits'),bnb+t.fee(bnb));await t.solvent();
  await rejects(t.mw('withdrawCredit',[t.deployer],t.bobI),/No credit/);
  await aw('configure',[false,3,0n]);const d0=await t.bal(actor);await aw('withdrawTo',[actor]);assert.equal(await t.bal(actor)-d0,bnb+t.fee(bnb));assert.equal(await t.mr('totalCredits'),0n);assert.equal(await ar('reentered'),true);assert.equal(await ar('reentrySucceeded'),false);
  await rejects(aw('withdrawTo',[actor]),/No credit/);await t.solvent();
  // 4. Rejecting seller: the trade still settles, the seller's proceeds become a credit.
  const id4=await t.place(t.carolI,E(100),bnb);await aw('configure',[true,0,0n]);const feeBefore=await t.mr('feesCollected');
  await aw('accept',[id4,E(100)]);assert.equal(await t.nibBal(t.carol),E(140),'carol received 40 + 100 NIB in total');
  assert.equal(await t.mr('credits',[actor]),bnb-t.fee(bnb));assert.equal((await t.mr('feesCollected'))-feeBefore,2n*t.fee(bnb));await t.solvent();
  // 5. Reentry by placing a new bid from a callback also fails.
  await aw('configure',[false,4,0n]);const id5=await t.place(t.carolI,E(10),E('0.01'));await aw('accept',[id5,E(10)]);assert.equal(await ar('reentrySucceeded'),false);await t.solvent();
 }finally{await t.provider.disconnect();}
});

test('a treasury that rejects BNB cannot block fills or cancels; its fees accrue as credit',async()=>{
 const t=await setup(true);
 try{
  const id=await t.place(t.aliceI,E(100),E('0.1'));await t.mint(t.bob,E(100));await t.approve(t.bobI);
  const sb=await t.bal(t.bob);const rc=await t.mw('acceptBid',[id,E(100),0n,2n**60n],t.bobI);
  assert.equal(await t.bal(t.bob)-sb+t.gasCost(rc),E('0.1')-t.fee(E('0.1')));assert.equal(await t.mr('credits',[t.actorT]),2n*t.fee(E('0.1')));await t.solvent();
  // The treasury (an Actor contract) can later claim, and can pause through the same contract.
  await t.w(t.actorT,t.m.Actor.abi,'configure',[false,0,0n]);await t.w(t.actorT,t.m.Actor.abi,'withdrawTo',[t.carol]);assert.equal(await t.mr('credits',[t.actorT]),0n);assert.equal(await t.bal(t.market),0n);
  await t.w(t.actorT,t.m.Actor.abi,'pause',[true]);assert.equal(await t.mr('paused'),true);
 }finally{await t.provider.disconnect();}
});
