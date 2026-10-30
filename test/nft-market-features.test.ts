import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseEther} from 'viem';
import {nftChain} from './helpers/nft-chain';
import {databaseFixture} from './helpers/database';
import {handle} from '../lib/api';
import {nftTraits} from '../lib/nft-art';
import {marketQuote,NFT_PAYMENT} from '../lib/nft-protocol';
import {MARKET_SORTS,TRAIT_KEYS,nftRarity,parseSort,rarityBoard,recentSales,resetSalesCache,sortListings,traitFrequencies,SALES_TTL_MS} from '../lib/nft-market';

test('rarity is deterministic, derived from minted trait frequency and ranks ties together',()=>{
 assert.equal(nftRarity(1,0),null);assert.equal(nftRarity(11,10),null,'Unminted designs have no rank');assert.equal(nftRarity(0,10),null);
 for(const minted of [1,10,194,2500]){
  const board=rarityBoard(minted);assert.equal(board.scores.length,minted);
  for(const key of TRAIT_KEYS)assert.equal([...board.counts[key].values()].reduce((a,b)=>a+b,0),minted,'Every minted Nib is counted once per trait');
  // A trait value that appears less often must score higher than a common one.
  const ranked=Array.from({length:minted},(_,i)=>nftRarity(i+1,minted)!);assert.equal(Math.min(...ranked.map(r=>r.rank)),1);assert.ok(ranked.every(r=>r.of===minted&&r.rank>=1&&r.rank<=minted));
  for(const r of ranked)assert.equal(r.tied,ranked.filter(o=>o.rank===r.rank).length);
  assert.deepEqual(ranked.map(r=>r.score),Array.from({length:minted},(_,i)=>nftRarity(i+1,minted)!.score),'Pure function of the minted supply');
 }
 const n=194,board=rarityBoard(n),score=(id:number)=>TRAIT_KEYS.reduce((sum,k)=>sum+n/board.counts[k].get((nftTraits(id) as any)[k])!,0);
 for(const id of [1,7,100,194])assert.ok(Math.abs(nftRarity(id,n)!.score-score(id))<0.006,'score = sum of supply / trait count');
 const order=Array.from({length:n},(_,i)=>i+1).sort((a,b)=>score(b)-score(a)||a-b);
 for(let i=1;i<order.length;i++)assert.ok(nftRarity(order[i-1],n)!.rank<=nftRarity(order[i],n)!.rank,'Higher score never ranks lower');
 const freq=traitFrequencies(n);assert.equal(freq.length,6);for(const t of freq){assert.equal(t.values.reduce((a,v)=>a+v.count,0),n);assert.deepEqual(t.values.map(v=>v.count),[...t.values.map(v=>v.count)].sort((a,b)=>a-b),'Rarest value first');}
 // Fully minted supply is perfectly balanced, so nothing is rarer than anything else.
 const full=rarityBoard(10000);assert.equal(full.uniform,true);assert.equal(nftRarity(1,10000)!.rank,1);assert.equal(nftRarity(1,10000)!.tied,10000);assert.equal(nftRarity(1,10000)!.tier,'Common');
});

test('listing sorts are exact, stable and fall back to newest',()=>{
 assert.equal(parseSort('price_desc'),'price_desc');assert.equal(parseSort('bogus'),'newest');assert.equal(parseSort(null),'newest');assert.deepEqual(MARKET_SORTS.map(s=>s.id),['newest','price_asc','price_desc','rarity','token']);
 const items=[{tokenId:5,listingId:'2',priceRaw:'300',rarity:{rank:3}},{tokenId:1,listingId:'9',priceRaw:'100',rarity:{rank:3}},{tokenId:8,listingId:'4',priceRaw:'100',rarity:{rank:1}},{tokenId:2,listingId:'10',priceRaw:String(10n**30n),rarity:null}];
 const ids=(sort:any)=>sortListings(items,sort).map(v=>v.tokenId);
 assert.deepEqual(ids('price_asc'),[1,8,5,2]);assert.deepEqual(ids('price_desc'),[2,5,1,8]);assert.deepEqual(ids('newest'),[2,1,8,5]);assert.deepEqual(ids('token'),[1,2,5,8]);assert.deepEqual(ids('rarity'),[8,1,5,2]);
 assert.equal(items[0].tokenId,5,'Input is not mutated');
});

test('API sorts listings, ranks rarity, indexes recent sales and keeps bids working',async t=>{
 const f=await nftChain(),nft=f.art('NibCollection').abi,market=f.art('NibMarketplace').abi,db=await databaseFixture('sqlite');
 const env:any={DB:db,BSC_RPC_URL:f.rpc,NFT_RPC_URL:f.rpc,NFT_LOGS_CHUNK:'3',NFT_MARKETPLACE_FROM_BLOCK:'0',NFT_COLLECTION:f.collection,NFT_MARKETPLACE:f.market,NFT_LP_VAULT:f.vault};
 let seq=0;const api=async(query='')=>{const r=await handle(new Request('https://nft.test/api/nft'+(query?query+'&':'?')+'_='+(++seq)),env);assert.equal(r.status,200);return await r.json() as any;};
 const [seller,buyer,bidder]=[f.accounts[1].address,f.accounts[2].address,f.accounts[3].address];
 try{
  resetSalesCache();
  for(const who of [1,2,3])await f.write(NFT_PAYMENT,f.m.MockToken.abi,'approve',[f.collection,parseEther('20')],who);
  await f.write(f.collection,nft,'mint',[8n,parseEther('7'),await f.deadline(),f.intent()],1);await f.write(f.collection,nft,'mint',[2n,parseEther('1'),await f.deadline(),f.intent()],2);
  const list=async(id:bigint,price:string)=>{await f.write(f.collection,nft,'approve',[f.market,id],1);await f.write(f.market,market,'list',[id,parseEther(price),await f.deadline()],1);};
  await t.test('sorting params order the full listing set, not only the first page',async()=>{
   await list(1n,'3');await list(2n,'1');await list(3n,'2');await list(6n,'2');
   const base=await api();assert.equal(base.sort,'newest');assert.deepEqual(base.sortOptions.map((s:any)=>s.id),['newest','price_asc','price_desc','rarity','token']);assert.equal(base.marketSlots,4);assert.deepEqual(base.listings.map((l:any)=>l.tokenId),[6,3,2,1]);
   assert.deepEqual((await api('?sort=price_asc')).listings.map((l:any)=>l.tokenId),[2,3,6,1]);assert.deepEqual((await api('?sort=price_desc')).listings.map((l:any)=>l.tokenId),[1,3,6,2]);assert.deepEqual((await api('?sort=token')).listings.map((l:any)=>l.tokenId),[1,2,3,6]);
   const byRarity=await api('?sort=rarity'),ranks=byRarity.listings.map((l:any)=>l.rarity.rank);assert.deepEqual(ranks,[...ranks].sort((a:number,b:number)=>a-b));assert.equal((await api('?sort=nonsense')).sort,'newest');
   const page2=await api('?sort=token&marketPage=1');assert.equal(page2.listings.length,0);assert.equal(page2.marketPage,1);
  });
  await t.test('every minted card carries rank #x of N from trait frequency; unminted designs do not',async()=>{
   const d=await api();assert.equal(d.rarity.minted,10);assert.equal(d.rarity.traits.length,6);assert.match(d.rarity.method,/trait value/);
   const minted=d.gallery.filter((g:any)=>g.id<=10),unminted=d.gallery.filter((g:any)=>g.id>10);assert.equal(minted.length,10);assert.ok(minted.every((g:any)=>g.rarity.of===10&&g.rarity.rank>=1&&g.rarity.score>0));assert.ok(unminted.every((g:any)=>g.rarity===null));
   for(const l of d.listings)assert.deepEqual(l.rarity,nftRarity(l.tokenId,10));
  });
  await t.test('recent sales index Bought and BidAccepted events from the deploy block with chunked logs, newest first',async()=>{
   assert.deepEqual((await api()).recentSales,[],'No sales yet');
   const l=await f.read(f.market,market,'listings',[2n]),price=parseEther('1'),q=marketQuote(price);
   const buyHash=await f.write(f.market,market,'buy',[2n,l[0],price,seller,await f.deadline()],2,q.buyerTotal);
   resetSalesCache();let d=await api();assert.equal(d.recentSales.length,1);assert.equal(d.salesIndex.fromBlock,0);assert.equal(d.salesIndex.complete,true);
   const sale=d.recentSales[0];assert.equal(sale.kind,'buy');assert.equal(sale.tokenId,2);assert.equal(sale.price,'1');assert.equal(sale.priceRaw,price.toString());assert.equal(sale.buyer,buyer.toLowerCase());assert.equal(sale.seller,seller.toLowerCase());assert.equal(sale.transactionHash,buyHash);assert.equal(sale.url,'https://bscscan.com/tx/'+buyHash);assert.ok(sale.timestamp>Date.now()-3600000);assert.equal(sale.rarity.of,10);assert.equal(sale.name,'Nib #00002');
   assert.equal(d.market.completedSales,1);assert.ok(!d.listings.some((x:any)=>x.tokenId===2),'Sold NFT leaves the market');
   // Bid accepted by the owner: second sale type, picked up incrementally after the cache TTL.
   const bidPrice=parseEther('0.5');await f.write(f.market,market,'placeBid',[4n,bidPrice,await f.deadline(),seller],3,marketQuote(bidPrice).buyerTotal);const bidId=await f.read(f.market,market,'bidNonce');
   d=await api();assert.equal(d.bids.length,1,'Bids section still lists the open escrowed bid');assert.equal(d.bids[0].tokenId,4);assert.equal(d.bids[0].bidder,bidder.toLowerCase());assert.equal(d.bids[0].rarity.of,10);assert.equal(d.bids[0].available,true);assert.equal(d.bidSlots,1);
   await f.write(f.collection,nft,'approve',[f.market,4n],1);const acceptHash=await f.write(f.market,market,'acceptBid',[bidId,bidder,bidPrice,await f.deadline()],1);
   const fresh=await recentSales({NFT_RPC_URL:f.rpc,BSC_RPC_URL:f.rpc,NFT_LOGS_CHUNK:'3',NFT_MARKETPLACE_FROM_BLOCK:'0'},f.market,12,Date.now()+SALES_TTL_MS+1);
   assert.deepEqual(fresh.items.map(s=>[s.kind,s.tokenId,s.transactionHash]),[['bid',4,acceptHash],['buy',2,buyHash]],'Newest first, no duplicates from the rescan overlap');
   const accepted=fresh.items[0];assert.equal(accepted.price,'0.5');assert.equal(accepted.buyer,bidder.toLowerCase());assert.equal(accepted.seller,seller.toLowerCase());assert.equal(accepted.bidId,bidId.toString());assert.equal(accepted.listingId,null);
   assert.equal(fresh.items.length,2);assert.equal((await recentSales({NFT_RPC_URL:f.rpc,BSC_RPC_URL:f.rpc,NFT_LOGS_CHUNK:'3',NFT_MARKETPLACE_FROM_BLOCK:'0'},f.market,1)).items.length,1,'limit applies');
   assert.equal((await api('?salesLimit=1')).recentSales.length,1);
  });
  await t.test('log RPC failure never breaks the market snapshot',async()=>{
   resetSalesCache();const result=await recentSales({NFT_LOGS_RPC_URL:'http://127.0.0.1:1',NFT_MARKETPLACE_FROM_BLOCK:'0'},f.market,12,Date.now(),2000);assert.deepEqual(result.items,[]);assert.equal(result.index.complete,false);assert.ok(result.index.error);
   const d=await (async()=>{const r=await handle(new Request('https://nft.test/api/nft?_=fail'),{...env,NFT_LOGS_RPC_URL:'http://127.0.0.1:1'});assert.equal(r.status,200);return await r.json() as any;})();assert.deepEqual(d.recentSales,[]);assert.ok(d.salesIndex.error);assert.ok(d.listings.length>0);
  });
 }finally{resetSalesCache();await db.close();await f.close();}
});
