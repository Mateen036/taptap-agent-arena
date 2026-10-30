import {decodeFunctionData,keccak256,toHex} from 'viem';
import {canonical} from '../lib/game';
import {NFT_PAYMENT,nativeMintBudget,marketQuote,nftAbi,nftMarketAbi,nftPaymentAbi} from '../lib/nft-protocol';
type Bridge={action:(s:any,kind:string,payload?:any)=>Promise<any>;baw:(argv:string[])=>any;persist:(s:any)=>void};
export const txDigest=(t:any)=>keccak256(toHex(canonical(t)));
const same=(a:any,b:any)=>String(a).toLowerCase()===String(b).toLowerCase();
export function validateNftTransaction(intent:any,contracts:any,wallet:string){
 const tx=intent.transaction,p=intent.payload;
 if(tx.chainId!==56||!same(tx.from,wallet)||typeof tx.value!=='string'||!/^(0|[1-9][0-9]*)$/.test(tx.value)||!/^0x[0-9a-f]+$/i.test(tx.data))throw Error('NFT transaction envelope does not match this wallet.');
 const nativeMint=intent.kind==='mint'&&p.currency==='BNB';
 const isBid=intent.kind==='bid',isBuy=intent.kind==='buy';
 const expectedValue=nativeMint?p.costRaw:isBid||isBuy?marketQuote(BigInt(p.priceRaw)).buyerTotal.toString():'0';
 if(tx.value!==expectedValue||(isBid||isBuy)&&p.buyerTotalRaw!==expectedValue)throw Error('Native BNB value differs from the exact request including fees.');
 if(nativeMint&&nativeMintBudget(BigInt(p.quotedCostRaw)).toString()!==p.costRaw)throw Error('BNB mint quote ceiling changed.');
 const approval=intent.kind==='mint-approval',onCollection=['nft-approval','mint'].includes(intent.kind);
 const abi=approval?nftPaymentAbi:onCollection?nftAbi:nftMarketAbi;
 const destination=approval?NFT_PAYMENT:onCollection?contracts.collection:contracts.market;
 if(!same(tx.to,destination))throw Error('NFT transaction targets an unexpected contract.');
 const decoded:any=decodeFunctionData({abi,data:tx.data}),args=decoded.args||[],name=decoded.functionName;
 const expected:any={'mint-approval':'approve','nft-approval':'approve',mint:nativeMint?'mintBNB':'mint',list:'list',cancel:'cancel',buy:'buy',bid:'placeBid','cancel-bid':'cancelBid','accept-bid':'acceptBid','withdraw-bid-refund':'withdrawRefund'};
 if(!expected[intent.kind]||name!==expected[intent.kind])throw Error('NFT transaction function does not match the requested action.');
 if(approval){if(!same(args[0],contracts.collection)||String(args[1])!==String(p.costRaw))throw Error('USDT approval exceeds or differs from the exact request.');}
 else if(intent.kind==='nft-approval'){if(!same(args[0],contracts.market)||Number(args[1])!==p.tokenId)throw Error('Unexpected NFT approval.');}
 else if(intent.kind==='mint'){if(Number(args[0])!==p.quantity||String(args[1])!==p.costRaw||Number(args[2])!==Math.floor(intent.expires_at/1000)||args[3]!==keccak256(toHex(intent.id)))throw Error('Mint quote or operation ID changed.');}
 else if(intent.kind==='cancel-bid'){if(String(args[0])!==p.bidId||!same(p.bidder,wallet))throw Error('Cancellation bid changed.');}
 else if(intent.kind==='accept-bid'){if(String(args[0])!==p.bidId||!same(args[1],p.bidder)||String(args[2])!==p.priceRaw||!same(p.seller,wallet)||Number(args[3])!==Math.floor(intent.expires_at/1000))throw Error('Bid acceptance terms changed.');}
 else if(intent.kind==='withdraw-bid-refund'){if(String(args[0])!==p.amountRaw||!same(args[1],wallet)||!same(p.recipient,wallet))throw Error('Refund amount or recipient changed.');}
 else{
  if(Number(args[0])!==p.tokenId)throw Error('Unexpected NFT token ID.');
  if(['list','bid'].includes(intent.kind)&&(String(args[1])!==p.priceRaw||Number(args[2])!==Math.floor(intent.created_at/1000)+p.days*86400))throw Error('Listing or bid terms changed.');
  if(isBid&&!same(args[3],p.seller))throw Error('Bid target owner changed.');
  if(intent.kind==='cancel'&&String(args[1])!==p.listingId)throw Error('Cancellation listing changed.');
  if(isBuy&&(String(args[1])!==p.listingId||String(args[2])!==p.priceRaw||!same(args[3],p.seller)||Number(args[4])!==Math.floor(intent.expires_at/1000)))throw Error('Purchase price, seller, or expiry changed.');
 }
 return true;
}
export function developerMode(baw:Bridge['baw']){
 const status=baw(['wallet','status']);if(status.status!=='CONNECTED')throw Error('Sign in to Binance before an NFT transaction.');
 const settings=baw(['wallet','settings']),raw=settings.devMode?.expiresAt,n=Number(raw),expiry=typeof raw==='string'&&!/^\d+$/.test(raw)?Date.parse(raw):n<1e12?n*1000:n;
 if(!settings.devMode?.enabled||!Number.isFinite(expiry)||expiry<Date.now())throw Error('Enable Developer Mode in Binance Agentic Wallet settings.');
 const addresses=baw(['wallet','address']).addresses;return addresses.find((a:any)=>String(a.binanceChainId)==='56')?.address;
}
export function findOrderHash(value:any,order:string,depth=0):string|null{
 if(!value||typeof value!=='object'||depth>7)return null;
 if(value.orderId===order||value.id===order){for(const key of ['txHash','transactionHash','hash'])if(/^0x[0-9a-f]{64}$/i.test(value[key]||''))return value[key];}
 for(const v of Object.values(value)){if(v&&typeof v==='object'){const hash=findOrderHash(v,order,depth+1);if(hash)return hash;}}return null;
}
/** Main wallet calls are separate from the game key and require an exact browser approval. */
export async function processNftIntent(s:any,intents:any[],bridge:Bridge):Promise<boolean>{
 const {action,baw,persist}=bridge;
 const work=intents.filter(i=>i.payload?.origin!=='agent'&&['queued','preparing','approved','executing','broadcast','app_confirmation'].includes(i.status)).sort((a,b)=>(a.status==='approved'?-1:0)-(b.status==='approved'?-1:0)||a.created_at-b.created_at);
 s.nftPreviews??={};s.nftExecutions??={};
 for(const intent of work){
  const id=intent.id,journal=s.nftExecutions[id];
  if(intent.status==='broadcast'&&intent.transaction_hash){try{const r=await action(s,'nft-confirm',{intentId:id,transactionHash:intent.transaction_hash});console.log(JSON.stringify({nftTask:id,status:r.status}));}catch(error:any){if(error.status!==409)console.error('NFT receipt: '+error.message);}continue;}
  if(intent.status==='app_confirmation'){
   if((s.nftHistoryCheckedAt||0)>Date.now()-15000)continue;s.nftHistoryCheckedAt=Date.now();persist(s);
   try{const history=baw(['wallet','tx-history','--binanceChainId','56','--size','20']);const hash=findOrderHash(history,intent.order_id);if(hash){await action(s,'nft-broadcast',{intentId:id,orderId:intent.order_id,transactionHash:hash});return true;}}catch{}
   continue;
  }
  if(intent.status==='executing'){
   if(journal?.response){const r=journal.response;if(r.txHash||r.transactionHash||r.orderId){await action(s,'nft-broadcast',{intentId:id,transactionHash:r.txHash||r.transactionHash,orderId:r.orderId});return true;}}
   await action(s,'nft-fail',{intentId:id,uncertain:true});console.error('NFT submission needs recovery. Never retry an uncertain execution automatically.');return true;
  }
  if(intent.status==='queued'||intent.status==='preparing'){
   try{
    const claimed=await action(s,'nft-claim',{intentId:id}),i=claimed.intent;validateNftTransaction(i,claimed.contracts,s.wallet);
    if(!same(developerMode(baw),s.wallet))throw Error('The connected Binance wallet differs from the paired game wallet.');
    const tx=i.transaction;const preview=baw(['contract-call','preview','--binanceChainId','56','--from',s.wallet,'--to',tx.to,'--value',tx.value,'--inputData',tx.data]);
    if(!preview.requestId)throw Error('Binance did not return a usable preview.');
    const n=Number(preview.expiresAt),expiresAt=Number.isFinite(n)?(n<1e12?n*1000:n):Date.now()+180000;
    s.nftPreviews[id]={requestId:preview.requestId,txDigest:txDigest(tx),expiresAt};persist(s);
    await action(s,'nft-preview',{intentId:id,transaction:tx,preview:{...preview,expiresAt}});
    console.log(JSON.stringify({nftTask:id,status:'awaiting_approval',summary:i.summary,transaction:tx,preview,instruction:'Review this exact transaction in TapTap and explicitly approve it. This is not authorized by your game-only session.'}));return true;
   }catch(error:any){if(error.status===401)throw error;try{await action(s,'nft-fail',{intentId:id,code:'wallet'});}catch{}console.error('NFT preview failed: '+error.message);return true;}
  }
  if(intent.status==='approved'){
   const local=s.nftPreviews[id];
   if(!local||local.requestId!==intent.preview_request_id||local.txDigest!==txDigest(intent.transaction)||local.expiresAt<=Date.now()||journal){await action(s,'nft-fail',{intentId:id,code:'expired'});console.error('NFT approval has no matching local preview. Queue a new request.');return true;}
   try{if(!same(developerMode(baw),s.wallet))throw Error('Connected Binance wallet changed.');}catch(error:any){await action(s,'nft-fail',{intentId:id,code:'wallet'});console.error(error.message);return true;}
   // Consume the server approval and persist BEFORE calling Binance, so crashes cannot double-submit.
   const claimed=await action(s,'nft-execute',{intentId:id,requestId:local.requestId});validateNftTransaction(claimed.intent,claimed.contracts,s.wallet);
   s.nftExecutions[id]={requestId:local.requestId,startedAt:Date.now()};persist(s);
   try{
    const response=baw(['contract-call','execute','--requestId',local.requestId]);s.nftExecutions[id].response=response;persist(s);
    if(!response.txHash&&!response.transactionHash&&!response.orderId)throw Error('Binance returned no transaction hash or confirmation order.');
    await action(s,'nft-broadcast',{intentId:id,transactionHash:response.txHash||response.transactionHash,orderId:response.orderId});
    console.log(JSON.stringify({nftTask:id,status:response.status,transactionHash:response.txHash||response.transactionHash,appConfirmation:response.status==='PENDING_CONFIRMATION'}));
   }catch(error:any){try{await action(s,'nft-fail',{intentId:id,uncertain:true});}catch{}console.error('NFT execution needs receipt recovery: '+error.message);}
   return true;
  }
 }
 return false;
}
