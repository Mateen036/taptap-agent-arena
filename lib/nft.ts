import {createPublicClient,http,isAddress,formatUnits,keccak256,toHex} from 'viem';
import {bsc} from 'viem/chains';
import {AGENT_ID_REGISTRY} from './protocol';
import {canonical} from './game';
import {nftTraits,nftMetadata,nftSvg} from './nft-art';
import {MARKET_SORTS,parseSort,sortListings,withRarity,traitFrequencies,recentSales} from './nft-market';
import {nftCollectionBidsAbi,nftCollectionBidsAddress,nibVaultV2Address,collectionBidDeposit,NFT_COLLECTION_BID_MAX_QUANTITY,nftQuantity as rawQuantity,nftAbi,nftMarketAbi,nftPaymentAbi,nftVaultAbi,nftConfig,nftV2Abi,nibVaultV2ReadAbi,nftV2Active,resolveNftEnv,NFT_COLLECTION_V1,NFT_PAYMENT,NFT_ROUTER,NFT_NATIVE,NFT_WBNB,NFT_PRICE_FEED,nativeMintBudget,marketQuote,NFT_BUYER_FEE_BPS,NFT_SELLER_FEE_BPS,nftCall,nftPrice as rawPrice,nftTokenId as rawTokenId,type NftTransaction,type NftAddresses} from './nft-protocol';
export type NftEnv={DB:D1Database;BSC_RPC_URL?:string;NFT_RPC_URL?:string;NFT_COLLECTION?:string;NFT_MARKETPLACE?:string;NFT_LP_VAULT?:string;NFT_COLLECTION_BIDS?:string;NIB_VAULT_V2?:string;NFT_COLLECTION_V2?:string;NFT_LEGACY_COLLECTION?:string;NFT_MARKETPLACE_V2?:string;NFT_COLLECTION_BIDS_V2?:string;NFT_FEE_RECIPIENT?:string;NFT_LOGS_RPC_URL?:string;NFT_LOGS_CHUNK?:string;NFT_MARKETPLACE_FROM_BLOCK?:string};
export class NftError extends Error{constructor(public status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new NftError(status,message);};
const nftTokenId=(v:any)=>{try{return rawTokenId(v)}catch(error){return fail(400,(error as Error).message)}};
const nftQuantity=(v:any)=>{try{return rawQuantity(v)}catch(error){return fail(400,(error as Error).message)}};
const nftPrice=(v:any)=>{try{return rawPrice(v)}catch(error){return fail(400,(error as Error).message)}};
const q=(e:NftEnv,sql:string,...args:any[])=>e.DB.prepare(sql).bind(...args);
const first=(e:NftEnv,sql:string,...args:any[])=>q(e,sql,...args).first<any>();
const rows=async(e:NftEnv,sql:string,...args:any[])=>(await q(e,sql,...args).all<any>()).results;
const json=(d:any,status=200)=>new Response(JSON.stringify(d,(_,v)=>typeof v==='bigint'?v.toString():v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const identityAbi=[{type:'function',name:'balanceOf',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]}] as const;
const client=(e:NftEnv)=>createPublicClient({chain:bsc,transport:http(e.NFT_RPC_URL||e.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:10000,retryCount:1})});
const digest=(tx:NftTransaction)=>keccak256(toHex(canonical(tx)));
const read=async(c:any,address:string,abi:any,name:string,args:any[]=[])=>c.readContract({address,abi,functionName:name,args});
function configured(e:NftEnv):NftAddresses{try{const config=nftConfig(e);if(!config)throw new NftError(409,'Collection contracts are awaiting mainnet deployment. No mint or trade can be submitted yet.');return {...config,collectionBids:nftCollectionBidsAddress(e)};}catch(error){if(error instanceof NftError)throw error;throw new NftError(503,'NFT contract configuration is incomplete.');}}

const checked=new Map<string,number>();
async function chain(e:NftEnv){
 const config=configured(e),c=client(e),v2=nftV2Active(e),cacheKey=[e.NFT_RPC_URL||e.BSC_RPC_URL,...Object.values(config),e.NFT_FEE_RECIPIENT||config.vault].join(':')+(v2?':v2':'');
 if((checked.get(cacheKey)||0)<Date.now()){
  try{
   const values=await Promise.all([c.getChainId(),read(c,config.collection,nftAbi,'paymentToken'),read(c,config.collection,nftAbi,'lpVault'),read(c,config.collection,nftAbi,'MAX_SUPPLY'),read(c,config.collection,nftAbi,'WALLET_LIMIT'),read(c,config.collection,nftAbi,'mintPrice'),read(c,config.collection,nftAbi,'agentIdRegistry'),read(c,config.market,nftMarketAbi,'collection'),read(c,config.market,nftMarketAbi,'paymentToken'),read(c,config.market,nftMarketAbi,'agentIdRegistry'),v2?read(c,config.vault,nibVaultV2ReadAbi,'usdt'):read(c,config.vault,nftVaultAbi,'paymentToken'),v2?read(c,config.vault,nibVaultV2ReadAbi,'router'):read(c,config.vault,nftVaultAbi,'router'),read(c,config.collection,nftAbi,'priceFeed'),v2?read(c,config.vault,nibVaultV2ReadAbi,'wbnb'):read(c,config.vault,nftVaultAbi,'wrappedNative'),read(c,config.market,nftMarketAbi,'BUYER_FEE_BPS'),read(c,config.market,nftMarketAbi,'SELLER_FEE_BPS'),read(c,config.market,nftMarketAbi,'feeRecipient')]);
   const same=(a:any,b:string)=>String(a).toLowerCase()===b.toLowerCase();
   if(values[0]!==56||!same(values[1],NFT_PAYMENT)||!same(values[2],config.vault)||BigInt(values[3])!==10000n||BigInt(values[4])!==10n||BigInt(values[5])!==(v2?5n*10n**16n:10n**18n)||!same(values[6],AGENT_ID_REGISTRY)||!same(values[7],config.collection)||!same(values[8],NFT_NATIVE)||!same(values[9],AGENT_ID_REGISTRY)||!same(values[10],NFT_PAYMENT)||!same(values[11],NFT_ROUTER)||!same(values[12],NFT_PRICE_FEED)||!same(values[13],NFT_WBNB)||BigInt(values[14])!==BigInt(NFT_BUYER_FEE_BPS)||BigInt(values[15])!==BigInt(NFT_SELLER_FEE_BPS)||!same(values[16],e.NFT_FEE_RECIPIENT||config.vault))fail(503,'NFT contracts do not match the published collection rules.');
   if(v2){// NibCollectionV2 must mirror the original collection: same renderer art, ids 1..publicStartId-1 reserved for its holders, payments to the V2 vault.
    const [legacy,start]=await Promise.all([read(c,config.collection,nftV2Abi,'legacy'),read(c,config.collection,nftV2Abi,'publicStartId')]);
    if(!same(legacy,e.NFT_LEGACY_COLLECTION||NFT_COLLECTION_V1)||BigInt(start)<2n||BigInt(start)>10000n)fail(503,'NFT contracts do not match the published collection rules.');
   }
   if(checked.size>32)checked.clear();checked.set(cacheKey,Date.now()+60000);
  }catch(error){if(error instanceof NftError)throw error;fail(503,'BNB Chain NFT verification is unavailable. Try again shortly.');}
 }
 return {c,config};
}

/* ---------- Collection-wide bids (optional contract; hidden until NFT_COLLECTION_BIDS is set and verified) ---------- */
const cbChecked=new Map<string,number>();
async function cbidsContract(e:NftEnv,c:any,config:NftAddresses,required=false):Promise<`0x${string}`|null>{
 const address=config.collectionBids;if(!address){if(required)fail(409,'Collection bids are awaiting contract deployment. Nothing can be submitted yet.');return null;}
 const key=[e.NFT_RPC_URL||e.BSC_RPC_URL,address,config.collection,config.market].join(':');
 if((cbChecked.get(key)||0)<Date.now()){
  try{
   const v=await Promise.all([read(c,address,nftCollectionBidsAbi,'collection'),read(c,address,nftCollectionBidsAbi,'agentIdRegistry'),read(c,address,nftCollectionBidsAbi,'feeRecipient'),read(c,address,nftCollectionBidsAbi,'BUYER_FEE_BPS'),read(c,address,nftCollectionBidsAbi,'SELLER_FEE_BPS'),read(c,address,nftCollectionBidsAbi,'MAX_QUANTITY'),read(c,config.market,nftMarketAbi,'feeRecipient')]);
   const same=(a:any,b:string)=>String(a).toLowerCase()===b.toLowerCase();
   // The collection-bid fees go to the exact recipient of the verified per-NFT marketplace.
   if(!same(v[0],config.collection)||!same(v[1],AGENT_ID_REGISTRY)||!same(v[2],String(v[6]))||BigInt(v[3])!==BigInt(NFT_BUYER_FEE_BPS)||BigInt(v[4])!==BigInt(NFT_SELLER_FEE_BPS)||BigInt(v[5])!==BigInt(NFT_COLLECTION_BID_MAX_QUANTITY))fail(503,'The collection-bid contract does not match the published rules.');
   if(cbChecked.size>32)cbChecked.clear();cbChecked.set(key,Date.now()+60000);
  }catch(error){if(error instanceof NftError)throw error;fail(503,'BNB Chain collection-bid verification is unavailable. Try again shortly.');}
 }
 return address;
}
const cbView=(id:bigint,b:any,available:boolean)=>{const price=BigInt(b[1]),quantity=BigInt(b[2]),filled=BigInt(b[3]),left=quantity-filled,total=marketQuote(price).buyerTotal*left;return {bidId:id.toString(),bidder:String(b[0]).toLowerCase(),priceRaw:price.toString(),price:formatUnits(price,18),...quoteDisplay(price),quantity:Number(quantity),filled:Number(filled),remaining:Number(left),depositRaw:total.toString(),deposit:formatUnits(total,18),expiresAt:Number(b[4])*1000,available};};
async function collectionBid(c:any,address:string,id:bigint){const [b,available]=await Promise.all([read(c,address,nftCollectionBidsAbi,'bids',[id]),read(c,address,nftCollectionBidsAbi,'bidAvailable',[id])]);if(/^0x0{40}$/i.test(String(b[0])))return null;return cbView(id,b,available===true);}
export const COLLECTION_BID_LIMIT=200;
async function collectionBidsSnapshot(e:NftEnv,c:any,config:NftAddresses,wallet:string|null,url:URL){
 const base={configured:false,address:null as string|null,bids:[] as any[],buyerFeeBps:NFT_BUYER_FEE_BPS,sellerFeeBps:NFT_SELLER_FEE_BPS,maxQuantity:NFT_COLLECTION_BID_MAX_QUANTITY,maxDays:30};
 if(!config.collectionBids)return {...base,status:'awaiting_deployment'};
 let address:`0x${string}`;try{address=(await cbidsContract(e,c,config))!;}catch(error){return {...base,status:'unavailable',error:error instanceof NftError?error.message:'Collection bids are unavailable.'};}
 const view=url.searchParams.get('cbView')==='mine'&&wallet?'mine':'all',page=Math.max(0,Math.min(1000000,Math.floor(Number(url.searchParams.get('cbPage'))||0)));
 const [count,mineCount,completed,volume,fees,escrowed]=await Promise.all([read(c,address,nftCollectionBidsAbi,'bidCount'),wallet?read(c,address,nftCollectionBidsAbi,'bidderBidCount',[wallet]):0n,read(c,address,nftCollectionBidsAbi,'completedSales'),read(c,address,nftCollectionBidsAbi,'volume'),read(c,address,nftCollectionBidsAbi,'feesCollected'),read(c,address,nftCollectionBidsAbi,'escrowedBNB')]);
 const total=Math.min(Number(view==='mine'?mineCount:count),COLLECTION_BID_LIMIT),truncated=Number(view==='mine'?mineCount:count)>total;
 const ids:bigint[]=(await batch(c,Array.from({length:total},(_:unknown,i:number)=>view==='mine'?{address,abi:nftCollectionBidsAbi,functionName:'bidderBidAt',args:[wallet,BigInt(i)]}:{address,abi:nftCollectionBidsAbi,functionName:'bidAt',args:[BigInt(i)]}))).map((v:any)=>BigInt(v));
 const data=await batch(c,ids.flatMap((id:bigint)=>[{address,abi:nftCollectionBidsAbi,functionName:'bids',args:[id]},{address,abi:nftCollectionBidsAbi,functionName:'bidAvailable',args:[id]}]));
 // Best price first; a stale (expired or ineligible) bid only appears in the bidder's own list so it can be cancelled.
 const items=ids.map((id:bigint,i:number)=>cbView(id,data[i*2],data[i*2+1]===true)).filter((b:any)=>view==='mine'||b.available).sort((a:any,b:any)=>{const d=BigInt(b.priceRaw)-BigInt(a.priceRaw);return d>0n?1:d<0n?-1:Number(BigInt(a.bidId)-BigInt(b.bidId));});
 return {...base,configured:true,status:'live',address,view,page,slots:items.length,truncated,bids:items.slice(page*12,page*12+12),outgoing:Number(mineCount),stats:{completedSales:Number(completed),volume:formatUnits(BigInt(volume),18),feesCollected:formatUnits(BigInt(fees),18),escrowedBNB:formatUnits(BigInt(escrowed),18),openBids:Number(count)},feePolicy:'Escrow is quantity × (price + 2%). A seller receives price − 2% per NFT; the 2% fees go to the project treasury. Cancelling refunds every unfilled NFT in full.'};
}
// Ownership is read at one current block for each access/earning check; it is not session-cached.
export async function nftGameHolding(e:NftEnv,wallet:string):Promise<{owned:number;block:string;identityEligible:boolean}>{
 e=resolveNftEnv(e);
 const {c,config}=await chain(e);
 try{const block=await c.getBlockNumber({cacheTime:0});const [held,identity]=await Promise.all([c.readContract({address:config.collection as `0x${string}`,abi:nftAbi,functionName:'balanceOf',args:[wallet as `0x${string}`],blockNumber:block}),c.readContract({address:AGENT_ID_REGISTRY,abi:identityAbi,functionName:'balanceOf',args:[wallet as `0x${string}`],blockNumber:block})]);if(held>10000n)fail(503,'Collection holdings exceed the verified supply.');return {owned:Number(held),block:block.toString(),identityEligible:identity>0n};}catch(error){if(error instanceof NftError)throw error;return fail(503,'NFT ownership verification is unavailable. No points were awarded.');}
}
const asset=(id:number)=>({id,name:'Nib #'+String(id).padStart(5,'0'),image:'/api/nft/preview/v2/'+id+'.png',originalImage:'/api/nft/art/v2/'+id+'.svg',traits:nftTraits(id)});
const serializeIntent=(v:any)=>({...v,payload:JSON.parse(v.payload),transaction:JSON.parse(v.transaction),summary:JSON.parse(v.summary),preview:v.preview?JSON.parse(v.preview):null,txDigest:digest(JSON.parse(v.transaction))});
export async function nftIntents(e:NftEnv,wallet:string,now:number){
 await q(e,"UPDATE nft_intents SET status='expired',error='The request expired. Queue a fresh request.',finished_at=? WHERE wallet=? AND status IN ('queued','preparing','agent_preparing','awaiting_approval','approved') AND expires_at<=?",now,wallet,now).run();
 return (await rows(e,'SELECT * FROM nft_intents WHERE wallet=? ORDER BY CASE WHEN status IN (\'queued\',\'preparing\',\'agent_preparing\',\'awaiting_approval\',\'approved\',\'executing\',\'app_confirmation\',\'needs_receipt\',\'broadcast\') THEN 0 ELSE 1 END,created_at DESC LIMIT 20',wallet)).map(serializeIntent);
}
function quoteDisplay(price:bigint){const q=marketQuote(price);return {buyerFeeRaw:q.buyerFee.toString(),sellerFeeRaw:q.sellerFee.toString(),buyerTotalRaw:q.buyerTotal.toString(),sellerProceedsRaw:q.sellerProceeds.toString(),buyerFee:formatUnits(q.buyerFee,18),sellerFee:formatUnits(q.sellerFee,18),buyerTotal:formatUnits(q.buyerTotal,18),sellerProceeds:formatUnits(q.sellerProceeds,18)};}
const listingView=(id:number,l:any,available:boolean)=>({tokenId:id,listingId:String(l[0]),seller:String(l[1]).toLowerCase(),priceRaw:String(l[2]),price:formatUnits(BigInt(l[2]),18),...quoteDisplay(BigInt(l[2])),expiresAt:Number(l[3])*1000,available,...asset(id)});
async function listing(c:any,market:string,id:number){const [l,available]=await Promise.all([read(c,market,nftMarketAbi,'listings',[BigInt(id)]),read(c,market,nftMarketAbi,'available',[BigInt(id)])]);return listingView(id,l,available);}
/** Reads every active listing (bounded) so the market can sort across pages. Uses Multicall3 and falls back to individual reads. */
export const MARKET_SORT_LIMIT=500;
async function batch(c:any,contracts:any[]):Promise<any[]>{try{return await c.multicall({contracts,allowFailure:false,batchSize:16384});}catch{const out:any[]=[];for(let i=0;i<contracts.length;i+=25)out.push(...await Promise.all(contracts.slice(i,i+25).map((x:any)=>c.readContract(x))));return out;}}
async function activeListings(c:any,market:string,count:number){
 const total=Math.min(count,MARKET_SORT_LIMIT);if(!total)return {items:[] as ReturnType<typeof listingView>[],truncated:false};
 const ids:number[]=(await batch(c,Array.from({length:total},(_:unknown,i:number)=>({address:market,abi:nftMarketAbi,functionName:'activeAt',args:[BigInt(i)]})))).map((v:any)=>Number(v));
 const data=await batch(c,ids.flatMap((id:number)=>[{address:market,abi:nftMarketAbi,functionName:'listings',args:[BigInt(id)]},{address:market,abi:nftMarketAbi,functionName:'available',args:[BigInt(id)]}]));
 return {items:ids.map((id:number,i:number)=>listingView(id,data[i*2],data[i*2+1]===true)),truncated:count>total};
}
function bidId(v:any){if(typeof v!=='string'||!/^[1-9][0-9]{0,77}$/.test(v)||BigInt(v)>2n**256n-1n)fail(400,'Choose a valid bid ID.');return BigInt(v);}
async function bid(c:any,market:string,id:bigint){const [b,available]=await Promise.all([read(c,market,nftMarketAbi,'bids',[id]),read(c,market,nftMarketAbi,'bidAvailable',[id])]);if(!b[0])return null;return {...asset(Number(b[0])),tokenId:Number(b[0]),bidId:id.toString(),bidder:String(b[1]).toLowerCase(),seller:String(b[2]).toLowerCase(),priceRaw:String(b[3]),price:formatUnits(BigInt(b[3]),18),...quoteDisplay(BigInt(b[3])),expiresAt:Number(b[4])*1000,available};}
export async function nftSnapshot(e:NftEnv,wallet:string|null,url:URL,now:number){
 e=resolveNftEnv(e);
 const page=Math.max(0,Math.min(833,Number(url.searchParams.get('page'))||0)),offset=Math.floor(page)*12;
 const gallery=Array.from({length:Math.min(12,10000-offset)},(_,i)=>asset(offset+i+1));
 const vaultV2=nibVaultV2Address(e),base={vaultV2:{configured:!!vaultV2,address:vaultV2},name:'Nib Collection',supply:10000,walletLimit:10,freePerWallet:nftV2Active(e)?3:1,paidPrice:nftV2Active(e)?'0.05':'1',paidPriceCurrency:'USD',mintPaymentSymbols:['USDT','BNB'],marketPaymentSymbol:'BNB',paymentToken:NFT_PAYMENT,priceFeed:NFT_PRICE_FEED,chainId:56,artMode:'fully-onchain',gallery,galleryPage:Math.floor(page),galleryPages:834,token:'TBA',marketFeeBps:NFT_BUYER_FEE_BPS+NFT_SELLER_FEE_BPS,buyerFeeBps:NFT_BUYER_FEE_BPS,sellerFeeBps:NFT_SELLER_FEE_BPS,feePolicy:'2% charged to each side; buyer pays 102%, seller receives 98%. Fees round down to whole wei.'};
 if(!nftConfig(e))return {...base,status:'awaiting_deployment',configured:false,notice:'The art and agent flows are ready. Mainnet contracts need deployment and activation before minting or trading.',minted:0,mintOpen:false,listings:[],bids:[],bidSlots:0,bidView:'all',bidPage:0,owned:[],wallet:null,collectionBids:{configured:false,status:'awaiting_deployment',bids:[],address:null,buyerFeeBps:NFT_BUYER_FEE_BPS,sellerFeeBps:NFT_SELLER_FEE_BPS,maxQuantity:NFT_COLLECTION_BID_MAX_QUANTITY,maxDays:30},intents:wallet?await nftIntents(e,wallet,now):[]};
 const {c,config}=await chain(e),v2=nftV2Active(e),vaultRead=(name:string,zero:any)=>v2?Promise.resolve(zero):read(c,config.vault,nftVaultAbi,name);
 const [minted,open,paused,count,volume,sales,funds,token,added,locked,wrappedFunds,bnbAdded,bnbLocked,bidSlots,feesCollected,escrowed,feeRecipient]=await Promise.all([read(c,config.collection,nftAbi,'minted'),read(c,config.collection,nftAbi,'mintOpen'),read(c,config.collection,nftAbi,'paused'),read(c,config.market,nftMarketAbi,'activeCount'),read(c,config.market,nftMarketAbi,'volume'),read(c,config.market,nftMarketAbi,'completedSales'),read(c,NFT_PAYMENT,nftPaymentAbi,'balanceOf',[config.vault]),vaultRead('liquidityToken','0x0000000000000000000000000000000000000000'),vaultRead('paymentAdded',0n),vaultRead('lpTokensLocked',0n),read(c,NFT_WBNB,nftPaymentAbi,'balanceOf',[config.vault]),vaultRead('bnbAdded',0n),vaultRead('lpTokensLockedBNB',0n),read(c,config.market,nftMarketAbi,'bidCount'),read(c,config.market,nftMarketAbi,'feesCollected'),read(c,config.market,nftMarketAbi,'escrowedBNB'),read(c,config.market,nftMarketAbi,'feeRecipient')]);
 let v2State:any=null;
 if(v2){const [finalized,airdropCount,publicMinted,publicStartId,vaultBnb,bonusCount,ownerMinted]=await Promise.all([read(c,config.collection,nftV2Abi,'airdropFinalized'),read(c,config.collection,nftV2Abi,'airdropCount'),read(c,config.collection,nftV2Abi,'publicMinted'),read(c,config.collection,nftV2Abi,'publicStartId'),c.getBalance({address:config.vault}),read(c,config.collection,nftV2Abi,'bonusCount'),read(c,config.collection,nftV2Abi,'ownerMinted')]);v2State={active:true,airdropFinalized:finalized===true,airdropCount:Number(airdropCount),publicMinted:Number(publicMinted),publicStartId:Number(publicStartId),airdropIds:Number(publicStartId)-1,bonusCount:Number(bonusCount),ownerMinted:Number(ownerMinted),vault:config.vault,vaultBnb:formatUnits(BigInt(vaultBnb),18),vaultUsdt:formatUnits(BigInt(funds),18),vaultWbnb:formatUnits(BigInt(wrappedFunds),18)};}
 let bnbPriceRaw:string|null=null;try{bnbPriceRaw=String(await read(c,config.collection,nftAbi,'mintPriceBNB'));}catch{}
 const marketOffset=Math.max(0,Math.floor(Number(url.searchParams.get('marketPage'))||0))*12,sort=parseSort(url.searchParams.get('sort')),mintedCount=Number(minted),rar=<T extends {id?:number;tokenId?:number}>(v:T)=>withRarity(v,mintedCount);
 const [{items:activeItems,truncated},salesResult]=await Promise.all([activeListings(c,config.market,Number(count)),recentSales({NFT_RPC_URL:e.NFT_RPC_URL,BSC_RPC_URL:e.BSC_RPC_URL,NFT_LOGS_RPC_URL:e.NFT_LOGS_RPC_URL,NFT_LOGS_CHUNK:e.NFT_LOGS_CHUNK,NFT_MARKETPLACE_FROM_BLOCK:e.NFT_MARKETPLACE_FROM_BLOCK},config.market,Math.max(1,Math.min(50,Math.floor(Number(url.searchParams.get('salesLimit'))||12))),now).catch(()=>({items:[] as any[],index:{fromBlock:null,scannedToBlock:null,headBlock:null,total:0,complete:false,error:'Sales index unavailable',cacheTtlSeconds:20,source:'Bought and BidAccepted events'}}))]);
 const sorted=sortListings(activeItems.filter(v=>v.available).map(rar),sort),listings=sorted.slice(marketOffset,marketOffset+12);
 let mine:any=null,owned:any[]=[];
 if(wallet){
  const [used,held,balance,identity,mintAllowance,bnbBalance,refundsRaw,outgoing,incoming]=await Promise.all([read(c,config.collection,nftAbi,'mintedBy',[wallet]),read(c,config.collection,nftAbi,'balanceOf',[wallet]),read(c,NFT_PAYMENT,nftPaymentAbi,'balanceOf',[wallet]),read(c,AGENT_ID_REGISTRY,identityAbi,'balanceOf',[wallet]),read(c,NFT_PAYMENT,nftPaymentAbi,'allowance',[wallet,config.collection]),c.getBalance({address:wallet as `0x${string}`}),read(c,config.market,nftMarketAbi,'refunds',[wallet]),read(c,config.market,nftMarketAbi,'bidderBidCount',[wallet]),read(c,config.market,nftMarketAbi,'sellerBidCount',[wallet])]);
  const ownedOffset=Math.max(0,Math.floor(Number(url.searchParams.get('ownedPage'))||0))*12;
  const ownedIds=await Promise.all(Array.from({length:Math.max(0,Math.min(12,Number(held)-ownedOffset))},(_,i)=>read(c,config.collection,nftAbi,'tokenOfOwnerByIndex',[wallet,BigInt(i+ownedOffset)])));
  owned=await Promise.all(ownedIds.map(async id=>rar({...asset(Number(id)),listing:rar(await listing(c,config.market,Number(id)))})));
  mine={minted:Number(used),remaining:10-Number(used),owned:Number(held),freeAvailable:BigInt(used)<BigInt(v2?3:1),freeRemaining:Math.max(0,(v2?3:1)-Number(used)),paymentBalance:formatUnits(BigInt(balance),18),eligible:BigInt(identity)>0n,mintAllowanceRaw:String(mintAllowance),bnbBalance:formatUnits(BigInt(bnbBalance),18),refundRaw:String(refundsRaw),refund:formatUnits(BigInt(refundsRaw),18),outgoingBids:Number(outgoing),incomingBids:Number(incoming)};
 }
 const collectionBids=await collectionBidsSnapshot(e,c,config,wallet,url);
 const requestedBidView=url.searchParams.get('bidView'),bidView=['mine','incoming'].includes(requestedBidView||'')?requestedBidView!:'all';
 const selectedCount=bidView==='all'?Number(bidSlots):!mine?0:bidView==='mine'?mine.outgoingBids:mine.incomingBids;
 const bidOffset=Math.min(1000000,Math.max(0,Math.floor(Number(url.searchParams.get('bidPage'))||0)))*12;
 const bidIds=await Promise.all(Array.from({length:Math.max(0,Math.min(12,selectedCount-bidOffset))},(_,i)=>read(c,config.market,nftMarketAbi,bidView==='all'?'bidAt':bidView==='mine'?'bidderBidAt':'sellerBidAt',bidView==='all'?[BigInt(i+bidOffset)]:[wallet,BigInt(i+bidOffset)])));
 const bids=(await Promise.all(bidIds.map(id=>bid(c,config.market,BigInt(id))))).filter(Boolean).map((v:any)=>rar(v));
 return {...base,collectionBids,gallery:gallery.map(rar),sort,sortOptions:MARKET_SORTS,rarity:{method:'Each trait value scores minted supply ÷ number of minted Nibs with that value; the six scores are summed. Rank 1 is rarest. Ties share a rank. Recomputed as supply is minted.',minted:mintedCount,traits:traitFrequencies(mintedCount)},recentSales:salesResult.items.map(v=>rar(v)).map(v=>({...v,...asset(v.tokenId)})),salesIndex:salesResult.index,marketTruncated:truncated,bids,bidSlots:selectedCount,bidView,bidPage:bidOffset/12,feeRecipient:String(feeRecipient),feeDestination:String(feeRecipient).toLowerCase()===config.vault.toLowerCase()?(v2?'Treasury vault':'LP vault'):'Project treasury',status:open&&!paused?'live':v2State&&!v2State.airdropFinalized?'awaiting_airdrop':'paused',v2:v2State,configured:true,bnbPriceRaw,bnbQuoteBufferBps:100,contracts:config,minted:Number(minted),mintOpen:open&&!paused,listings,marketPage:marketOffset/12,marketSlots:sorted.length,marketActive:Number(count),owned,wallet:mine,intents:wallet?await nftIntents(e,wallet,now):[],lp:v2?null:{wrappedBNB:NFT_WBNB,bnbBalance:formatUnits(BigInt(wrappedFunds),18),bnbAdded:formatUnits(BigInt(bnbAdded),18),lockedBNBRaw:String(bnbLocked),balance:formatUnits(BigInt(funds),18),paymentAdded:formatUnits(BigInt(added),18),lockedRaw:String(locked),token:String(token),tokenConfigured:String(token)!=='0x0000000000000000000000000000000000000000',vault:config.vault,router:NFT_ROUTER},market:{completedSales:Number(sales),volume:formatUnits(BigInt(volume),18),feesCollected:formatUnits(BigInt(feesCollected),18),escrowedBNB:formatUnits(BigInt(escrowed),18),bidCount:Number(bidSlots)}};
}
async function queue(e:NftEnv,a:any,b:any,now:number,agent=false){
 const {c,config}=await chain(e),wallet=a.wallet as `0x${string}`,payload:any={};let kind=String(b.kind),tx:NftTransaction,summary:any;
 if(agent){// Agent-started requests may omit values the chain already fixes; the agent still validates the exact transaction locally.
  b={...b};if(kind==='buy'&&b.tokenId!==undefined&&(!b.listingId||!b.priceRaw)){const l=await listing(c,config.market,nftTokenId(b.tokenId));b.listingId=l.listingId;b.priceRaw=l.priceRaw;}
  if(kind==='accept-bid'&&b.bidId!==undefined&&(!b.priceRaw||!b.bidder)){const o=await bid(c,config.market,bidId(String(b.bidId)));if(o){b.priceRaw=o.priceRaw;b.bidder=o.bidder;}}
  if(kind==='withdraw-bid-refund'&&!b.amountRaw)b.amountRaw=String(await read(c,config.market,nftMarketAbi,'refunds',[wallet]));
  // Selling into a collection bid needs a per-NFT approval of the collection-bid contract first (the same single-token approach).
  if(kind==='cbid-accept'&&b.tokenId!==undefined&&b.bidId!==undefined){
   const cb=await cbidsContract(e,c,config,true),tokenId=nftTokenId(b.tokenId);let owner='';try{owner=String(await read(c,config.collection,nftAbi,'ownerOf',[BigInt(tokenId)])).toLowerCase();}catch{}
   if(owner===wallet&&!(await read(c,cb!,nftCollectionBidsAbi,'approved',[BigInt(tokenId),wallet]))){payload.followUp='nft-collection-accept';kind='cbid-approval';b={kind,tokenId};}
  }
  // A listing or bid acceptance needs a per-NFT approval first. Prepare that single exact approval instead (the agent then repeats the original request).
  if(kind==='list'||kind==='accept-bid'){
   let tokenId:number|null=null;if(kind==='list')tokenId=nftTokenId(b.tokenId);else{const o=await bid(c,config.market,bidId(String(b.bidId)));if(o&&o.seller===wallet)tokenId=o.tokenId;}
   if(tokenId!==null&&String(await read(c,config.collection,nftAbi,'getApproved',[BigInt(tokenId)])).toLowerCase()!==config.market.toLowerCase()){payload.followUp=kind;kind='nft-approval';b={kind,tokenId};}
  }
 }
 if(!['cancel-bid','withdraw-bid-refund','cbid-cancel'].includes(kind)&&BigInt(await read(c,AGENT_ID_REGISTRY,identityAbi,'balanceOf',[wallet]))===0n)fail(403,'This wallet needs a Binance Agent ID on BNB Chain.');
 const id=crypto.randomUUID(),expires=now+20*60000,deadline=BigInt(Math.floor(expires/1000));
 if(kind==='mint'||kind==='mint-approval'){
  const currency=b.currency===undefined?'USDT':String(b.currency);if(!['USDT','BNB'].includes(currency))fail(400,'Choose USDT or BNB for minting.');if(kind==='mint-approval'&&currency!=='USDT')fail(400,'BNB minting needs no token approval.');
  const quantity=Number(b.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>10)fail(400,'Choose 1–10 NFTs.');
  const [used,total,open,paused]=await Promise.all([read(c,config.collection,nftAbi,'mintedBy',[wallet]),read(c,config.collection,nftAbi,'minted'),read(c,config.collection,nftAbi,'mintOpen'),read(c,config.collection,nftAbi,'paused')]);
  if(!open||paused)fail(409,'Minting is paused.');if(Number(used)+quantity>10)fail(409,'This wallet has reached its lifetime mint limit.');if(Number(total)+quantity>10000)fail(409,'Not enough collection supply remains.');
  const v2=nftV2Active(e),freeLeft=Math.max(0,(v2?3:1)-Number(used)),paid=quantity-Math.min(quantity,freeLeft),perNft=v2?5n*10n**16n:10n**18n,priceText=v2?'$0.05':'$1',proceeds=v2?'the treasury vault':'the LP vault';let cost=BigInt(paid)*perNft;
  payload.quantity=quantity;payload.currency=currency;
  if(currency==='BNB'){
   let quote:bigint;try{quote=BigInt(await read(c,config.collection,nftAbi,'mintCostBNB',[wallet,BigInt(quantity)]));}catch{return fail(503,'The BNB/USD price is unavailable or stale. Try USDT, or retry when the feed recovers.');}
   cost=nativeMintBudget(quote);payload.quotedCostRaw=quote.toString();payload.costRaw=cost.toString();
   if(await c.getBalance({address:wallet})<cost)fail(409,'Not enough BNB for the mint payment. Additional BNB is also needed for network gas.');
   tx=nftCall(wallet,config.collection,nftAbi,'mintBNB',[BigInt(quantity),cost,deadline,keccak256(toHex(id))],cost);
   summary={title:'Mint '+quantity+' Nib NFT'+(quantity===1?'':'s')+' with BNB',payment:formatUnits(cost,18),quotedPayment:formatUnits(quote,18),currency:'BNB',quantity,scope:'At most the displayed BNB value: '+priceText+' per paid NFT at the on-chain BNB/USD price, with a 1% quote ceiling. Unused BNB is refunded in the same transaction; mint proceeds go to '+proceeds+'.'};
  }else{
   payload.costRaw=cost.toString();
   if(kind==='mint-approval'){
    if(cost===0n)fail(409,v2?'Your free mints require no USDT approval.':'Your first mint requires no USDT approval.');tx=nftCall(wallet,NFT_PAYMENT,nftPaymentAbi,'approve',[config.collection,cost]);summary={title:'Approve exact mint payment',payment:formatUnits(cost,18),currency:'USDT',spender:config.collection,scope:'USDT allowance for this mint amount only. This transaction does not mint.'};
   }else{
    const allowance=await read(c,NFT_PAYMENT,nftPaymentAbi,'allowance',[wallet,config.collection]);if(BigInt(allowance)<cost)fail(409,'Approve the exact USDT payment first, then request the mint.');
    tx=nftCall(wallet,config.collection,nftAbi,'mint',[BigInt(quantity),cost,deadline,keccak256(toHex(id))]);summary={title:'Mint '+quantity+' Nib Collection NFT'+(quantity===1?'':'s'),payment:formatUnits(cost,18),currency:'USDT',quantity,scope:'NFTs minted to your agent wallet; primary sale payment goes directly to '+proceeds+'.'};
   }
  }
 }else if(['bid','cancel-bid','accept-bid','withdraw-bid-refund'].includes(kind)){
  payload.currency='BNB';
  if(kind==='bid'){
   const tokenId=nftTokenId(b.tokenId),price=nftPrice(b.price),days=Number(b.days??7);if(!Number.isInteger(days)||days<1||days>30)fail(400,'Choose a bid duration of 1–30 days.');
   let seller:string;try{seller=String(await read(c,config.collection,nftAbi,'ownerOf',[BigInt(tokenId)])).toLowerCase();}catch{return fail(409,'This NFT has not been minted. Bids require an existing NFT.');}
   if(seller===wallet)fail(409,'You cannot bid on your own NFT.');if(BigInt(await read(c,AGENT_ID_REGISTRY,identityAbi,'balanceOf',[seller]))===0n)fail(409,'The NFT owner needs an eligible Agent ID.');
   if(BigInt(await read(c,config.market,nftMarketAbi,'bidderTokenBid',[wallet,BigInt(tokenId)]))!==0n)fail(409,'Cancel your existing bid for this NFT before replacing it.');
   const q=marketQuote(price);if(await c.getBalance({address:wallet})<q.buyerTotal)fail(409,'Not enough BNB for the bid deposit including the 2% buyer fee. Network gas is additional.');
   Object.assign(payload,{tokenId,priceRaw:price.toString(),buyerTotalRaw:q.buyerTotal.toString(),seller,days});
   tx=nftCall(wallet,config.market,nftMarketAbi,'placeBid',[BigInt(tokenId),price,BigInt(Math.floor(now/1000)+days*86400),seller],q.buyerTotal);
   summary={title:'Bid on Nib #'+tokenId,payment:formatUnits(q.buyerTotal,18),salePrice:formatUnits(price,18),...quoteDisplay(price),tokenId,seller,days,scope:'BNB deposit includes the 2% buyer fee and stays in marketplace escrow until accepted or cancelled. The offer is bound to this current owner. Cancel first, then withdraw the full deposit; no trading fee is charged on cancellation.'};
  }else if(kind==='withdraw-bid-refund'){
   const available=BigInt(await read(c,config.market,nftMarketAbi,'refunds',[wallet]));if(typeof b.amountRaw!=='string'||!/^[1-9][0-9]{0,77}$/.test(b.amountRaw))fail(400,'Choose a positive exact refund amount.');const amount=BigInt(b.amountRaw);if(amount>available)fail(409,'Refund balance changed. Refresh before withdrawing.');
   Object.assign(payload,{amountRaw:amount.toString(),recipient:wallet});tx=nftCall(wallet,config.market,nftMarketAbi,'withdrawRefund',[amount,wallet]);summary={title:'Withdraw cancelled bid deposit',payment:'0',refund:formatUnits(amount,18),recipient:wallet,scope:'Withdraw exactly '+formatUnits(amount,18)+' BNB of your refund credit to your paired agent wallet. No trading fee. BNB network gas is additional.'};
  }else{
   const id=bidId(b.bidId),offer=await bid(c,config.market,id);if(!offer)return fail(409,'This bid has already finished.');
   Object.assign(payload,{bidId:id.toString(),tokenId:offer.tokenId,priceRaw:offer.priceRaw,bidder:offer.bidder,seller:offer.seller});
   if(kind==='cancel-bid'){
    if(offer.bidder!==wallet)fail(403,'Only the bidder can cancel this bid.');tx=nftCall(wallet,config.market,nftMarketAbi,'cancelBid',[id]);summary={title:'Cancel bid on Nib #'+offer.tokenId,payment:'0',refund:offer.buyerTotal,tokenId:offer.tokenId,scope:'Cancel this exact bid and credit the entire '+offer.buyerTotal+' BNB deposit, including the buyer fee, to your refund balance. Withdraw the credit in a separate reviewed transaction. No trading fee is charged.'};
   }else{
    if(offer.seller!==wallet)fail(403,'Only the owner named in this bid can accept it.');if(!offer.available)fail(409,'This bid expired, its NFT changed owner, or an Agent ID is no longer eligible.');
    if(String(b.priceRaw)!==offer.priceRaw||String(b.bidder).toLowerCase()!==offer.bidder)fail(409,'Bid terms changed. Review the exact bidder and price again.');
    if(String(await read(c,config.collection,nftAbi,'getApproved',[BigInt(offer.tokenId)])).toLowerCase()!==config.market.toLowerCase())fail(409,'Approve this individual NFT for trading before accepting the bid.');
    tx=nftCall(wallet,config.market,nftMarketAbi,'acceptBid',[id,offer.bidder,BigInt(offer.priceRaw),deadline]);summary={title:'Accept bid on Nib #'+offer.tokenId,payment:'0',salePrice:offer.price,...quoteDisplay(BigInt(offer.priceRaw)),tokenId:offer.tokenId,bidder:offer.bidder,scope:'Transfer this NFT to the named bidder and receive '+offer.sellerProceeds+' BNB after the 2% seller fee. The buyer deposit covers the price and separate 2% buyer fee. Settlement is atomic.'};
   }
  }
  summary.currency='BNB';
 }else if(['cbid','cbid-cancel','cbid-accept','cbid-approval'].includes(kind)){
  const cb=(await cbidsContract(e,c,config,true))!;payload.currency='BNB';
  if(kind==='cbid'){
   const price=nftPrice(b.price),quantity=nftQuantity(b.quantity),days=Number(b.days??7);if(!Number.isInteger(days)||days<1||days>30)fail(400,'Choose a bid duration of 1–30 days.');
   const q=marketQuote(price),total=collectionBidDeposit(price,quantity);if(await c.getBalance({address:wallet})<total)fail(409,'Not enough BNB for the full escrow: quantity × (price + 2% buyer fee). Network gas is additional.');
   Object.assign(payload,{priceRaw:price.toString(),quantity,totalRaw:total.toString(),days});
   tx=nftCall(wallet,cb,nftCollectionBidsAbi,'placeBid',[price,BigInt(quantity),BigInt(Math.floor(now/1000)+days*86400)],total);
   summary={title:'Collection bid: '+quantity+' Nib NFT'+(quantity===1?'':'s')+' at '+formatUnits(price,18)+' BNB each',payment:formatUnits(total,18),salePrice:formatUnits(price,18),...quoteDisplay(price),quantity,totalEscrow:formatUnits(total,18),days,scope:'BNB escrow of '+formatUnits(total,18)+' (= '+quantity+' × '+formatUnits(q.buyerTotal,18)+', each price plus its 2% buyer fee) stays in the collection-bid contract. Any eligible holder of ANY Nib can sell into it one NFT at a time and receives the price minus 2%; filled NFTs go to your wallet. Cancel any time to refund every unfilled NFT in full, with no fee.'};
  }else if(kind==='cbid-approval'){
   const tokenId=nftTokenId(b.tokenId);payload.tokenId=tokenId;let owner='';try{owner=String(await read(c,config.collection,nftAbi,'ownerOf',[BigInt(tokenId)])).toLowerCase();}catch{}
   if(owner!==wallet)fail(403,'Only the NFT owner can request this action.');
   tx=nftCall(wallet,config.collection,nftAbi,'approve',[cb,BigInt(tokenId)]);summary={title:'Approve Nib #'+tokenId+' for collection bids',payment:'0',tokenId,spender:cb,scope:'Approval for this one NFT only, to the collection-bid contract. No collection-wide approval.'};
  }else{
   const id=bidId(b.bidId),offer=await collectionBid(c,cb,id);if(!offer)return fail(409,'This collection bid has already finished.');
   payload.bidId=id.toString();payload.priceRaw=offer.priceRaw;payload.bidder=offer.bidder;
   if(kind==='cbid-cancel'){
    if(offer.bidder!==wallet)fail(403,'Only the bidder can cancel this bid.');payload.recipient=wallet;payload.refundRaw=offer.depositRaw;
    tx=nftCall(wallet,cb,nftCollectionBidsAbi,'cancelBid',[id,wallet]);summary={title:'Cancel collection bid #'+offer.bidId,payment:'0',refund:offer.deposit,remaining:offer.remaining,filled:offer.filled,recipient:wallet,scope:'Refund the escrow of the '+offer.remaining+' unfilled NFT'+(offer.remaining===1?'':'s')+' ('+offer.deposit+' BNB, including their buyer fees) straight to your agent wallet in this transaction. NFTs already sold stay sold. No trading fee.'};
   }else{
    const tokenId=nftTokenId(b.tokenId);payload.tokenId=tokenId;payload.seller=wallet;
    if(!offer.available)fail(409,'This collection bid is expired, filled, or its bidder no longer has an eligible Agent ID.');if(offer.bidder===wallet)fail(403,'You cannot sell to your own bid.');
    if(b.priceRaw!==undefined&&String(b.priceRaw)!==offer.priceRaw)fail(409,'Bid terms changed. Review the exact price again.');
    let owner='';try{owner=String(await read(c,config.collection,nftAbi,'ownerOf',[BigInt(tokenId)])).toLowerCase();}catch{}
    if(owner!==wallet)fail(403,'You can only sell an NFT you own.');
    if(!(await read(c,cb,nftCollectionBidsAbi,'approved',[BigInt(tokenId),wallet])))fail(409,'Approve this individual NFT for collection bids before selling it.');
    tx=nftCall(wallet,cb,nftCollectionBidsAbi,'acceptBid',[id,BigInt(tokenId),offer.bidder as `0x${string}`,BigInt(offer.priceRaw),deadline]);summary={title:'Sell Nib #'+tokenId+' into collection bid #'+offer.bidId,payment:'0',salePrice:offer.price,...quoteDisplay(BigInt(offer.priceRaw)),tokenId,bidder:offer.bidder,remaining:offer.remaining,scope:'Transfer this NFT to the bidder and receive '+offer.sellerProceeds+' BNB (price minus the 2% seller fee). The bidder\'s escrow covers the price and the separate 2% buyer fee. Settlement is atomic; one NFT per transaction.'};
   }
  }
  summary.currency='BNB';
 }else if(['nft-approval','list','buy','cancel'].includes(kind)){
  const tokenId=nftTokenId(b.tokenId);payload.tokenId=tokenId;payload.currency='BNB';const l=await listing(c,config.market,tokenId);
  if(['nft-approval','list','cancel'].includes(kind)){
   const owner=String(await read(c,config.collection,nftAbi,'ownerOf',[BigInt(tokenId)])).toLowerCase();if(owner!==wallet)fail(403,'Only the NFT owner can request this action.');
   if(kind==='nft-approval'){tx=nftCall(wallet,config.collection,nftAbi,'approve',[config.market,BigInt(tokenId)]);summary={title:'Approve Nib #'+tokenId+' for trading',payment:'0',tokenId,spender:config.market,scope:'Approval for this NFT only. No collection-wide approval.'};}
   else if(kind==='cancel'){payload.listingId=l.listingId;if(l.seller!==wallet||l.listingId==='0')fail(409,'No listing owned by this wallet.');tx=nftCall(wallet,config.market,nftMarketAbi,'cancel',[BigInt(tokenId),BigInt(l.listingId)]);summary={title:'Cancel Nib #'+tokenId+' listing',payment:'0',tokenId,scope:'Removes your listing. Does not transfer the NFT.'};}
   else{
    const price=nftPrice(b.price),days=Number(b.days??7);if(!Number.isInteger(days)||days<1||days>30)fail(400,'Choose a listing duration of 1–30 days.');
    if(String(await read(c,config.collection,nftAbi,'getApproved',[BigInt(tokenId)])).toLowerCase()!==config.market.toLowerCase())fail(409,'Approve this individual NFT for the marketplace first.');
    payload.priceRaw=price.toString();payload.days=days;tx=nftCall(wallet,config.market,nftMarketAbi,'list',[BigInt(tokenId),price,BigInt(Math.floor(now/1000)+days*86400)]);summary={title:'List Nib #'+tokenId,payment:'0',salePrice:formatUnits(price,18),...quoteDisplay(price),tokenId,days,scope:'BNB-only noncustodial listing. Buyer pays the price plus 2%; you receive the price minus 2%. Your NFT stays in your wallet until purchased by an eligible agent.'};
   }
  }else{
   if(!l.available||l.seller===wallet)fail(409,'This listing is no longer available to this wallet.');
   if(String(b.listingId)!==l.listingId||String(b.priceRaw)!==l.priceRaw)fail(409,'The listing changed. Review the latest price first.');
   payload.listingId=l.listingId;payload.priceRaw=l.priceRaw;payload.seller=l.seller;
   const q=marketQuote(BigInt(l.priceRaw));payload.buyerTotalRaw=q.buyerTotal.toString();if(await c.getBalance({address:wallet})<q.buyerTotal)fail(409,'Not enough BNB for the price plus the 2% buyer fee. Network gas is additional.');
   tx=nftCall(wallet,config.market,nftMarketAbi,'buy',[BigInt(tokenId),BigInt(l.listingId),BigInt(l.priceRaw),l.seller,deadline],q.buyerTotal);summary={title:'Buy Nib #'+tokenId,payment:formatUnits(q.buyerTotal,18),salePrice:l.price,...quoteDisplay(BigInt(l.priceRaw)),tokenId,seller:l.seller,scope:'Price plus the 2% buyer fee is transferred as BNB. The seller receives the price minus the 2% seller fee; the NFT transfers atomically to your agent wallet. No USDT approval.'};
  }
  summary.currency='BNB';
 }else fail(400,'Unsupported NFT task. Marketplace purchases use BNB and need no USDT approval.');
 if(agent)payload.origin='agent';
 if(['list','buy','bid','accept-bid','cbid','cbid-accept'].includes(kind))summary.feeRecipient=String(await read(c,config.market,nftMarketAbi,'feeRecipient'));
 const result=await e.DB.batch([q(e,"INSERT INTO nft_intents(id,wallet,kind,payload,\"transaction\",summary,status,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM nft_intents WHERE wallet=? AND status IN ('queued','preparing','agent_preparing','awaiting_approval','approved','executing','app_confirmation','needs_receipt','broadcast'))<4 AND (SELECT COUNT(*) FROM nft_intents WHERE wallet=? AND created_at>?)<12 AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND connected=1 AND version=?)",id,wallet,kind,canonical(payload),canonical(tx!),canonical({...summary!,networkFee:'BNB network gas is additional, including on a free mint.'}),agent?'agent_preparing':'queued',now,expires,wallet,wallet,now-60000,wallet,a.version)]);
 if(!result[0].meta.changes)fail(429,'Finish or cancel existing NFT requests before adding another.');return serializeIntent(await first(e,'SELECT * FROM nft_intents WHERE id=?',id));
}
export async function nftReceipt(e:NftEnv,a:any,intentId:string,hash:any,now:number){
 e=resolveNftEnv(e);
 if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))fail(400,'Enter a valid BNB Chain transaction hash.');
 const intent=await first(e,'SELECT * FROM nft_intents WHERE id=? AND wallet=?',intentId,a.wallet);if(!intent)fail(404,'NFT request not found.');if(intent.status==='confirmed')return {ok:true,status:'confirmed'};
 if(!['executing','app_confirmation','needs_receipt','broadcast'].includes(intent.status))fail(409,'This request has not been approved and executed.');
 const {c}=await chain(e);let tx:any,r:any;
 try{[tx,r]=await Promise.all([c.getTransaction({hash}),c.getTransactionReceipt({hash})]);}catch{fail(409,'Transaction is not confirmed on BNB Chain yet. Try again after it is mined.');}
 const expected=JSON.parse(intent.transaction);
 if(tx.from.toLowerCase()!==a.wallet||tx.to?.toLowerCase()!==expected.to.toLowerCase()||tx.input.toLowerCase()!==expected.data.toLowerCase()||tx.value!==BigInt(expected.value))fail(400,'Transaction does not match this exact approved NFT request.');
 const block=await c.getBlockNumber();if(block-r.blockNumber<2n)fail(409,'Waiting for three BNB Chain confirmations.');
 if(r.status!=='success'){await q(e,"UPDATE nft_intents SET status='failed',transaction_hash=?,error='Transaction reverted on-chain. Network gas may have been charged.',finished_at=? WHERE id=? AND wallet=?",hash,now,intent.id,a.wallet).run();return {ok:false,status:'failed'};}
 try{await q(e,"UPDATE nft_intents SET status='confirmed',transaction_hash=?,finished_at=?,error=NULL WHERE id=? AND wallet=?",hash,now,intent.id,a.wallet).run();}catch{fail(409,'This transaction is already recorded for another request.');}
 return {ok:true,status:'confirmed',transactionHash:hash};
}
const snapshotCache=new Map<string,{until:number,result:Promise<any>}>();
export async function nftRoute(request:Request,e:NftEnv,a:any,body:()=>Promise<any>,now:number):Promise<Response|null>{
 e=resolveNftEnv(e);
 const url=new URL(request.url),path=url.pathname.replace(/^\/api/,'');
 if(path==='/nft'&&request.method==='GET'){const key=[e.NFT_RPC_URL||e.BSC_RPC_URL,e.NFT_COLLECTION,e.NFT_MARKETPLACE,e.NFT_LP_VAULT,e.NFT_COLLECTION_BIDS,e.NIB_VAULT_V2,e.NFT_FEE_RECIPIENT,a?.wallet||'public',url.search].join(':');let entry=snapshotCache.get(key);if(!entry||entry.until<=now){if(snapshotCache.size>=64)snapshotCache.clear();entry={until:now+5000,result:nftSnapshot(e,a?.wallet||null,url,now)};snapshotCache.set(key,entry);}try{return json(await entry.result);}catch(error){snapshotCache.delete(key);throw error;}}
 if(request.method==='POST')snapshotCache.clear();
 if(path.startsWith('/nft/metadata/')&&request.method==='GET')return json(nftMetadata(nftTokenId(path.split('/').pop())));
 if(path==='/nft/intents'&&request.method==='POST'){if(!a?.connected)fail(409,'Pair an eligible agent wallet before requesting NFT actions.');return json(await queue(e,a,await body(),now),201);}
 const match=path.match(/^\/nft\/intents\/([a-zA-Z0-9-]{1,80})\/(approve|cancel|receipt)$/);
 if(match&&request.method==='POST'){
  if(!a?.connected)fail(409,'Pair your agent before managing NFT requests.');const [,id,action]=match,b=await body(),i=await first(e,'SELECT * FROM nft_intents WHERE id=? AND wallet=?',id,a.wallet);if(!i)fail(404,'NFT request not found.');
  if(action==='receipt')return json(await nftReceipt(e,a,id,b.transactionHash,now));
  if(action==='approve'){
   if(b.requestId!==i.preview_request_id||b.txDigest!==digest(JSON.parse(i.transaction)))fail(409,'The preview changed. Review the current transaction first.');
   const r=await q(e,"UPDATE nft_intents SET status='approved',approved_at=? WHERE id=? AND wallet=? AND status='awaiting_approval' AND preview_expires_at>? AND expires_at>?",now,id,a.wallet,now+5000,now).run();if(!r.meta.changes)fail(409,'Preview expired or request changed. Ask your agent for a fresh preview.');
  }else{const r=await q(e,"UPDATE nft_intents SET status='cancelled',finished_at=? WHERE id=? AND wallet=? AND status IN ('queued','preparing','agent_preparing','awaiting_approval','approved')",now,id,a.wallet).run();if(!r.meta.changes)fail(409,'A submitted transaction cannot be cancelled from this queue.');}
  return json({ok:true});
 }
 return null;
}
export const NFT_ACTIONS=['nft-state','nft-request','nft-claim','nft-preview','nft-execute','nft-broadcast','nft-fail','nft-confirm'];
export function nftPreviewForReview(preview:any){return {
 requestId:preview.requestId,expiresAt:preview.expiresAt,
 parsedTransaction:preview.parsedTransaction||preview.parsedTx||preview.transaction||null,
 risks:preview.risks||{},simulationResult:preview.simulationResult||null,
 authorityChanges:{reported:preview.authorityChanges??null,simulation:preview.simulationResult?.authorityChanges??null},
 allowanceChanges:{reported:preview.allowanceChanges??null,simulation:preview.simulationResult?.allowanceChanges??null},
 gasLimit:preview.gasLimit??null,requireConfirmation:preview.requireConfirmation===true
};}
export async function nftAction(e:NftEnv,a:any,action:string,p:any,now:number){
 e=resolveNftEnv(e);
 if(action!=='nft-state')snapshotCache.clear();
 if(action==='nft-state')return {intents:await nftIntents(e,a.wallet,now)};
 if(action==='nft-request'){const b=typeof p==='object'&&p?p:{};return {intent:await queue(e,a,b,now,true),contracts:configured(e)};}
 const id=typeof p.intentId==='string'?p.intentId:'',i=await first(e,'SELECT * FROM nft_intents WHERE id=? AND wallet=?',id,a.wallet);if(!i)fail(404,'NFT request not found.');
 if(action==='nft-confirm')return nftReceipt(e,a,id,p.transactionHash,now);
 if(action==='nft-fail'){
  const uncertain=p.uncertain===true;if(!['queued','preparing','agent_preparing','awaiting_approval','approved','executing','app_confirmation','broadcast','needs_receipt'].includes(i.status))fail(409,'NFT request already finished.');if(!uncertain&&!['queued','preparing','agent_preparing','awaiting_approval','approved'].includes(i.status))fail(409,'A submitted transaction requires a verified receipt or uncertain-submission recovery.');
  if(uncertain&& !['executing','app_confirmation','broadcast','needs_receipt'].includes(i.status))fail(409,'Nothing has been submitted.');
  const error=uncertain?'Submission status uncertain. Recover the transaction hash; do not execute again.':p.code==='expired'?'Preview expired. Queue a fresh request.':p.code==='wallet'?'Binance wallet refused the operation. Check its app and agent output.':'Agent could not prepare this request. Check wallet balance, gas, eligibility and approvals.';
  await q(e,"UPDATE nft_intents SET status=?,error=?,finished_at=? WHERE id=? AND wallet=? AND status=?",uncertain?'needs_receipt':'failed',error,uncertain?null:now,id,a.wallet,i.status).run();return {ok:true};
 }
 if(action==='nft-claim'){
  if(i.expires_at<=now)fail(409,'Request expired.');if(!['queued','preparing','agent_preparing'].includes(i.status))fail(409,'Request is not queued.');if(i.status!=='agent_preparing')await q(e,"UPDATE nft_intents SET status='preparing' WHERE id=? AND wallet=? AND status='queued'",id,a.wallet).run();return {intent:serializeIntent(await first(e,'SELECT * FROM nft_intents WHERE id=?',id)),contracts:configured(e)};
 }
 if(action==='nft-preview'){
  if(!['preparing','agent_preparing'].includes(i.status)||i.expires_at<=now)fail(409,'Request is no longer being prepared.');const preview=p.preview;
  if(!preview||typeof preview.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(preview.requestId)||!Number.isSafeInteger(preview.expiresAt)||preview.expiresAt<=now||preview.expiresAt>now+10*60000||canonical(p.transaction)!==i.transaction||JSON.stringify(preview).length>10000)fail(400,'Invalid or mismatched transaction preview.');
  const safe=nftPreviewForReview(preview);
  await q(e,"UPDATE nft_intents SET status='awaiting_approval',preview=?,preview_request_id=?,preview_expires_at=? WHERE id=? AND wallet=? AND status IN ('preparing','agent_preparing')",canonical(safe),preview.requestId,Math.min(preview.expiresAt,i.expires_at),id,a.wallet).run();return {ok:true};
 }
 if(action==='nft-execute'){
  // Agent-started requests (payload.origin='agent') are approved by the user in chat; the connector only runs `execute --approve` after that yes.
  const agentOrigin=(()=>{try{return JSON.parse(i.payload).origin==='agent';}catch{return false;}})();
  const result=await q(e,`UPDATE nft_intents SET status='executing' WHERE id=? AND wallet=? AND status IN ('approved'${agentOrigin?",'awaiting_approval'":''}) AND preview_request_id=? AND preview_expires_at>? AND expires_at>? AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND connected=1 AND version=?)`,id,a.wallet,p.requestId,now,now,a.wallet,a.version).run();if(!result.meta.changes)fail(409,'Transaction is not approved, expired, or already executing.');return {intent:serializeIntent(await first(e,'SELECT * FROM nft_intents WHERE id=?',id)),contracts:configured(e)};
 }
 if(action==='nft-broadcast'){
  if(!['executing','app_confirmation','needs_receipt','broadcast'].includes(i.status))fail(409,'Transaction was not approved for execution.');
  const hash=typeof p.transactionHash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(p.transactionHash)?p.transactionHash:null,order=typeof p.orderId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(p.orderId)?p.orderId:null;
  if(!hash&&!order)fail(400,'A transaction hash or Binance confirmation order is required.');
  await q(e,"UPDATE nft_intents SET status=?,transaction_hash=?,order_id=? WHERE id=? AND wallet=? AND status IN ('executing','app_confirmation','needs_receipt','broadcast')",hash?'broadcast':'app_confirmation',hash,order,id,a.wallet).run();return {ok:true};
 }
 fail(400,'Unsupported NFT action.');
}
export function nftArtResponse(id:string){try{const n=nftTokenId(id.replace(/\.svg$/,''));return new Response(nftSvg(n),{headers:{'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=31536000, immutable','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox",'X-Content-Type-Options':'nosniff'}});}catch{return new Response('NFT not found',{status:404});}}
