import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionData,parseEther} from 'viem';
import {nftChain} from './helpers/nft-chain';
import {marketQuote,NFT_PAYMENT,NFT_WBNB} from '../lib/nft-protocol';
import {AGENT_ID_REGISTRY} from '../lib/protocol';

test('BNB trading fees and escrowed bids preserve ownership, exact settlements and refundable liabilities',async t=>{
 const f=await nftChain(),nft=f.art('NibCollection').abi,market=f.art('NibMarketplace').abi;
 const seller=f.accounts[1].address,buyer=f.accounts[2].address;
 const balance=(address:any)=>f.client.getBalance({address});
 const liabilities=async()=>assert.equal(await balance(f.market),(await f.read(f.market,market,'escrowedBNB'))+(await f.read(f.market,market,'totalRefunds')),'Market holds exactly bid deposits plus refundable credits');
 const approve=(tokenId:bigint,who=1)=>f.write(f.collection,nft,'approve',[f.market,tokenId],who);
 const place=async(tokenId:bigint,who=2,price=parseEther('0.002'),expiry?:bigint,owner=seller)=>{await f.write(f.market,market,'placeBid',[tokenId,price,expiry??await f.deadline(),owner],who,marketQuote(price).buyerTotal);return await f.read(f.market,market,'bidNonce') as bigint;};
 try{
 await f.write(NFT_PAYMENT,f.m.MockToken.abi,'approve',[f.collection,parseEther('7')],1);await f.write(f.collection,nft,'mint',[8n,parseEther('7'),await f.deadline(),f.intent()],1);
 await t.test('immutable 2% on each side, precise wei rounding and atomic fee recipient payout',async()=>{
  assert.equal((await f.read(f.market,market,'feeRecipient')).toLowerCase(),f.vault.toLowerCase());assert.equal(await f.read(f.market,market,'BUYER_FEE_BPS'),200n);assert.equal(await f.read(f.market,market,'SELLER_FEE_BPS'),200n);
  for(const price of [1n,49n,50n,99n,101n,parseEther('1'),parseEther('1000000')]){const q=marketQuote(price);assert.deepEqual(await f.read(f.market,market,'quote',[price]),[q.buyerFee,q.sellerFee,q.buyerTotal,q.sellerProceeds]);}
  const price=parseEther('1'),q=marketQuote(price);await approve(1n);await f.write(f.market,market,'list',[1n,price,await f.deadline()],1);const l=await f.read(f.market,market,'listings',[1n]),args=[1n,l[0],price,seller,await f.deadline()];
  await assert.rejects(f.write(f.market,market,'buy',args,2,price));await assert.rejects(f.write(f.market,market,'buy',args,2,q.buyerTotal+1n));
  const beforeSeller=await balance(seller),beforeBuyer=await balance(buyer),beforeVault=await f.read(NFT_WBNB,f.m.MockWrapped.abi,'balanceOf',[f.vault]);
  const hash=await f.write(f.market,market,'buy',args,2,q.buyerTotal),receipt=await f.client.getTransactionReceipt({hash});
  assert.equal(await balance(seller),beforeSeller+q.sellerProceeds);assert.equal(beforeBuyer-await balance(buyer)-receipt.gasUsed*receipt.effectiveGasPrice,q.buyerTotal);assert.equal(await f.read(NFT_WBNB,f.m.MockWrapped.abi,'balanceOf',[f.vault]),beforeVault+q.buyerFee+q.sellerFee);assert.equal(await f.read(f.market,market,'feesCollected'),q.buyerFee+q.sellerFee);assert.equal(await f.read(f.collection,nft,'ownerOf',[1n]),buyer);await liabilities();
 });
 await t.test('bids escrow exact price plus buyer fee on unlisted NFTs and enforce identity, owner, duplicate and expiry rules',async()=>{
  const price=parseEther('0.002'),total=marketQuote(price).buyerTotal,expiry=await f.deadline();
  for(const value of [price,total-1n,total+1n])await assert.rejects(f.write(f.market,market,'placeBid',[2n,price,expiry,seller],2,value));
  await assert.rejects(f.write(f.market,market,'placeBid',[2n,price,expiry,seller],1,total));await assert.rejects(f.write(f.market,market,'placeBid',[2n,price,expiry,buyer],2,total));await assert.rejects(f.write(f.market,market,'placeBid',[2n,price,expiry,seller],15,total));await assert.rejects(f.write(f.market,market,'placeBid',[9999n,price,expiry,seller],2,total));await assert.rejects(f.write(f.market,market,'placeBid',[2n,0n,expiry,seller],2,0n));await assert.rejects(f.write(f.market,market,'placeBid',[2n,price,1n,seller],2,total));
  const id=await place(2n);assert.equal(await f.read(f.collection,nft,'ownerOf',[2n]),seller);assert.equal(await f.read(f.market,market,'bidCount'),1n);assert.equal(await f.read(f.market,market,'bidAvailable',[id]),true);assert.equal(await f.read(f.market,market,'bidderBidAt',[buyer,0n]),id);assert.equal(await f.read(f.market,market,'sellerBidAt',[seller,0n]),id);assert.equal(await f.read(f.market,market,'escrowedBNB'),total);await assert.rejects(place(2n));await liabilities();
 });
 await t.test('owner accepts only exact funded terms after NFT approval; stale acceptance and cancellation cannot replay',async()=>{
  const id=await f.read(f.market,market,'bidNonce'),price=parseEther('0.002'),q=marketQuote(price),args=[id,buyer,price,await f.deadline()];
  await assert.rejects(f.write(f.market,market,'acceptBid',args,1));await approve(2n);await assert.rejects(f.write(f.market,market,'acceptBid',args,3));await assert.rejects(f.write(f.market,market,'acceptBid',[id,buyer,price+1n,await f.deadline()],1));await assert.rejects(f.write(f.market,market,'acceptBid',[id,f.accounts[3].address,price,await f.deadline()],1));await assert.rejects(f.write(f.market,market,'acceptBid',[id,buyer,price,1n],1));
  await f.write(f.market,market,'list',[2n,price*2n,await f.deadline()],1);
  const before=await balance(seller),beforeBuyer=await balance(buyer),hash=await f.write(f.market,market,'acceptBid',args,1),receipt=await f.client.getTransactionReceipt({hash});
  assert.equal(await balance(seller)+receipt.gasUsed*receipt.effectiveGasPrice,before+q.sellerProceeds);assert.equal(await balance(buyer),beforeBuyer,'Acceptance spends escrow, not the buyer wallet');assert.equal(await f.read(f.collection,nft,'ownerOf',[2n]),buyer);assert.equal(await f.read(f.market,market,'bidCount'),0n);assert.equal((await f.read(f.market,market,'listings',[2n]))[0],0n);assert.equal(await f.read(f.market,market,'bidderTokenBid',[buyer,2n]),0n);await assert.rejects(f.write(f.market,market,'acceptBid',args,1));await assert.rejects(f.write(f.market,market,'cancelBid',[id],2));await liabilities();
 });
 await t.test('cancellation credits the entire deposit without trading fees; exit does not require an Agent ID',async()=>{
  const price=parseEther('0.003'),q=marketQuote(price),id=await place(3n,3,price),bidder=f.accounts[3].address,fees=await f.read(f.market,market,'feesCollected');
  await assert.rejects(f.write(f.market,market,'cancelBid',[id],2));await f.write(AGENT_ID_REGISTRY,f.m.MockIdentity.abi,'set',[bidder,0n]);await f.write(f.market,market,'cancelBid',[id],3);assert.equal(await f.read(f.market,market,'refunds',[bidder]),q.buyerTotal);assert.equal(await f.read(f.market,market,'feesCollected'),fees);assert.equal(await f.read(f.market,market,'bidderBidCount',[bidder]),0n);await assert.rejects(f.write(f.market,market,'withdrawRefund',[q.buyerTotal+1n,bidder],3));await assert.rejects(f.write(f.market,market,'withdrawRefund',[q.buyerTotal,buyer],2));
  const before=await balance(bidder),hash=await f.write(f.market,market,'withdrawRefund',[q.buyerTotal,bidder],3),receipt=await f.client.getTransactionReceipt({hash});assert.equal(await balance(bidder)+receipt.gasUsed*receipt.effectiveGasPrice,before+q.buyerTotal);assert.equal(await f.read(f.market,market,'refunds',[bidder]),0n);await assert.rejects(f.write(f.market,market,'withdrawRefund',[q.buyerTotal,bidder],3));await f.write(AGENT_ID_REGISTRY,f.m.MockIdentity.abi,'set',[bidder,1n]);await liabilities();
 });
 await t.test('expired and owner-changed bids cannot settle; anyone can safely prune them into the bidder refund balance',async()=>{
  const price=parseEther('0.001'),q=marketQuote(price),id=await place(4n,4,price,(await f.client.getBlock()).timestamp+10n);await assert.rejects(f.write(f.market,market,'pruneBid',[id]));await f.provider.request({method:'evm_increaseTime',params:[11]});await f.provider.request({method:'evm_mine',params:[]});assert.equal(await f.read(f.market,market,'bidAvailable',[id]),false);await approve(4n);await assert.rejects(f.write(f.market,market,'acceptBid',[id,f.accounts[4].address,price,await f.deadline()],1));await f.write(f.market,market,'pruneBid',[id],5);assert.equal(await f.read(f.market,market,'refunds',[f.accounts[4].address]),q.buyerTotal);
  const moved=await place(5n,5,price);await f.write(f.collection,nft,'transferFrom',[seller,buyer,5n],1);await approve(5n,2);assert.equal(await f.read(f.market,market,'bidAvailable',[moved]),false);await assert.rejects(f.write(f.market,market,'acceptBid',[moved,f.accounts[5].address,price,await f.deadline()],2));await f.write(f.market,market,'pruneBid',[moved],6);assert.equal(await f.read(f.market,market,'refunds',[f.accounts[5].address]),q.buyerTotal);await liabilities();
 });
 await t.test('failed NFT delivery, fee payout and refund receivers roll back without losing escrow or ownership',async()=>{
  const smart=await f.deploy(f.m.MockAgent),price=parseEther('0.001'),q=marketQuote(price),exec=async(to:any,abi:any,name:string,args:any[],value=0n)=>f.write(smart,f.m.MockAgent.abi,'execute',[to,encodeFunctionData({abi,functionName:name,args})],0,value);
  await f.write(AGENT_ID_REGISTRY,f.m.MockIdentity.abi,'set',[smart,1n]);await f.write(smart,f.m.MockAgent.abi,'configure',[false,true]);await exec(f.market,market,'placeBid',[6n,price,await f.deadline(),seller],q.buyerTotal);const id=await f.read(f.market,market,'bidNonce');await approve(6n);await assert.rejects(f.write(f.market,market,'acceptBid',[id,smart,price,await f.deadline()],1));assert.equal(await f.read(f.market,market,'bidAvailable',[id]),true);assert.equal(await f.read(f.collection,nft,'ownerOf',[6n]),seller);await liabilities();
  await exec(f.market,market,'cancelBid',[id]);await f.write(smart,f.m.MockAgent.abi,'configure',[true,false]);await assert.rejects(exec(f.market,market,'withdrawRefund',[q.buyerTotal,smart]));assert.equal(await f.read(f.market,market,'refunds',[smart]),q.buyerTotal);const recipient=f.accounts[7].address,before=await balance(recipient);await exec(f.market,market,'withdrawRefund',[q.buyerTotal,recipient]);assert.equal(await balance(recipient),before+q.buyerTotal);await liabilities();
  const alt=await f.deploy(f.art('NibMarketplace'),[f.collection,AGENT_ID_REGISTRY,smart]);await f.write(f.collection,nft,'approve',[alt,7n],1);await f.write(alt,market,'list',[7n,price,await f.deadline()],1);const l=await f.read(alt,market,'listings',[7n]);await assert.rejects(f.write(alt,market,'buy',[7n,l[0],price,seller,await f.deadline()],2,q.buyerTotal));assert.equal(await f.read(f.collection,nft,'ownerOf',[7n]),seller);assert.equal(await f.read(alt,market,'available',[7n]),true);assert.equal(await f.read(alt,market,'feesCollected'),0n);assert.equal(await balance(alt),0n);
 });
 }finally{await f.close();}
});
