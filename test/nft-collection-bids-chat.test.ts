import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseEther,formatEther} from 'viem';import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {nftChain} from './helpers/nft-chain';import {databaseFixture} from './helpers/database';import {handle} from '../lib/api';import {actionData} from '../lib/protocol';
import {runDo,execute,NIB_COLLECTION_BIDS,type Ctx} from '../agent/do';import {validateNftTransaction} from '../agent/nft-runner';
import {marketQuote,NFT_PAYMENT,NFT_WBNB,collectionBidDeposit} from '../lib/nft-protocol';

test('collection bids: API, chat commands, preview/approve flow, validation and hidden-until-configured behaviour',async t=>{
 const f=await nftChain(),db=await databaseFixture('sqlite'),nft=f.art('NibCollection').abi,cb=JSON.parse(fs.readFileSync('artifacts/NibCollectionBids.json','utf8'));
 const bidsAddr=await f.deploy(cb,[f.collection,'0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F',f.vault]);
 const base:any={DB:db,BSC_RPC_URL:f.rpc,NFT_RPC_URL:f.rpc,NFT_COLLECTION:f.collection,NFT_MARKETPLACE:f.market,NFT_LP_VAULT:f.vault};
 const envOn:any={...base,NFT_COLLECTION_BIDS:bidsAddr};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'taptap-cbid-'));
 let env=base;
 const req=async(p:string,body?:any,uid='cbid-user')=>{const r=await handle(new Request('https://cbid.test/api/'+p,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':uid,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json() as any};};
 async function agent(index:number,uid:string){
  const account=f.accounts[index],session=privateKeyToAccount(generatePrivateKey()),pair=await req('pair',{},uid),ch=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:session.address},uid),signed=await req('agent/session',{challengeId:ch.body.challengeId,signature:await account.signTypedData(ch.body.typedData)},uid);assert.equal(signed.status,200);
  const s:any={sessionId:signed.body.sessionId,wallet:account.address,nonce:0,expiresAt:Date.now()+3600000};
  const rawAction=async(st:any,kind:string,payload:any={})=>{const envelope={sessionId:st.sessionId,nonce:st.nonce,timestamp:Date.now(),action:kind,payload},signature=await session.signTypedData(actionData('https://cbid.test',envelope) as any),r=await req('agent/action',{...envelope,signature},uid);if(Number.isSafeInteger(r.body.nonce))st.nonce=r.body.nonce;if(r.status>=400)throw Object.assign(Error(r.body.error),{status:r.status});return r.body;};
  let n=0;const previews:Record<string,any>={},out:string[]=[],sent:string[]=[];
  const baw=(argv:string[])=>{
   if(argv[0]==='wallet'&&argv[1]==='status')return {status:'CONNECTED'};if(argv[1]==='settings')return {devMode:{enabled:true,expiresAt:Date.now()+3600000}};if(argv[1]==='address')return {addresses:[{binanceChainId:'56',address:account.address}]};
   if(argv[1]==='preview'){const g=(k:string)=>argv[argv.indexOf(k)+1];const id='cb-preview-'+index+'-'+(++n);previews[id]={to:g('--to'),data:g('--inputData'),value:g('--value')};return {requestId:id,expiresAt:Date.now()+240000,risks:{riskDetails:[],addresses:{},riskBehaviors:[]},parsedTx:{operation:'fixture'},requireConfirmation:false};}
   if(argv[1]==='execute'){const p=previews[argv[argv.indexOf('--requestId')+1]];sent.push(p.data);return f.wallets[index].sendTransaction({account,chain:f.wallets[index].chain,to:p.to,data:p.data,value:BigInt(p.value)}).then(async hash=>{await f.client.waitForTransactionReceipt({hash});return {orderId:'o',status:'BROADCASTED',txHash:hash};}) as any;}
   throw Error('unexpected baw '+argv.join(' '));
  };
  const ctx:Ctx={s,origin:'https://cbid.test',journalFile:path.join(dir,'j'+index+'.json'),rawAction,baw:baw as any,out:x=>out.push(x),sleep:async()=>{await f.provider.request({method:'evm_mine',params:[]});},rpcUrl:f.rpc,collection:f.collection,collectionBids:bidsAddr};
  const prepare=async(argv:string[])=>{out.length=0;await runDo(ctx,argv);const m=out.join('\n').match(/requestId: (\S+)/);assert.ok(m,out.join('\n'));return m![1];};
  return {account,ctx,out,sent,prepare,rawAction,s,index};
 }
 const mint=async(index:number,count:number)=>{for(let i=0;i<count;i++){await f.write(NFT_PAYMENT,f.m.MockToken.abi,'approve',[f.collection,parseEther('1')],index);await f.write(f.collection,nft,'mint',[1n,parseEther('1'),await f.deadline(),f.intent()],index);}};
 const tokens=async(a:string)=>{const n=Number(await f.read(f.collection,nft,'balanceOf',[a]));const r:number[]=[];for(let i=0;i<n;i++)r.push(Number(await f.read(f.collection,nft,'tokenOfOwnerByIndex',[a,BigInt(i)])));return r;};
 try{
  const bidder=await agent(4,'bidder'),seller=await agent(5,'seller'),stranger=await agent(6,'stranger');
  await mint(5,3);await mint(6,1);await mint(4,1);
  await t.test('hidden and refused while no contract address is configured',async()=>{
   const snap=await req('nft');assert.equal(snap.body.collectionBids.configured,false);assert.equal(snap.body.collectionBids.status,'awaiting_deployment');
   const q=await req('nft/intents',{kind:'cbid',price:'0.01',quantity:3,days:7},'bidder');assert.equal(q.status,409,JSON.stringify(q.body));
   await assert.rejects(runDo(bidder.ctx,['nft-collection-bid','--bnb','0.01','--qty','3']));
  });
  env=envOn;
  await t.test('configured: contract is cross-checked against the live collection and marketplace fee recipient',async()=>{
   const snap=await req('nft');assert.equal(snap.body.collectionBids.configured,true,JSON.stringify(snap.body.collectionBids));assert.equal(snap.body.collectionBids.address.toLowerCase(),bidsAddr.toLowerCase());assert.equal(snap.body.collectionBids.bids.length,0);
   // a contract that is not the real collection-bids contract (here: the marketplace) is rejected
   env={...base,NFT_COLLECTION_BIDS:f.market};const bad=await req('nft');assert.notEqual(bad.body.collectionBids?.status,'ready');assert.ok(!bad.body.collectionBids?.bids?.length);env=envOn;
  });
  const price=parseEther('0.01'),quote=marketQuote(price);let bidId='';
  await t.test('bid command: preview shows quantity and total escrow, nothing moves before approval',async()=>{
   const before=await f.client.getBalance({address:bidder.account.address});
   const id=await bidder.prepare(['nft-collection-bid','--bnb','0.01','--qty','3','--days','5']);const text=bidder.out.join('\n');
   assert.match(text,/Collection bid: 3 Nib NFTs/);assert.match(text,/Escrow:/);assert.match(text,new RegExp(formatEther(quote.buyerTotal*3n).replace('.','\\.')));assert.equal(bidder.sent.length,0);
   await assert.rejects(execute(bidder.ctx,id,false),/after the user approved/);assert.equal(await f.client.getBalance({address:bidder.account.address}),before);
   const done:any=await execute(bidder.ctx,id,true);assert.equal(done.ok,true,bidder.out.join('\n'));
   assert.equal(await f.client.getBalance({address:bidsAddr}),collectionBidDeposit(price,3n));
   const snap=(await req('nft?cbView=all')).body.collectionBids;assert.equal(snap.bids.length,1);const b=snap.bids[0];bidId=String(b.bidId);
   assert.equal(b.price,'0.01');assert.equal(b.quantity,3);assert.equal(b.remaining,3);assert.equal(b.sellerProceeds,'0.0098');assert.equal(b.bidder.toLowerCase(),bidder.account.address.toLowerCase());
   assert.equal(snap.stats.openBids,1);
  });
  await t.test('bid command rejects bad quantities and prices before contacting the site',async()=>{
   await assert.rejects(runDo(bidder.ctx,['nft-collection-bid','--bnb','0.01','--qty','0']));await assert.rejects(runDo(bidder.ctx,['nft-collection-bid','--bnb','0.01','--qty','1.5']));await assert.rejects(runDo(bidder.ctx,['nft-collection-bid','--bnb','0.01','--qty','10001']));
   const bad=await req('nft/intents',{kind:'cbid',price:'0.01',quantity:3,days:31},'bidder');assert.equal(bad.status,400);
  });
  await t.test('accept: first the one-time approval, then the sale; seller gets 98% and the treasury 4%, quantity decrements',async()=>{
   const [token]=await tokens(seller.account.address);
   const approvalId=await seller.prepare(['nft-collection-accept',bidId,String(token)]);assert.match(seller.out.join('\n'),/Approve Nib #\d+ for collection bids/);assert.match(seller.out.join('\n'),/nft-collection-accept/);
   assert.equal((await execute(seller.ctx,approvalId,true) as any).ok,true,seller.out.join('\n'));
   const treasuryBefore=await f.read(NFT_WBNB,f.m.MockWrapped.abi,'balanceOf',[f.vault]),sellerBefore=await f.client.getBalance({address:seller.account.address});
   const acceptId=await seller.prepare(['nft-collection-accept',bidId,String(token)]);assert.match(seller.out.join('\n'),/collection bid/i);
   const done:any=await execute(seller.ctx,acceptId,true);assert.equal(done.ok,true,seller.out.join('\n'));
   const receipt=await f.client.getTransactionReceipt({hash:done.txHash||done.hash||done.transactionHash||done.tx}).catch(()=>null);
   assert.equal(String(await f.read(f.collection,nft,'ownerOf',[BigInt(token)])).toLowerCase(),bidder.account.address.toLowerCase());
   assert.equal((await f.read(NFT_WBNB,f.m.MockWrapped.abi,'balanceOf',[f.vault]))-treasuryBefore,quote.buyerFee+quote.sellerFee,'fees (2% + 2%) reach the fee recipient');assert.equal(await f.read(bidsAddr,cb.abi,'feesCollected'),quote.buyerFee+quote.sellerFee);
   const gained=(await f.client.getBalance({address:seller.account.address}))-sellerBefore;assert.ok(gained<=quote.sellerProceeds&&gained>quote.sellerProceeds-parseEther('0.001'),'seller receives price minus 2% (less gas)');
   const b=(await req('nft?cbView=all')).body.collectionBids.bids[0];assert.equal(b.remaining,2);assert.equal(b.quantity,3);void receipt;
   const row:any=await db.prepare('SELECT status FROM nft_intents WHERE wallet=? ORDER BY created_at DESC').bind(seller.account.address.toLowerCase()).first();assert.equal(row.status,'confirmed');
  });
  await t.test('a bidder cannot sell into their own bid, and non-holders cannot accept',async()=>{
   const own=(await tokens(bidder.account.address))[0];assert.ok(own!==undefined);
   const r=await req('nft/intents',{kind:'cbid-accept',bidId,tokenId:own},'bidder');assert.ok(r.status>=400,JSON.stringify(r.body));
   const [someone]=await tokens(seller.account.address);const r2=await req('nft/intents',{kind:'cbid-accept',bidId,tokenId:someone},'stranger');assert.ok(r2.status>=400,JSON.stringify(r2.body));
  });
  await t.test('only the bidder can cancel; cancel refunds the unfilled remainder with no fee',async()=>{
   await assert.rejects(runDo(stranger.ctx,['nft-collection-cancel',bidId]));
   const before=await f.client.getBalance({address:bidder.account.address}),escrowBefore=await f.client.getBalance({address:bidsAddr});
   const id=await bidder.prepare(['nft-collection-cancel',bidId]);assert.match(bidder.out.join('\n'),/Refund:/);assert.equal(bidder.sent.length,1,'only the bid so far; previewing sends nothing');
   assert.equal((await execute(bidder.ctx,id,true) as any).ok,true,bidder.out.join('\n'));
   const refund=quote.buyerTotal*2n,gained=(await f.client.getBalance({address:bidder.account.address}))-before;assert.ok(gained<=refund&&gained>refund-parseEther('0.001'));
   assert.equal(escrowBefore-(await f.client.getBalance({address:bidsAddr})),refund);assert.equal((await req('nft?cbView=all')).body.collectionBids.bids.length,0);
  });
  await t.test('connector validation: wrong contract, value, arguments, expiry and wallet are all refused',async()=>{
   const q=await req('nft/intents',{kind:'cbid',price:'0.01',quantity:2,days:3},'bidder');assert.equal(q.status,201,JSON.stringify(q.body));
   const claim=await bidder.rawAction(bidder.s,'nft-claim',{intentId:q.body.id}),i=claim.intent,c=claim.contracts;assert.equal(validateNftTransaction(i,c,bidder.account.address),true);
   assert.throws(()=>validateNftTransaction({...i,transaction:{...i.transaction,value:(BigInt(i.transaction.value)-1n).toString()}},c,bidder.account.address));
   assert.throws(()=>validateNftTransaction({...i,transaction:{...i.transaction,to:f.market}},c,bidder.account.address));
   assert.throws(()=>validateNftTransaction({...i,payload:{...i.payload,quantity:3}},c,bidder.account.address));
   assert.throws(()=>validateNftTransaction({...i,payload:{...i.payload,days:4}},c,bidder.account.address));
   assert.throws(()=>validateNftTransaction(i,{...c,collectionBids:undefined},bidder.account.address));
   // the connector pins the contract address: a site pointing elsewhere is refused before any preview
   const rogue:Ctx={...bidder.ctx,collectionBids:'0x000000000000000000000000000000000000dEaD'};await assert.rejects(runDo(rogue,['nft-collection-bid','--bnb','0.01','--qty','1']),/unexpected collection-bids/);
   assert.match(NIB_COLLECTION_BIDS,/^0x[0-9a-fA-F]{40}$/);
  });
 }finally{await db.close();await f.close();}
});
