import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import {encodeFunctionData,parseEther,zeroAddress} from 'viem';
import {nftChain} from './helpers/nft-chain';
import {marketQuote,NFT_PAYMENT} from '../lib/nft-protocol';
import {AGENT_ID_REGISTRY} from '../lib/protocol';

// A contract wallet that can reject BNB / NFTs and re-enter the bid contract from either callback.
const mocks=`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IBids {function placeBid(uint256,uint256,uint256) external payable returns(uint256);function cancelBid(uint256,address payable) external;function acceptBid(uint256,uint256,address,uint256,uint256) external;}
interface INft {function approve(address,uint256) external;function setApprovalForAll(address,bool) external;}
contract Actor {
 IBids public m;bool public rejectBNB;bool public rejectNFT;uint8 public mode;bytes public data;bool public reentered;bool public reentrySucceeded;
 constructor(address m_){m=IBids(m_);}
 function configure(bool b,bool n,uint8 md,bytes calldata d) external {rejectBNB=b;rejectNFT=n;mode=md;data=d;reentered=false;reentrySucceeded=false;}
 function place(uint256 price,uint256 qty,uint256 exp) external payable returns(uint256){return m.placeBid{value:msg.value}(price,qty,exp);}
 function cancel(uint256 id,address payable to) external {m.cancelBid(id,to);}
 function approveNft(address nft,address spender,uint256 id) external {INft(nft).approve(spender,id);}
 function accept(uint256 id,uint256 token,address bidder,uint256 price,uint256 deadline) external {m.acceptBid(id,token,bidder,price,deadline);}
 function hook(uint8 when) private {if(mode==when){reentered=true;(bool ok,)=address(m).call(data);reentrySucceeded=ok;}}
 receive() external payable {require(!rejectBNB,"Reject BNB");hook(1);}
 function onERC721Received(address,address,uint256,bytes calldata) external returns(bytes4){require(!rejectNFT,"Reject NFT");hook(2);return 0x150b7a02;}
}
`;
let compiled:any;
function actorArtifact(){if(compiled)return compiled;const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Actor.sol':{content:mocks}},settings:{evmVersion:'paris',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));if(out.errors?.some((e:any)=>e.severity==='error'))throw Error(out.errors.map((e:any)=>e.formattedMessage).join('\n'));return compiled=out.contracts['Actor.sol'].Actor;}

test('NibCollectionBids: collection-wide escrowed bids, partial fills, exact fees, cancellation and reentrancy safety',async t=>{
 const f=await nftChain(),nft=f.art('NibCollection').abi,cb=JSON.parse(fs.readFileSync('artifacts/NibCollectionBids.json','utf8')),legacy=f.art('NibMarketplace').abi,actor=actorArtifact();
 const seller=f.accounts[1].address,bidder=f.accounts[2].address,other=f.accounts[3].address,treasury=f.accounts[9].address;
 const balance=(a:any)=>f.client.getBalance({address:a});
 const gasOf=async(hash:any)=>{const r=await f.client.getTransactionReceipt({hash});return r.gasUsed*r.effectiveGasPrice;};
 const ownerIs=async(tokenId:bigint,who:string)=>assert.equal(String(await f.read(f.collection,nft,'ownerOf',[tokenId])).toLowerCase(),who.toLowerCase());
 const registry=(who:string,n:bigint)=>f.write(AGENT_ID_REGISTRY,f.m.MockIdentity.abi,'set',[who,n]);
 try{
 const bids=await f.deploy(cb,[f.collection,AGENT_ID_REGISTRY,treasury]);
 const rd=(name:string,args:any[]=[])=>f.read(bids,cb.abi,name,args);
 const wr=(name:string,args:any[],who:number,value=0n)=>f.write(bids,cb.abi,name,args,who,value);
 const expiry=async(extra=3600n)=>BigInt((await f.client.getBlock()).timestamp)+extra;
 const escrowOk=async()=>assert.equal(await balance(bids),await rd('escrowedBNB'),'Contract holds exactly the unfilled escrow');
 const deposit=(price:bigint,qty:bigint)=>marketQuote(price).buyerTotal*qty;
 const place=async(price:bigint,qty:bigint,who=2,exp?:bigint)=>{await wr('placeBid',[price,qty,exp??await expiry()],who,deposit(price,qty));return await rd('bidNonce') as bigint;};
 const accept=async(id:bigint,token:bigint,who=1,b=bidder,price?:bigint,deadline?:bigint)=>{const bid=await rd('bids',[id]);return wr('acceptBid',[id,token,b,price??bid[1],deadline??await expiry(600n)],who);};
 await f.write(NFT_PAYMENT,f.m.MockToken.abi,'approve',[f.collection,parseEther('9')],1);
 await f.write(f.collection,nft,'mint',[10n,parseEther('9'),await f.deadline(),f.intent()],1); // account 1 owns tokens 1..10

 await t.test('constructor guards and fee parity with NibMarketplace.quote',async()=>{
  await assert.rejects(f.deploy(cb,[bidder,AGENT_ID_REGISTRY,treasury]));await assert.rejects(f.deploy(cb,[f.collection,bidder,treasury]));await assert.rejects(f.deploy(cb,[f.collection,AGENT_ID_REGISTRY,zeroAddress]));await assert.rejects(f.deploy(cb,[f.collection,AGENT_ID_REGISTRY,f.collection]));
  assert.equal(await rd('BUYER_FEE_BPS'),200n);assert.equal(await rd('SELLER_FEE_BPS'),200n);assert.equal(await rd('MAX_QUANTITY'),10000n);
  assert.equal((await rd('feeRecipient')).toLowerCase(),treasury.toLowerCase());assert.equal((await rd('collection')).toLowerCase(),f.collection.toLowerCase());
  for(const price of [1n,2n,49n,50n,51n,99n,101n,12345678901234567n,parseEther('1'),parseEther('1000000')]){
   const q=marketQuote(price),mine=await rd('quote',[price]),theirs=await f.read(f.market,legacy,'quote',[price]);
   assert.deepEqual(mine,[q.buyerFee,q.sellerFee,q.buyerTotal,q.sellerProceeds]);assert.deepEqual(mine,theirs,'Rounding is identical to the per-NFT marketplace');
  }
 });

 await t.test('placeBid escrows exactly quantity x (price + 2%), enforces identity, price, quantity and expiry',async()=>{
  const price=parseEther('0.01'),exp=await expiry(),total=deposit(price,3n);
  for(const value of [0n,total-1n,total+1n,price*3n])await assert.rejects(f.write(bids,cb.abi,'placeBid',[price,3n,exp],2,value));
  await assert.rejects(f.write(bids,cb.abi,'placeBid',[price,3n,exp],15,total),'Bidder needs an Agent ID');
  await assert.rejects(f.write(bids,cb.abi,'placeBid',[0n,3n,exp],2,0n));await assert.rejects(f.write(bids,cb.abi,'placeBid',[parseEther('1000001'),1n,exp],2,deposit(parseEther('1000001'),1n)));
  await assert.rejects(f.write(bids,cb.abi,'placeBid',[price,0n,exp],2,0n));await assert.rejects(f.write(bids,cb.abi,'placeBid',[1n,10001n,exp],2,marketQuote(1n).buyerTotal*10001n));
  await assert.rejects(f.write(bids,cb.abi,'placeBid',[price,3n,1n],2,total));await assert.rejects(f.write(bids,cb.abi,'placeBid',[price,3n,BigInt((await f.client.getBlock()).timestamp)+31n*86400n],2,total));
  const before=await balance(bidder),hash=await wr('placeBid',[price,3n,exp],2,total),id=await rd('bidNonce') as bigint;
  assert.equal(id,1n);assert.equal(before-await balance(bidder)-await gasOf(hash),total);
  assert.deepEqual(await rd('bids',[id]),[bidder,price,3n,0n,exp]);assert.equal(await rd('remaining',[id]),3n);assert.equal(await rd('bidAvailable',[id]),true);
  assert.equal(await rd('bidCount'),1n);assert.equal(await rd('bidAt',[0n]),id);assert.equal(await rd('bidderBidCount',[bidder]),1n);assert.equal(await rd('bidderBidAt',[bidder,0n]),id);assert.equal(await rd('escrowedBNB'),total);await escrowOk();
  assert.equal(await f.read(f.collection,nft,'ownerOf',[1n]),seller,'Placing a bid never moves an NFT');
  await place(parseEther('0.02'),1n,2);assert.equal(await rd('bidderBidCount',[bidder]),2n,'A bidder may hold many collection bids');await wr('cancelBid',[2n,bidder],2);await escrowOk();
 });

 await t.test('any holder sells one NFT into the bid: exact payouts, fees to treasury, quantity decrements',async()=>{
  const id=1n,price=parseEther('0.01'),q=marketQuote(price),exp=await expiry(600n);
  await assert.rejects(wr('acceptBid',[id,1n,bidder,price,exp],1),'Needs approval for the NFT');
  await f.write(f.collection,nft,'approve',[bids,1n],1);
  await assert.rejects(wr('acceptBid',[id,1n,bidder,price,exp],3),'Not the owner');await assert.rejects(wr('acceptBid',[id,1n,other,price,exp],1),'Wrong bidder');await assert.rejects(wr('acceptBid',[id,1n,bidder,price+1n,exp],1),'Price changed');await assert.rejects(wr('acceptBid',[id,1n,bidder,price,1n],1),'Deadline passed');await assert.rejects(wr('acceptBid',[99n,1n,bidder,price,exp],1),'Missing bid');
  await registry(seller,0n);await assert.rejects(wr('acceptBid',[id,1n,bidder,price,exp],1),'Seller needs an Agent ID');await registry(seller,1n);
  await registry(bidder,0n);await assert.rejects(wr('acceptBid',[id,1n,bidder,price,exp],1),'Bidder needs an Agent ID');assert.equal(await rd('bidAvailable',[id]),false);await registry(bidder,1n);
  const sBefore=await balance(seller),tBefore=await balance(treasury),bBefore=await balance(bidder),hash=await accept(id,1n);
  assert.equal(await balance(seller)+await gasOf(hash),sBefore+q.sellerProceeds);assert.equal(await balance(treasury),tBefore+q.buyerFee+q.sellerFee);assert.equal(await balance(bidder),bBefore,'Acceptance spends escrow, not the bidder wallet');
  await ownerIs(1n,bidder);assert.equal(await rd('remaining',[id]),2n);assert.equal((await rd('bids',[id]))[3],1n);
  assert.equal(await rd('completedSales'),1n);assert.equal(await rd('volume'),price);assert.equal(await rd('feesCollected'),q.buyerFee+q.sellerFee);assert.equal(await rd('escrowedBNB'),deposit(price,2n));assert.equal(await rd('bidCount'),1n);await escrowOk();
  await assert.rejects(wr('acceptBid',[id,1n,bidder,price,exp],1),'The NFT already moved; the old owner cannot sell it again');
 });

 await t.test('a different holder can fill the rest; collection-wide approval works; a full fill closes the bid',async()=>{
  const id=1n,price=parseEther('0.01'),q=marketQuote(price);
  await assert.rejects(accept(id,2n,1),'Not approved yet');
  await f.write(f.collection,nft,'setApprovalForAll',[bids,true],1);
  await f.write(f.collection,nft,'transferFrom',[seller,other,3n],1); // account 3 now holds token 3
  await f.write(f.collection,nft,'approve',[bids,3n],3);
  await accept(id,3n,3);await ownerIs(3n,bidder);assert.equal(await rd('remaining',[id]),1n);
  const sBefore=await balance(seller),hash=await accept(id,2n,1);assert.equal(await balance(seller)+await gasOf(hash),sBefore+q.sellerProceeds);
  assert.equal(await rd('bidCount'),0n);assert.equal(await rd('bidderBidCount',[bidder]),0n);assert.equal(await rd('escrowedBNB'),0n);assert.equal(await balance(bids),0n);
  assert.deepEqual(await rd('bids',[id]),[zeroAddress,0n,0n,0n,0n]);assert.equal(await rd('bidAvailable',[id]),false);assert.equal(await rd('completedSales'),3n);
  await assert.rejects(accept(id,4n,1,bidder,price),'Filled bid cannot be accepted again');await assert.rejects(wr('cancelBid',[id,bidder],2),'Filled bid cannot be cancelled');
 });

 await t.test('cancel refunds exactly the unfilled remainder with no fee, to the chosen recipient, even after expiry or without an Agent ID',async()=>{
  const price=parseEther('0.005'),q=marketQuote(price),id=await place(price,4n,2);await f.write(f.collection,nft,'approve',[bids,4n],1);await accept(id,4n,1);
  await assert.rejects(wr('cancelBid',[id,bidder],1),'Only the bidder');await assert.rejects(wr('cancelBid',[id,zeroAddress],2));await assert.rejects(wr('cancelBid',[id,bids],2));await assert.rejects(wr('cancelBid',[999n,bidder],2));
  await registry(bidder,0n);const fees=await rd('feesCollected'),dest=f.accounts[8].address,before=await balance(dest);
  await wr('cancelBid',[id,dest],2);assert.equal(await balance(dest),before+q.buyerTotal*3n);assert.equal(await rd('feesCollected'),fees,'No fee on a refund');assert.equal(await rd('bidderBidCount',[bidder]),0n);assert.equal(await rd('escrowedBNB'),0n);await escrowOk();await registry(bidder,1n);
  await assert.rejects(wr('cancelBid',[id,bidder],2),'Cannot replay a cancellation');
  // expiry
  const exp=BigInt((await f.client.getBlock()).timestamp)+20n,id2=await place(price,2n,2,exp);await f.provider.request({method:'evm_increaseTime',params:[30]});await f.provider.request({method:'evm_mine',params:[]});
  assert.equal(await rd('bidAvailable',[id2]),false);await f.write(f.collection,nft,'approve',[bids,5n],1);await assert.rejects(accept(id2,5n,1),'Expired bids cannot be accepted');
  const b2=await balance(bidder),h2=await wr('cancelBid',[id2,bidder],2);assert.equal(await balance(bidder)+await gasOf(h2),b2+q.buyerTotal*2n);await escrowOk();await ownerIs(5n,seller);
 });

 await t.test('one wei and odd prices: per-NFT fee rounding keeps escrow exactly solvent through every fill and cancel',async()=>{
  for(const price of [1n,49n,99n,101n,12345678901234567n]){
   const q=marketQuote(price),id=await place(price,3n,2);assert.equal(await rd('escrowedBNB'),q.buyerTotal*3n);
   const tokens=[6n,7n];await f.write(f.collection,nft,'setApprovalForAll',[bids,true],1);
   const pre=await balance(treasury);await accept(id,tokens[0],1,bidder,price);assert.equal(await balance(treasury)-pre,q.buyerFee+q.sellerFee);await escrowOk();
   await wr('cancelBid',[id,bidder],2);await escrowOk();assert.equal(await rd('escrowedBNB'),0n);
   await f.write(f.collection,nft,'transferFrom',[bidder,seller,tokens[0]],2); // return the token for the next round
   tokens.reverse();
  }
  assert.equal(await balance(bids),0n);
 });

 await t.test('failing receivers roll back atomically: NFT delivery, seller payment, fee payout and refund',async()=>{
  const price=parseEther('0.002'),q=marketQuote(price);
  // bidder contract that rejects NFTs
  const rejecting=await f.deploy(actor,[bids]);await registry(rejecting,1n);await f.write(rejecting,actor.abi,'configure',[false,true,0,'0x']);
  await f.write(rejecting,actor.abi,'place',[price,1n,await expiry()],0,deposit(price,1n));const id=await rd('bidNonce') as bigint;
  await f.write(f.collection,nft,'setApprovalForAll',[bids,true],1);const esc=await rd('escrowedBNB');
  await assert.rejects(accept(id,8n,1,rejecting,price));await ownerIs(8n,seller);assert.equal(await rd('escrowedBNB'),esc);assert.equal(await rd('remaining',[id]),1n);await escrowOk();
  // refund recipient that rejects BNB: cancel reverts and the bid is untouched; then choose another recipient
  await f.write(rejecting,actor.abi,'configure',[true,true,0,'0x']);await assert.rejects(f.write(rejecting,actor.abi,'cancel',[id,rejecting],0));assert.equal(await rd('remaining',[id]),1n);
  const dest=f.accounts[8].address,b=await balance(dest);await f.write(rejecting,actor.abi,'cancel',[id,dest],0);assert.equal(await balance(dest),b+q.buyerTotal);await escrowOk();
  // seller contract that rejects BNB proceeds
  const poor=await f.deploy(actor,[bids]);await registry(poor,1n);await f.write(f.collection,nft,'transferFrom',[seller,poor,9n],1);await f.write(poor,actor.abi,'approveNft',[f.collection,bids,9n],0);await f.write(poor,actor.abi,'configure',[true,false,0,'0x']);
  const id2=await place(price,1n,2);await assert.rejects(f.write(poor,actor.abi,'accept',[id2,9n,bidder,price,await expiry(600n)],0));await ownerIs(9n,poor);assert.equal(await rd('remaining',[id2]),1n);await escrowOk();
  // fee recipient that rejects BNB (a contract treasury) blocks only its own market, atomically
  const sink=await f.deploy(actor,[bids]);await f.write(sink,actor.abi,'configure',[true,false,0,'0x']);const alt=await f.deploy(cb,[f.collection,AGENT_ID_REGISTRY,sink]);
  await f.write(alt,cb.abi,'placeBid',[price,1n,await expiry()],2,deposit(price,1n));await f.write(f.collection,nft,'approve',[alt,10n],1);
  await assert.rejects(f.write(alt,cb.abi,'acceptBid',[1n,10n,bidder,price,await expiry(600n)],1));await ownerIs(10n,seller);assert.equal(await balance(alt),q.buyerTotal);
  await wr('cancelBid',[id2,bidder],2);await escrowOk();
 });

 await t.test('reentrancy: the BNB payout and NFT callbacks cannot re-enter accept, cancel or place',async()=>{
  const price=parseEther('0.003'),q=marketQuote(price);
  // Seller contract holds tokens 11 & 12 and re-enters acceptBid for the second token while being paid.
  const s=await f.deploy(actor,[bids]);await registry(s,1n);
  await f.write(NFT_PAYMENT,f.m.MockToken.abi,'approve',[f.collection,parseEther('2')],4);await f.write(f.collection,nft,'mint',[2n,parseEther('2'),await f.deadline(),f.intent()],4);
  const t1=(await f.read(f.collection,nft,'tokenOfOwnerByIndex',[f.accounts[4].address,0n])) as bigint,t2=(await f.read(f.collection,nft,'tokenOfOwnerByIndex',[f.accounts[4].address,1n])) as bigint;
  for(const tk of [t1,t2]){await f.write(f.collection,nft,'transferFrom',[f.accounts[4].address,s,tk],4);await f.write(s,actor.abi,'approveNft',[f.collection,bids,tk],0);}
  const id=await place(price,2n,2),deadline=await expiry(600n);
  await f.write(s,actor.abi,'configure',[false,false,1,encodeFunctionData({abi:cb.abi,functionName:'acceptBid',args:[id,t2,bidder,price,deadline]})]);
  await f.write(s,actor.abi,'accept',[id,t1,bidder,price,deadline],0);
  assert.equal(await f.read(s,actor.abi,'reentered'),true);assert.equal(await f.read(s,actor.abi,'reentrySucceeded'),false,'Re-entrant accept is blocked');
  assert.equal(await rd('remaining',[id]),1n);await ownerIs(t2,s);await escrowOk();
  // Bidder contract tries to cancel its own bid from inside the NFT callback.
  const bc=await f.deploy(actor,[bids]);await registry(bc,1n);await f.write(bc,actor.abi,'place',[price,2n,await expiry()],0,deposit(price,2n));const id2=await rd('bidNonce') as bigint;
  await f.write(bc,actor.abi,'configure',[false,false,2,encodeFunctionData({abi:cb.abi,functionName:'cancelBid',args:[id2,bc]})]);
    await f.write(s,actor.abi,'configure',[false,false,0,'0x']);
  await f.write(s,actor.abi,'accept',[id2,t2,bc,price,await expiry(600n)],0);
  assert.equal(await f.read(bc,actor.abi,'reentered'),true);assert.equal(await f.read(bc,actor.abi,'reentrySucceeded'),false,'Re-entrant cancel is blocked');
  assert.equal(await rd('remaining',[id2]),1n);await ownerIs(t2,bc);await escrowOk();
  await f.write(bc,actor.abi,'configure',[false,false,0,'0x']);await f.write(bc,actor.abi,'cancel',[id2,bc],0);await wr('cancelBid',[id,bidder],2);await escrowOk();assert.equal(await rd('escrowedBNB'),0n);
 });
 }finally{await f.close();}
});
