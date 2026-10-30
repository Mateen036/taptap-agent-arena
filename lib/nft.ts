import {createPublicClient,http,isAddress,formatUnits,keccak256,toHex} from 'viem';
import {bsc} from 'viem/chains';
import {AGENT_ID_REGISTRY} from './protocol';
import {canonical} from './game';
import {nftTraits,nftMetadata,nftSvg} from './nft-art';
import {nftAbi,nftMarketAbi,nftPaymentAbi,nftVaultAbi,nftConfig,NFT_PAYMENT,NFT_ROUTER,NFT_NATIVE,NFT_WBNB,NFT_PRICE_FEED,nativeMintBudget,nftCall,nftPrice as rawPrice,nftTokenId as rawTokenId,type NftTransaction,type NftAddresses} from './nft-protocol';
export type NftEnv={DB:D1Database;BSC_RPC_URL?:string;NFT_RPC_URL?:string;NFT_COLLECTION?:string;NFT_MARKETPLACE?:string;NFT_LP_VAULT?:string};
export class NftError extends Error{constructor(public status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new NftError(status,message);};
const nftTokenId=(v:any)=>{try{return rawTokenId(v)}catch(error){return fail(400,(error as Error).message)}};
const nftPrice=(v:any)=>{try{return rawPrice(v)}catch(error){return fail(400,(error as Error).message)}};
const q=(e:NftEnv,sql:string,...args:any[])=>e.DB.prepare(sql).bind(...args);
const first=(e:NftEnv,sql:string,...args:any[])=>q(e,sql,...args).first<any>();
const rows=async(e:NftEnv,sql:string,...args:any[])=>(await q(e,sql,...args).all<any>()).results;
const json=(d:any,status=200)=>new Response(JSON.stringify(d,(_,v)=>typeof v==='bigint'?v.toString():v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const identityAbi=[{type:'function',name:'balanceOf',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]}] as const;
const client=(e:NftEnv)=>createPublicClient({chain:bsc,transport:http(e.NFT_RPC_URL||e.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:10000,retryCount:1})});
const digest=(tx:NftTransaction)=>keccak256(toHex(canonical(tx)));
const read=async(c:any,address:string,abi:any,name:string,args:any[]=[])=>c.readContract({address,abi,functionName:name,args});
function configured(e:NftEnv):NftAddresses{try{const config=nftConfig(e);if(!config)throw new NftError(409,'Collection contracts are awaiting mainnet deployment. No mint or trade can be submitted yet.');return config;}catch(error){if(error instanceof NftError)throw error;throw new NftError(503,'NFT contract configuration is incomplete.');}}

const checked=new Map<string,number>();
async function chain(e:NftEnv){
 const config=configured(e),c=client(e),cacheKey=[e.NFT_RPC_URL||e.BSC_RPC_URL,...Object.values(config)].join(':');
 if((checked.get(cacheKey)||0)<Date.now()){
  try{
   const values=await Promise.all([c.getChainId(),read(c,config.collection,nftAbi,'paymentToken'),read(c,config.collection,nftAbi,'lpVault'),read(c,config.collection,nftAbi,'MAX_SUPPLY'),read(c,config.collection,nftAbi,'WALLET_LIMIT'),read(c,config.collection,nftAbi,'mintPrice'),read(c,config.collection,nftAbi,'agentIdRegistry'),read(c,config.market,nftMarketAbi,'collection'),read(c,config.market,nftMarketAbi,'paymentToken'),read(c,config.market,nftMarketAbi,'agentIdRegistry'),read(c,config.vault,nftVaultAbi,'paymentToken'),read(c,config.vault,nftVaultAbi,'router'),read(c,config.collection,nftAbi,'priceFeed'),read(c,config.vault,nftVaultAbi,'wrappedNative')]);
   const same=(a:any,b:string)=>String(a).toLowerCase()===b.toLowerCase();
   if(values[0]!==56||!same(values[1],NFT_PAYMENT)||!same(values[2],config.vault)||BigInt(values[3])!==10000n||BigInt(values[4])!==10n||BigInt(values[5])!==10n**18n||!same(values[6],AGENT_ID_REGISTRY)||!same(values[7],config.collection)||!same(values[8],NFT_NATIVE)||!same(values[9],AGENT_ID_REGISTRY)||!same(values[10],NFT_PAYMENT)||!same(values[11],NFT_ROUTER)||!same(values[12],NFT_PRICE_FEED)||!same(values[13],NFT_WBNB))fail(503,'NFT contracts do not match the published collection rules.');
   if(checked.size>32)checked.clear();checked.set(cacheKey,Date.now()+60000);
  }catch(error){if(error instanceof NftError)throw error;fail(503,'BNB Chain NFT verification is unavailable. Try again shortly.');}
 }
 return {c,config};
}
// Ownership is read at one current block for each access/earning check; it is not session-cached.
export async function nftGameHolding(e:NftEnv,wallet:string):Promise<{owned:number;block:string;identityEligible:boolean}>{
 const {c,config}=await chain(e);
 try{const block=await c.getBlockNumber({cacheTime:0});const [held,identity]=await Promise.all([c.readContract({address:config.collection as `0x${string}`,abi:nftAbi,functionName:'balanceOf',args:[wallet as `0x${string}`],blockNumber:block}),c.readContract({address:AGENT_ID_REGISTRY,abi:identityAbi,functionName:'balanceOf',args:[wallet as `0x${string}`],blockNumber:block})]);if(held>10000n)fail(503,'Collection holdings exceed the verified supply.');return {owned:Number(held),block:block.toString(),identityEligible:identity>0n};}catch(error){if(error instanceof NftError)throw error;return fail(503,'NFT ownership verification is unavailable. No points were awarded.');}
}
const asset=(id:number)=>({id,name:'Nib #'+String(id).padStart(5,'0'),image:'/api/nft/preview/v2/'+id+'.png',originalImage:'/api/nft/art/v2/'+id+'.svg',traits:nftTraits(id)});
const serializeIntent=(v:any)=>({...v,payload:JSON.parse(v.payload),transaction:JSON.parse(v.transaction),summary:JSON.parse(v.summary),preview:v.preview?JSON.parse(v.preview):null,txDigest:digest(JSON.parse(v.transaction))});
export async function nftIntents(e:NftEnv,wallet:string,now:number){
 await q(e,"UPDATE nft_intents SET status='expired',error='The request expired. Queue a fresh request.',finished_at=? WHERE wallet=? AND status IN ('queued','preparing','awaiting_approval','approved') AND expires_at<=?",now,wallet,now).run();
 return (await rows(e,'SELECT * FROM nft_intents WHERE wallet=? ORDER BY CASE WHEN status IN (\'queued\',\'preparing\',\'awaiting_approval\',\'approved\',\'executing\',\'app_confirmation\',\'needs_receipt\',\'broadcast\') THEN 0 ELSE 1 END,created_at DESC LIMIT 20',wallet)).map(serializeIntent);
}
async function listing(c:any,market:string,id:number){const [l,available]=await Promise.all([read(c,market,nftMarketAbi,'listings',[BigInt(id)]),read(c,market,nftMarketAbi,'available',[BigInt(id)])]);return {tokenId:id,listingId:String(l[0]),seller:String(l[1]).toLowerCase(),priceRaw:String(l[2]),price:formatUnits(BigInt(l[2]),18),expiresAt:Number(l[3])*1000,available,...asset(id)};}
export async function nftSnapshot(e:NftEnv,wallet:string|null,url:URL,now:number){
 const page=Math.max(0,Math.min(833,Number(url.searchParams.get('page'))||0)),offset=Math.floor(page)*12;
 const gallery=Array.from({length:Math.min(12,10000-offset)},(_,i)=>asset(offset+i+1));
 const base={name:'Nib Collection',supply:10000,walletLimit:10,freePerWallet:1,paidPrice:'1',paidPriceCurrency:'USD',mintPaymentSymbols:['USDT','BNB'],marketPaymentSymbol:'BNB',paymentToken:NFT_PAYMENT,priceFeed:NFT_PRICE_FEED,chainId:56,artMode:'fully-onchain',gallery,galleryPage:Math.floor(page),galleryPages:834,token:'TBA',marketFeeBps:0};
 if(!nftConfig(e))return {...base,status:'awaiting_deployment',configured:false,notice:'The art and agent flows are ready. Mainnet contracts need deployment and activation before minting or trading.',minted:0,mintOpen:false,listings:[],owned:[],wallet:null,intents:wallet?await nftIntents(e,wallet,now):[]};
 const {c,config}=await chain(e);
 const [minted,open,paused,count,volume,sales,funds,token,added,locked,wrappedFunds,bnbAdded,bnbLocked]=await Promise.all([read(c,config.collection,nftAbi,'minted'),read(c,config.collection,nftAbi,'mintOpen'),read(c,config.collection,nftAbi,'paused'),read(c,config.market,nftMarketAbi,'activeCount'),read(c,config.market,nftMarketAbi,'volume'),read(c,config.market,nftMarketAbi,'completedSales'),read(c,NFT_PAYMENT,nftPaymentAbi,'balanceOf',[config.vault]),read(c,config.vault,nftVaultAbi,'liquidityToken'),read(c,config.vault,nftVaultAbi,'paymentAdded'),read(c,config.vault,nftVaultAbi,'lpTokensLocked'),read(c,NFT_WBNB,nftPaymentAbi,'balanceOf',[config.vault]),read(c,config.vault,nftVaultAbi,'bnbAdded'),read(c,config.vault,nftVaultAbi,'lpTokensLockedBNB')]);
 let bnbPriceRaw:string|null=null;try{bnbPriceRaw=String(await read(c,config.collection,nftAbi,'mintPriceBNB'));}catch{}
 const marketOffset=Math.max(0,Math.floor(Number(url.searchParams.get('marketPage'))||0))*12;
 const ids=await Promise.all(Array.from({length:Math.max(0,Math.min(12,Number(count)-marketOffset))},(_,i)=>read(c,config.market,nftMarketAbi,'activeAt',[BigInt(i+marketOffset)])));
 const listings=await Promise.all(ids.map(id=>listing(c,config.market,Number(id))));
 let mine:any=null,owned:any[]=[];
 if(wallet){
  const [used,held,balance,identity,mintAllowance,bnbBalance]=await Promise.all([read(c,config.collection,nftAbi,'mintedBy',[wallet]),read(c,config.collection,nftAbi,'balanceOf',[wallet]),read(c,NFT_PAYMENT,nftPaymentAbi,'balanceOf',[wallet]),read(c,AGENT_ID_REGISTRY,identityAbi,'balanceOf',[wallet]),read(c,NFT_PAYMENT,nftPaymentAbi,'allowance',[wallet,config.collection]),c.getBalance({address:wallet as `0x${string}`})]);
  const ownedOffset=Math.max(0,Math.floor(Number(url.searchParams.get('ownedPage'))||0))*12;
  const ownedIds=await Promise.all(Array.from({length:Math.max(0,Math.min(12,Number(held)-ownedOffset))},(_,i)=>read(c,config.collection,nftAbi,'tokenOfOwnerByIndex',[wallet,BigInt(i+ownedOffset)])));
  owned=await Promise.all(ownedIds.map(async id=>({...asset(Number(id)),listing:await listing(c,config.market,Number(id))})));
  mine={minted:Number(used),remaining:10-Number(used),owned:Number(held),freeAvailable:BigInt(used)===0n,paymentBalance:formatUnits(BigInt(balance),18),eligible:BigInt(identity)>0n,mintAllowanceRaw:String(mintAllowance),bnbBalance:formatUnits(BigInt(bnbBalance),18)};
 }
 return {...base,status:open&&!paused?'live':'paused',configured:true,bnbPriceRaw,bnbQuoteBufferBps:100,contracts:config,minted:Number(minted),mintOpen:open&&!paused,listings:listings.filter(v=>v.available),marketPage:marketOffset/12,marketSlots:Number(count),owned,wallet:mine,intents:wallet?await nftIntents(e,wallet,now):[],lp:{wrappedBNB:NFT_WBNB,bnbBalance:formatUnits(BigInt(wrappedFunds),18),bnbAdded:formatUnits(BigInt(bnbAdded),18),lockedBNBRaw:String(bnbLocked),balance:formatUnits(BigInt(funds),18),paymentAdded:formatUnits(BigInt(added),18),lockedRaw:String(locked),token:String(token),tokenConfigured:String(token)!=='0x0000000000000000000000000000000000000000',vault:config.vault,router:NFT_ROUTER},market:{completedSales:Number(sales),volume:formatUnits(BigInt(volume),18)}};
}
async function queue(e:NftEnv,a:any,b:any,now:number){
 const {c,config}=await chain(e),kind=String(b.kind),wallet=a.wallet as `0x${string}`,payload:any={};let tx:NftTransaction,summary:any;
 if(BigInt(await read(c,AGENT_ID_REGISTRY,identityAbi,'balanceOf',[wallet]))===0n)fail(403,'This wallet needs a Binance Agent ID on BNB Chain.');
 const id=crypto.randomUUID(),expires=now+20*60000,deadline=BigInt(Math.floor(expires/1000));
 if(kind==='mint'||kind==='mint-approval'){
  const currency=b.currency===undefined?'USDT':String(b.currency);if(!['USDT','BNB'].includes(currency))fail(400,'Choose USDT or BNB for minting.');if(kind==='mint-approval'&&currency!=='USDT')fail(400,'BNB minting needs no token approval.');
  const quantity=Number(b.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>10)fail(400,'Choose 1–10 NFTs.');
  const [used,total,open,paused]=await Promise.all([read(c,config.collection,nftAbi,'mintedBy',[wallet]),read(c,config.collection,nftAbi,'minted'),read(c,config.collection,nftAbi,'mintOpen'),read(c,config.collection,nftAbi,'paused')]);
  if(!open||paused)fail(409,'Minting is paused.');if(Number(used)+quantity>10)fail(409,'This wallet has reached its lifetime mint limit.');if(Number(total)+quantity>10000)fail(409,'Not enough collection supply remains.');
  const paid=quantity-(BigInt(used)===0n?1:0);let cost=BigInt(paid)*10n**18n;
  payload.quantity=quantity;payload.currency=currency;
  if(currency==='BNB'){
   let quote:bigint;try{quote=BigInt(await read(c,config.collection,nftAbi,'mintCostBNB',[wallet,BigInt(quantity)]));}catch{return fail(503,'The BNB/USD price is unavailable or stale. Try USDT, or retry when the feed recovers.');}
   cost=nativeMintBudget(quote);payload.quotedCostRaw=quote.toString();payload.costRaw=cost.toString();
   if(await c.getBalance({address:wallet})<cost)fail(409,'Not enough BNB for the mint payment. Additional BNB is also needed for network gas.');
   tx=nftCall(wallet,config.collection,nftAbi,'mintBNB',[BigInt(quantity),cost,deadline,keccak256(toHex(id))],cost);
   summary={title:'Mint '+quantity+' Nib NFT'+(quantity===1?'':'s')+' with BNB',payment:formatUnits(cost,18),quotedPayment:formatUnits(quote,18),currency:'BNB',quantity,scope:'At most the displayed BNB value: $1 per paid NFT at the on-chain BNB/USD price, with a 1% quote ceiling. Unused BNB is refunded in the same transaction; mint proceeds go to the LP vault as WBNB.'};
  }else{
   payload.costRaw=cost.toString();
   if(kind==='mint-approval'){
    if(cost===0n)fail(409,'Your first mint requires no USDT approval.');tx=nftCall(wallet,NFT_PAYMENT,nftPaymentAbi,'approve',[config.collection,cost]);summary={title:'Approve exact mint payment',payment:formatUnits(cost,18),currency:'USDT',spender:config.collection,scope:'USDT allowance for this mint amount only. This transaction does not mint.'};
   }else{
    const allowance=await read(c,NFT_PAYMENT,nftPaymentAbi,'allowance',[wallet,config.collection]);if(BigInt(allowance)<cost)fail(409,'Approve the exact USDT payment first, then request the mint.');
    tx=nftCall(wallet,config.collection,nftAbi,'mint',[BigInt(quantity),cost,deadline,keccak256(toHex(id))]);summary={title:'Mint '+quantity+' Nib Collection NFT'+(quantity===1?'':'s'),payment:formatUnits(cost,18),currency:'USDT',quantity,scope:'NFTs minted to your agent wallet; primary sale payment goes directly to the LP vault.'};
   }
  }
 }else if(['nft-approval','list','buy','cancel'].includes(kind)){
  const tokenId=nftTokenId(b.tokenId);payload.tokenId=tokenId;payload.currency='BNB';const l=await listing(c,config.market,tokenId);
  if(['nft-approval','list','cancel'].includes(kind)){
   const owner=String(await read(c,config.collection,nftAbi,'ownerOf',[BigInt(tokenId)])).toLowerCase();if(owner!==wallet)fail(403,'Only the NFT owner can request this action.');
   if(kind==='nft-approval'){tx=nftCall(wallet,config.collection,nftAbi,'approve',[config.market,BigInt(tokenId)]);summary={title:'Approve Nib #'+tokenId+' for trading',payment:'0',tokenId,spender:config.market,scope:'Approval for this NFT only. No collection-wide approval.'};}
   else if(kind==='cancel'){payload.listingId=l.listingId;if(l.seller!==wallet||l.listingId==='0')fail(409,'No listing owned by this wallet.');tx=nftCall(wallet,config.market,nftMarketAbi,'cancel',[BigInt(tokenId),BigInt(l.listingId)]);summary={title:'Cancel Nib #'+tokenId+' listing',payment:'0',tokenId,scope:'Removes your listing. Does not transfer the NFT.'};}
   else{
    const price=nftPrice(b.price),days=Number(b.days||7);if(!Number.isInteger(days)||days<1||days>30)fail(400,'Choose a listing duration of 1–30 days.');
    if(String(await read(c,config.collection,nftAbi,'getApproved',[BigInt(tokenId)])).toLowerCase()!==config.market.toLowerCase())fail(409,'Approve this individual NFT for the marketplace first.');
    payload.priceRaw=price.toString();payload.days=days;tx=nftCall(wallet,config.market,nftMarketAbi,'list',[BigInt(tokenId),price,BigInt(Math.floor(now/1000)+days*86400)]);summary={title:'List Nib #'+tokenId,payment:'0',salePrice:formatUnits(price,18),tokenId,days,scope:'BNB-only noncustodial listing; your NFT stays in your wallet until purchased by an eligible agent.'};
   }
  }else{
   if(!l.available||l.seller===wallet)fail(409,'This listing is no longer available to this wallet.');
   if(String(b.listingId)!==l.listingId||String(b.priceRaw)!==l.priceRaw)fail(409,'The listing changed. Review the latest price first.');
   payload.listingId=l.listingId;payload.priceRaw=l.priceRaw;payload.seller=l.seller;
   if(await c.getBalance({address:wallet})<BigInt(l.priceRaw))fail(409,'Not enough BNB for this purchase. Network gas is additional.');
   tx=nftCall(wallet,config.market,nftMarketAbi,'buy',[BigInt(tokenId),BigInt(l.listingId),BigInt(l.priceRaw),l.seller,deadline],BigInt(l.priceRaw));summary={title:'Buy Nib #'+tokenId,payment:l.price,tokenId,seller:l.seller,scope:'Exact BNB price paid to the seller; the NFT transfers atomically to your agent wallet. No USDT approval. Marketplace fee: 0%.'};
  }
  summary.currency='BNB';
 }else fail(400,'Unsupported NFT task. Marketplace purchases use BNB and need no USDT approval.');
 const result=await e.DB.batch([q(e,"INSERT INTO nft_intents(id,wallet,kind,payload,\"transaction\",summary,created_at,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM nft_intents WHERE wallet=? AND status IN ('queued','preparing','awaiting_approval','approved','executing','app_confirmation','needs_receipt','broadcast'))<4 AND (SELECT COUNT(*) FROM nft_intents WHERE wallet=? AND created_at>?)<12 AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND connected=1 AND version=?)",id,wallet,kind,canonical(payload),canonical(tx!),canonical({...summary!,networkFee:'BNB network gas is additional, including on a free mint.'}),now,expires,wallet,wallet,now-60000,wallet,a.version)]);
 if(!result[0].meta.changes)fail(429,'Finish or cancel existing NFT requests before adding another.');return serializeIntent(await first(e,'SELECT * FROM nft_intents WHERE id=?',id));
}
export async function nftReceipt(e:NftEnv,a:any,intentId:string,hash:any,now:number){
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
 const url=new URL(request.url),path=url.pathname.replace(/^\/api/,'');
 if(path==='/nft'&&request.method==='GET'){const key=[e.NFT_RPC_URL||e.BSC_RPC_URL,e.NFT_COLLECTION,e.NFT_MARKETPLACE,e.NFT_LP_VAULT,a?.wallet||'public',url.search].join(':');let entry=snapshotCache.get(key);if(!entry||entry.until<=now){if(snapshotCache.size>=64)snapshotCache.clear();entry={until:now+5000,result:nftSnapshot(e,a?.wallet||null,url,now)};snapshotCache.set(key,entry);}try{return json(await entry.result);}catch(error){snapshotCache.delete(key);throw error;}}
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
  }else{const r=await q(e,"UPDATE nft_intents SET status='cancelled',finished_at=? WHERE id=? AND wallet=? AND status IN ('queued','preparing','awaiting_approval','approved')",now,id,a.wallet).run();if(!r.meta.changes)fail(409,'A submitted transaction cannot be cancelled from this queue.');}
  return json({ok:true});
 }
 return null;
}
export const NFT_ACTIONS=['nft-state','nft-claim','nft-preview','nft-execute','nft-broadcast','nft-fail','nft-confirm'];
export function nftPreviewForReview(preview:any){return {
 requestId:preview.requestId,expiresAt:preview.expiresAt,
 parsedTransaction:preview.parsedTransaction||preview.parsedTx||preview.transaction||null,
 risks:preview.risks||{},simulationResult:preview.simulationResult||null,
 authorityChanges:{reported:preview.authorityChanges??null,simulation:preview.simulationResult?.authorityChanges??null},
 allowanceChanges:{reported:preview.allowanceChanges??null,simulation:preview.simulationResult?.allowanceChanges??null},
 gasLimit:preview.gasLimit??null,requireConfirmation:preview.requireConfirmation===true
};}
export async function nftAction(e:NftEnv,a:any,action:string,p:any,now:number){
 if(action!=='nft-state')snapshotCache.clear();
 if(action==='nft-state')return {intents:await nftIntents(e,a.wallet,now)};
 const id=typeof p.intentId==='string'?p.intentId:'',i=await first(e,'SELECT * FROM nft_intents WHERE id=? AND wallet=?',id,a.wallet);if(!i)fail(404,'NFT request not found.');
 if(action==='nft-confirm')return nftReceipt(e,a,id,p.transactionHash,now);
 if(action==='nft-fail'){
  const uncertain=p.uncertain===true;if(!['queued','preparing','awaiting_approval','approved','executing','app_confirmation','broadcast','needs_receipt'].includes(i.status))fail(409,'NFT request already finished.');if(!uncertain&&!['queued','preparing','awaiting_approval','approved'].includes(i.status))fail(409,'A submitted transaction requires a verified receipt or uncertain-submission recovery.');
  if(uncertain&& !['executing','app_confirmation','broadcast','needs_receipt'].includes(i.status))fail(409,'Nothing has been submitted.');
  const error=uncertain?'Submission status uncertain. Recover the transaction hash; do not execute again.':p.code==='expired'?'Preview expired. Queue a fresh request.':p.code==='wallet'?'Binance wallet refused the operation. Check its app and agent output.':'Agent could not prepare this request. Check wallet balance, gas, eligibility and approvals.';
  await q(e,"UPDATE nft_intents SET status=?,error=?,finished_at=? WHERE id=? AND wallet=? AND status=?",uncertain?'needs_receipt':'failed',error,uncertain?null:now,id,a.wallet,i.status).run();return {ok:true};
 }
 if(action==='nft-claim'){
  if(i.expires_at<=now)fail(409,'Request expired.');if(!['queued','preparing'].includes(i.status))fail(409,'Request is not queued.');await q(e,"UPDATE nft_intents SET status='preparing' WHERE id=? AND wallet=? AND status='queued'",id,a.wallet).run();return {intent:serializeIntent(await first(e,'SELECT * FROM nft_intents WHERE id=?',id)),contracts:configured(e)};
 }
 if(action==='nft-preview'){
  if(i.status!=='preparing'||i.expires_at<=now)fail(409,'Request is no longer being prepared.');const preview=p.preview;
  if(!preview||typeof preview.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(preview.requestId)||!Number.isSafeInteger(preview.expiresAt)||preview.expiresAt<=now||preview.expiresAt>now+10*60000||canonical(p.transaction)!==i.transaction||JSON.stringify(preview).length>10000)fail(400,'Invalid or mismatched transaction preview.');
  const safe=nftPreviewForReview(preview);
  await q(e,"UPDATE nft_intents SET status='awaiting_approval',preview=?,preview_request_id=?,preview_expires_at=? WHERE id=? AND wallet=? AND status='preparing'",canonical(safe),preview.requestId,Math.min(preview.expiresAt,i.expires_at),id,a.wallet).run();return {ok:true};
 }
 if(action==='nft-execute'){
  const result=await q(e,"UPDATE nft_intents SET status='executing' WHERE id=? AND wallet=? AND status='approved' AND preview_request_id=? AND preview_expires_at>? AND expires_at>? AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND connected=1 AND version=?)",id,a.wallet,p.requestId,now,now,a.wallet,a.version).run();if(!result.meta.changes)fail(409,'Transaction is not approved, expired, or already executing.');return {intent:serializeIntent(await first(e,'SELECT * FROM nft_intents WHERE id=?',id)),contracts:configured(e)};
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
