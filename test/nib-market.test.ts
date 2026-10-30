import {test} from 'node:test';import assert from 'node:assert/strict';import ganache from 'ganache';import fs from 'node:fs';
import {createWalletClient,createPublicClient,http,parseEther,formatUnits} from 'viem';import {privateKeyToAccount} from 'viem/accounts';
import {bidTerms,acceptQuote,depth,sortBids,isLiveBid,nibMarketState,nibMarketAction,nibMarketRoute,clearNibMarketCache,NibMarketError,NIB_MARKET_ACTIONS,type Bid} from '../lib/nib-market';
import {handle} from '../lib/api';import {databaseFixture} from './helpers/database';
const art=(n:string)=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json','utf8'));
const E=(v:string|number)=>BigInt(Math.round(Number(v)*1e6))*10n**12n;
const TREASURY='0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d';
const policy=(active:boolean)=>({active,version:2 as const,formula:'5*owned' as const,scope:'earned_tap_only' as const});
const bid=(id:number,price:bigint,nib:bigint,expiresAt=0n):Bid=>{const bnb=nib*price/10n**18n;return {id:BigInt(id),bidder:'0x'+'1'.repeat(40),expiresAt,nibRemaining:nib,bnbRemaining:bnb,feeRemaining:bnb*200n/10000n,priceE18:price};};
const status=async(p:Promise<any>)=>{try{await p;return 200;}catch(e:any){return e instanceof NibMarketError||typeof e?.status==='number'?e.status:-1;}};

test('bidTerms: any two of nib/bnb/price, 2% buyer fee, minimums and bad input',()=>{
 const a=bidTerms({bnb:'0.01',price:'0.00001'});assert.equal(a.nib,E(1000));assert.equal(a.bnb,E('0.01'));assert.equal(a.buyerFee,E('0.0002'));assert.equal(a.deposit,E('0.0102'));assert.equal(a.priceE18,10n**13n);
 const b=bidTerms({nib:'1000',price:'0.00001'});assert.deepEqual([b.nib,b.bnb,b.deposit],[a.nib,a.bnb,a.deposit]);
 const c=bidTerms({nib:'1000',bnb:'0.01'});assert.equal(c.priceE18,a.priceE18);
 for(const bad of [{},{nib:'1'},{nib:'1',bnb:'1',price:'1'},{bnb:'0.0001',price:'0.00001'},{nib:'1e3',price:'1'},{nib:'-1',price:'1'},{bnb:'1',price:'0'},{nib:'2000000000',price:'0.001'},{bnb:'0.01',price:'0.00000000000001'}]){
  assert.throws(()=>bidTerms(bad),(e:any)=>e instanceof NibMarketError&&e.status===400,JSON.stringify(bad));
 }
});
test('order book: price descending, older first on ties, cumulative depth, expiry',()=>{
 const bids=[bid(1,E('0.001'),E(100)),bid(2,E('0.003'),E(50)),bid(3,E('0.002'),E(10)),bid(4,E('0.003'),E(25))];
 assert.deepEqual(sortBids(bids).map(b=>Number(b.id)),[2,4,3,1]);
 const lv=depth(bids);assert.equal(lv.length,3);assert.equal(lv[0].bids,2);assert.equal(lv[0].nib,E(75));assert.equal(lv[0].cumNib,E(75));assert.equal(lv[2].cumNib,E(185));assert.equal(lv[2].cumBnb,lv.reduce((s,l)=>s+l.bnb,0n));
 assert.equal(isLiveBid(bid(5,1n,1n,100n),99),true);assert.equal(isLiveBid(bid(5,1n,1n,100n),100),false);assert.equal(isLiveBid(bid(5,1n,1n,0n),1e12),true);
});
test('acceptQuote mirrors the contract: floor pro-rata, final fill takes the exact remainder, seller pays 2%',()=>{
 const b=bid(1,E('0.00001'),E(1001));// odd amounts force rounding
 const full=acceptQuote(b,b.nibRemaining);assert.equal(full.bnb,b.bnbRemaining);assert.equal(full.buyerFee,b.feeRemaining);assert.equal(full.proceeds,full.bnb-full.bnb*200n/10000n);
 let rest={...b},bnbPaid=0n,feePaid=0n;
 for(const part of [E(333),E('100.5'),E(567)]){if(part>rest.nibRemaining)break;const q=acceptQuote(rest,part);bnbPaid+=q.bnb;feePaid+=q.buyerFee;rest={...rest,nibRemaining:rest.nibRemaining-part,bnbRemaining:rest.bnbRemaining-q.bnb,feeRemaining:rest.feeRemaining-q.buyerFee};}
 const last=acceptQuote(rest,rest.nibRemaining);bnbPaid+=last.bnb;feePaid+=last.buyerFee;assert.equal(bnbPaid,b.bnbRemaining,'escrowed BNB is paid out exactly');assert.equal(feePaid,b.feeRemaining,'pre-paid fee is used exactly');
 assert.throws(()=>acceptQuote(b,0n));assert.throws(()=>acceptQuote(b,b.nibRemaining+1n));
});
test('not deployed: unset or code-less market address gives a graceful state, actions say so, cancel/state never throw',async()=>{
 clearNibMarketCache();
 const unset:any={DB:null,_utilityPolicy:policy(false)};const s=await nibMarketState(unset,null,Date.now());assert.equal(s.deployed,false);assert.match(String(s.message),/not deployed|not live|deploy/i);
 const r=await nibMarketRoute(new Request('https://x.test/api/nib-market'),unset,null,Date.now());assert.equal(r?.status,200);assert.equal((await r!.json()).deployed,false);
 const a={wallet:'0x'+'2'.repeat(40),connected:true};
 for(const act of ['nib-bid-place','nib-bid-accept','nib-bid-cancel'])assert.ok([409,503,400,404].includes(await status(nibMarketAction(unset,a,act,{bnb:'0.01',price:'0.00001',id:'1'},Date.now()))),act);
 assert.equal(await status(nibMarketAction(unset,a,'bogus',{},Date.now())),400);
 assert.deepEqual(NIB_MARKET_ACTIONS,['nib-market-state','nib-bid-place','nib-bid-cancel','nib-bid-accept']);
 assert.equal((await nibMarketRoute(new Request('https://x.test/api/other'),unset,null,Date.now())),null);
});

test('end to end on a local chain: place, rank, partial and full accept, cancel, fills index, gating, public route',async()=>{
 const server=ganache.server({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:6,defaultBalance:1000}});await server.listen(0,'127.0.0.1');
 try{
  const rpc='http://127.0.0.1:'+(server.address() as any).port,cfg:any={id:56,name:'Local BNB',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:{default:{http:[rpc]}}};
  const accts=Object.values(server.provider.getInitialAccounts()).map((a:any)=>privateKeyToAccount(a.secretKey));
  const client=createPublicClient({chain:cfg,transport:http(rpc)}) as any,wc=(i:number)=>createWalletClient({account:accts[i],chain:cfg,transport:http(rpc)});
  const [dep,alice,bob,seller,treasuryAcct]=[0,1,2,3,4];
  const deploy=async(a:any,args:any[])=>{const h=await wc(dep).deployContract({abi:a.abi,bytecode:a.bytecode,args});return (await client.waitForTransactionReceipt({hash:h})).contractAddress as `0x${string}`;};
  const airdrop=await deploy(art('NibAirdrop'),[accts[dep].address,accts[dep].address]);
  const token=await deploy(art('NibToken'),[airdrop,accts[seller].address]);// the seller wallet receives the 200M treasury allocation
  const market=await deploy(art('NibBidMarket'),[token,accts[treasuryAcct].address]);
  const send=async(i:number,t:any)=>{const h=await wc(i).sendTransaction({to:t.to,data:t.data,value:BigInt(t.value||0)} as any);const r=await client.waitForTransactionReceipt({hash:h});assert.equal(r.status,'success');return r;};
  const env:any={DB:null,_utilityPolicy:policy(false),BSC_RPC_URL:rpc,NFT_LOGS_RPC_URL:rpc,NIB_BID_MARKET:market,NIB_TOKEN:token,NIB_MARKET_FROM_BLOCK:'0'};
  const who=(i:number)=>({wallet:accts[i].address.toLowerCase(),connected:true});
  const act=async(i:number,name:string,payload:any)=>{clearNibMarketCache();return nibMarketAction(env,who(i),name,payload,Date.now());};
  // wrong token in env => ignored gracefully
  clearNibMarketCache();assert.equal((await nibMarketState({...env,NIB_TOKEN:'0x'+'3'.repeat(40)},null,Date.now())).deployed,false);
  const empty=await nibMarketState(env,null,Date.now());assert.equal(empty.deployed,true);assert.equal(empty.bestBid,null);assert.equal(empty.openBids,0);
  // place three bids through the signed action's own transaction: 0.001 BNB/NIB x1000, 0.003 x500, 0.002 x 100
  const p1=await act(alice,'nib-bid-place',{nib:'1000',price:'0.001'});assert.match(p1.nibMarket.baw,/^baw contract-call preview --binanceChainId 56 --from 0x[0-9a-f]{40} --to 0x[0-9a-fA-F]{40} --value \d+ --inputData 0x[0-9a-f]+ --json$/);assert.equal(p1.nibMarket.summary.totalEscrowedBnb,'1.02');
  await send(alice,p1.nibMarket.transaction);
  await send(bob,(await act(bob,'nib-bid-place',{nib:'500',price:'0.003',expiresInHours:2})).nibMarket.transaction);
  await send(bob,(await act(bob,'nib-bid-place',{bnb:'0.2',price:'0.002'})).nibMarket.transaction);
  clearNibMarketCache();const st=await nibMarketState(env,accts[bob].address,Date.now());
  assert.equal(st.openBids,3);assert.equal(st.bestBid.id,'2');assert.equal(st.bestBid.priceBnb,'0.003');assert.deepEqual(st.bids.map((b:any)=>b.id),['2','3','1']);assert.equal(st.levels.length,3);assert.equal(st.levels[2].cumulativeNib,'1600');
  assert.equal(st.user.myBids.length,2);assert.equal(st.depth.totalNib,'1600');
  // placing with a bad amount or without funds fails with a clean status
  assert.equal(await status(act(alice,'nib-bid-place',{bnb:'0.0001',price:'0.001'})),400);assert.equal(await status(act(5,'nib-bid-place',{bnb:'5000',price:'0.001'})),409);
  // accept: seller has no allowance => approve step then accept step; a self-accept finds nothing to take
  assert.equal(await status(act(bob,'nib-bid-accept',{id:'2'})),404);
  const acc=await act(seller,'nib-bid-accept',{id:'top',nib:'200'});assert.equal(acc.nibMarket.steps.length,2);assert.equal(acc.nibMarket.summary.bidId,'2');assert.equal(acc.nibMarket.summary.partialFill,true);
  assert.equal(acc.nibMarket.summary.grossBnb,'0.6');assert.equal(acc.nibMarket.summary.youReceiveBnb,'0.588');
  assert.equal(await status(act(seller,'nib-bid-accept',{id:'top',nib:'200',minPrice:'0.004'})),409);
  const before=await client.getBalance({address:accts[seller].address});
  await send(seller,acc.nibMarket.steps[0].transaction);const r2=await send(seller,acc.nibMarket.steps[1].transaction);
  const gain=(await client.getBalance({address:accts[seller].address}))-before;assert.ok(gain>E('0.587')&&gain<E('0.589'),'seller receives 98% of 0.6 BNB minus gas, got '+formatUnits(gain,18));void r2;
  // "max" now caps to the remaining 300 NIB of the top bid and needs no new approval beyond the exact first one
  const acc2=await act(seller,'nib-bid-accept',{id:'top',nib:'max'});assert.equal(acc2.nibMarket.summary.selling,'300 NIB');assert.equal(acc2.nibMarket.summary.cappedToBidSize,false);assert.equal((await act(seller,'nib-bid-accept',{id:'top',nib:'1000'})).nibMarket.summary.cappedToBidSize,true);assert.equal(acc2.nibMarket.steps.length,2,'allowance is only for 200 NIB, so a new approval is prepared');
  await send(seller,acc2.nibMarket.steps[0].transaction);await send(seller,acc2.nibMarket.steps[1].transaction);
  // fills are indexed from BidAccepted events and the book moved on
  clearNibMarketCache();const st2=await nibMarketState(env,null,Date.now());assert.equal(st2.fills.items.length,2);assert.equal(st2.fills.items[0].priceBnb,'0.003');assert.equal(st2.stats.fills,'2');assert.equal(st2.bestBid.id,'3');assert.equal(st2.stats.volumeNib,'500');
  // cancel is only for the owner and refunds everything left
  assert.equal(await status(act(bob,'nib-bid-cancel',{id:'1'})),403);
  const can=await act(alice,'nib-bid-cancel',{id:'1'});assert.equal(can.nibMarket.summary.refundBnb,'1.02');await send(alice,can.nibMarket.transaction);
  assert.equal(await status(act(alice,'nib-bid-cancel',{id:'1'})),404);
  // gating: when game access is required place/accept are blocked for a wallet with no access, but cancel and state stay open
  const gated:any={...env,_utilityPolicy:policy(true),NFT_COLLECTION:undefined};
  assert.notEqual(await status(nibMarketAction(gated,who(alice),'nib-bid-place',{nib:'1000',price:'0.001'},Date.now())),200);
  assert.notEqual(await status(nibMarketAction(gated,who(seller),'nib-bid-accept',{id:'top'},Date.now())),200);
  clearNibMarketCache();const open=await nibMarketAction(gated,who(bob),'nib-market-state',{},Date.now());assert.equal(open.nibMarket.deployed,true);
  assert.equal(await status(nibMarketAction(gated,who(bob),'nib-bid-cancel',{id:'3'},Date.now())),200);
  // public GET route
  clearNibMarketCache();const db=await databaseFixture('sqlite');const route=await handle(new Request('https://game.test/api/nib-market'),{...env,DB:db});await db.close();const body:any=await route.json();assert.equal(route.status,200,JSON.stringify(body));assert.equal(body.deployed,true);assert.equal(body.fees.buyerBps,200);
 }finally{await server.close();}
});
