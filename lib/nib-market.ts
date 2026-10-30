import {createPublicClient,http,fallback,parseAbi,parseAbiItem,encodeFunctionData,formatUnits,parseUnits,isAddress} from 'viem';
import {bsc} from 'viem/chains';
import {requireGameAccess,type UtilityEnv} from './utility';
import {logRpcUrls,SALES_TTL_MS,SALES_CHUNK,SALES_OVERLAP,type SalesEnv} from './nft-market';
import {NIB_TOKEN} from './airdrop';
// NIB pre-market: bid-only order book backed by BNB escrow in NibBidMarket. Sellers cannot list; they sell by accepting a bid.
export class NibMarketError extends Error{constructor(public status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new NibMarketError(status,message);};
export type NibMarketEnv=UtilityEnv&SalesEnv&{NIB_BID_MARKET?:string;NIB_TOKEN?:string;NIB_MARKET_FROM_BLOCK?:string};
export const NIB_MARKET_ACTIONS=['nib-market-state','nib-bid-place','nib-bid-cancel','nib-bid-accept'];
export const BUYER_FEE_BPS=200n,SELLER_FEE_BPS=200n,BPS=10000n,E18=10n**18n,MIN_BID_BNB=10n**15n,MAX_NIB_PER_BID=10n**9n*E18,MAX_EXPIRY_SECONDS=365*86400;
export const marketAbi=parseAbi([
 'function nib() view returns (address)','function treasury() view returns (address)','function paused() view returns (bool)','function bidNonce() view returns (uint256)',
 'function totalEscrow() view returns (uint256)','function totalCredits() view returns (uint256)','function fills() view returns (uint256)','function volumeBNB() view returns (uint256)','function volumeNIB() view returns (uint256)','function feesCollected() view returns (uint256)',
 'function activeCount() view returns (uint256)','function credits(address) view returns (uint256)',
 'function activeBids(uint256 offset,uint256 limit) view returns ((uint256 id,address bidder,uint64 expiresAt,uint128 nibRemaining,uint128 bnbRemaining,uint128 feeRemaining,uint256 priceE18)[])',
 'function bidderBids(address bidder,uint256 offset,uint256 limit) view returns ((uint256 id,address bidder,uint64 expiresAt,uint128 nibRemaining,uint128 bnbRemaining,uint128 feeRemaining,uint256 priceE18)[])',
 'function getBid(uint256 id) view returns ((uint256 id,address bidder,uint64 expiresAt,uint128 nibRemaining,uint128 bnbRemaining,uint128 feeRemaining,uint256 priceE18))',
 'function quoteAccept(uint256 id,uint256 nibAmount) view returns (uint256 bnbAmount,uint256 buyerFee,uint256 sellerFee,uint256 sellerProceeds)',
 'function placeBid(uint256 nibAmount,uint256 bnbAmount,uint256 expiresAt) payable returns (uint256)',
 'function cancelBid(uint256 id)','function acceptBid(uint256 id,uint256 nibAmount,uint256 minBnbOut,uint256 deadline)','function withdrawCredit(address recipient)'
]);
const erc20Abi=parseAbi(['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)']);
const acceptedEvent=parseAbiItem('event BidAccepted(uint256 indexed id,address indexed bidder,address indexed seller,uint256 nibAmount,uint256 bnbAmount,uint256 buyerFee,uint256 sellerFee,uint256 nibRemaining,uint256 bnbRemaining)');
export type Bid={id:bigint;bidder:string;expiresAt:bigint;nibRemaining:bigint;bnbRemaining:bigint;feeRemaining:bigint;priceE18:bigint};
const client=(e:NibMarketEnv)=>createPublicClient({chain:bsc,transport:e.BSC_RPC_URL?http(e.BSC_RPC_URL,{timeout:8000,retryCount:1}):fallback([http('https://bsc-dataseed.bnbchain.org',{timeout:8000,retryCount:0}),http('https://bsc-dataseed-public.bnbchain.org',{timeout:8000,retryCount:0})])}) as any;
export const marketAddress=(e:NibMarketEnv)=>e.NIB_BID_MARKET&&isAddress(e.NIB_BID_MARKET)?e.NIB_BID_MARKET as `0x${string}`:null;
export const tokenAddress=(e:NibMarketEnv)=>(e.NIB_TOKEN&&isAddress(e.NIB_TOKEN)?e.NIB_TOKEN:NIB_TOKEN) as `0x${string}`;
const fee=(x:bigint)=>x*BUYER_FEE_BPS/BPS;
const lc=(s:string)=>s.toLowerCase();

/* ---------- pure order-book helpers ---------- */
export const isLiveBid=(b:Pick<Bid,'expiresAt'|'nibRemaining'>,nowSec:number)=>b.nibRemaining>0n&&(b.expiresAt===0n||b.expiresAt>BigInt(nowSec));
/** Best price first; equal prices fill oldest (lowest id) first. */
export function sortBids<T extends Pick<Bid,'id'|'priceE18'>>(bids:T[]):T[]{return [...bids].sort((a,b)=>a.priceE18===b.priceE18?(a.id<b.id?-1:a.id>b.id?1:0):(a.priceE18>b.priceE18?-1:1));}
/** Aggregate sorted bids into price levels with cumulative depth. */
export function depth(bids:Bid[]){
 const levels:{priceE18:bigint;nib:bigint;bnb:bigint;bids:number;cumNib:bigint;cumBnb:bigint}[]=[];let cumNib=0n,cumBnb=0n;
 for(const b of sortBids(bids)){
  cumNib+=b.nibRemaining;cumBnb+=b.bnbRemaining;const last=levels[levels.length-1];
  if(last&&last.priceE18===b.priceE18){last.nib+=b.nibRemaining;last.bnb+=b.bnbRemaining;last.bids++;last.cumNib=cumNib;last.cumBnb=cumBnb;}
  else levels.push({priceE18:b.priceE18,nib:b.nibRemaining,bnb:b.bnbRemaining,bids:1,cumNib,cumBnb});
 }
 return levels;
}
/** Resolve a bid request from any two of: nib quantity, bnb notional, price (BNB per NIB). Throws NibMarketError on invalid or out-of-range values. */
export function bidTerms(p:any){
 const dec=(v:any,label:string)=>{if(typeof v==='number')v=String(v);if(typeof v!=='string'||!/^\d{1,12}(\.\d{1,18})?$/.test(v.trim()))fail(400,`${label} must be a plain decimal number (up to 18 decimals).`);return parseUnits(v.trim(),18);};
 const has=(k:string)=>p?.[k]!==undefined&&p?.[k]!==null&&p?.[k]!=='';
 const given=['nib','bnb','price'].filter(has);
 if(given.length!==2)fail(400,'Give exactly two of: nib (NIB quantity), bnb (BNB to spend before the 2% fee), price (BNB per NIB).');
 let nib:bigint,bnb:bigint;
 if(has('nib')&&has('bnb')){nib=dec(p.nib,'nib');bnb=dec(p.bnb,'bnb');}
 else if(has('nib')){nib=dec(p.nib,'nib');const price=dec(p.price,'price');bnb=nib*price/E18;}
 else{bnb=dec(p.bnb,'bnb');const price=dec(p.price,'price');if(price<=0n)fail(400,'Price must be above zero.');nib=bnb*E18/price;}
 if(nib<=0n||nib>MAX_NIB_PER_BID)fail(400,'NIB quantity must be above zero and at most 1,000,000,000.');
 if(bnb<MIN_BID_BNB)fail(400,'A bid must be at least 0.001 BNB (before the 2% fee).');
 if(bnb>1_000_000n*E18)fail(400,'Bid is too large.');
 const buyerFee=fee(bnb);return {nib,bnb,buyerFee,deposit:bnb+buyerFee,priceE18:bnb*E18/nib};
}
/** What a seller would receive for `nibAmount` of this bid; mirrors the contract's integer arithmetic exactly. */
export function acceptQuote(b:Pick<Bid,'nibRemaining'|'bnbRemaining'|'feeRemaining'>,nibAmount:bigint){
 if(nibAmount<=0n||nibAmount>b.nibRemaining)fail(400,'Amount exceeds what the bid still wants.');
 const full=nibAmount===b.nibRemaining,bnb=full?b.bnbRemaining:b.bnbRemaining*nibAmount/b.nibRemaining,buyerFee=full?b.feeRemaining:b.feeRemaining*nibAmount/b.nibRemaining,sellerFee=bnb*SELLER_FEE_BPS/BPS;
 return {bnb,buyerFee,sellerFee,proceeds:bnb-sellerFee};
}

/* ---------- views ---------- */
const bidJson=(b:Bid,nowSec:number)=>({id:b.id.toString(),bidder:lc(b.bidder),priceBnb:formatUnits(b.priceE18,18),priceE18:b.priceE18.toString(),nibRemaining:b.nibRemaining.toString(),nib:formatUnits(b.nibRemaining,18),bnbRemaining:b.bnbRemaining.toString(),bnb:formatUnits(b.bnbRemaining,18),
 sellerReceivesBnb:formatUnits(b.bnbRemaining-b.bnbRemaining*SELLER_FEE_BPS/BPS,18),expiresAt:Number(b.expiresAt)||null,live:isLiveBid(b,nowSec)});
const levelJson=(l:ReturnType<typeof depth>[number])=>({priceBnb:formatUnits(l.priceE18,18),priceE18:l.priceE18.toString(),nib:formatUnits(l.nib,18),nibRaw:l.nib.toString(),bnb:formatUnits(l.bnb,18),bids:l.bids,cumulativeNib:formatUnits(l.cumNib,18),cumulativeBnb:formatUnits(l.cumBnb,18)});
async function readAllActive(c:any,market:`0x${string}`,total:number){
 const out:Bid[]=[];const PAGE=250,MAX=1000;
 for(let o=0;o<Math.min(total,MAX);o+=PAGE){const page=await c.readContract({address:market,abi:marketAbi,functionName:'activeBids',args:[BigInt(o),BigInt(PAGE)]});out.push(...page);}
 return out;
}
const cache=new Map<string,{at:number;value:any}>();
export const clearNibMarketCache=()=>{cache.clear();fillStates.clear();};
const notDeployed=(e:NibMarketEnv,why:string)=>({deployed:false,chainId:56,market:marketAddress(e),token:tokenAddress(e),tokenSymbol:'NIB',message:why,fees:{buyerBps:200,sellerBps:200},minBidBnb:formatUnits(MIN_BID_BNB,18),bids:[],levels:[],bestBid:null,fills:[],stats:null});
/** Order-book snapshot. Never throws for an unconfigured or undeployed market: the UI shows a "not live yet" state instead. */
export async function nibMarketState(e:NibMarketEnv,wallet:string|null,now:number){
 const market=marketAddress(e);if(!market)return notDeployed(e,'The NIB pre-market contract is not deployed yet. Bids open once it is live.');
 const c=client(e),nowSec=Math.floor(now/1000);
 const key=[e.BSC_RPC_URL,market].join(':'),hit=cache.get(key);let base:any;
 if(hit&&now-hit.at<4000&&now>=hit.at)base=hit.value;
 else{
  try{
   const code=await c.getCode({address:market});if(!code||code==='0x')return notDeployed(e,'The NIB pre-market address has no contract yet. Bids open once it is live.');
   const [paused,count,nonce,escrow,fills,volBnb,volNib,fees,nibAddr]=await Promise.all(['paused','activeCount','bidNonce','totalEscrow','fills','volumeBNB','volumeNIB','feesCollected','nib'].map(fn=>c.readContract({address:market,abi:marketAbi,functionName:fn})));
   if(lc(String(nibAddr))!==lc(tokenAddress(e)))return notDeployed(e,'The configured pre-market contract does not trade the NIB token. Ignoring it.');
   const all=await readAllActive(c,market,Number(count)),live=sortBids(all.filter(b=>isLiveBid(b,nowSec)));
   base={paused,count:Number(count),nonce,escrow,fills,volBnb,volNib,fees,all,live};
   cache.set(key,{at:now,value:base});
  }catch(err){if(err instanceof NibMarketError)throw err;fail(503,'The NIB pre-market contract could not be read. Nothing was changed.');}
 }
 const live:Bid[]=base.live,levels=depth(live),best=live[0]||null;
 const out:any={deployed:true,chainId:56,market,token:tokenAddress(e),tokenSymbol:'NIB',paused:base.paused,fees:{buyerBps:200,sellerBps:200,note:'Buyer escrows price + 2%; seller receives price − 2%; both fees go to the treasury. Gas is extra. Cancelling is free.'},minBidBnb:formatUnits(MIN_BID_BNB,18),
  bestBid:best?bidJson(best,nowSec):null,bids:live.slice(0,100).map(b=>bidJson(b,nowSec)),levels:levels.slice(0,30).map(levelJson),openBids:live.length,
  depth:{totalNib:formatUnits(live.reduce((s,b)=>s+b.nibRemaining,0n),18),totalBnb:formatUnits(live.reduce((s,b)=>s+b.bnbRemaining,0n),18)},
  stats:{bidsPlaced:base.nonce.toString(),fills:base.fills.toString(),volumeBnb:formatUnits(base.volBnb,18),volumeNib:formatUnits(base.volNib,18),feesBnb:formatUnits(base.fees,18),escrowBnb:formatUnits(base.escrow,18)},
  message:base.paused?'New bids are paused. You can still accept and cancel.':live.length?'Bid-only pre-market: sell by telling your agent to accept a bid.':'No open bids yet.'};
 out.fills=await recentFills(e,market,12,now).catch(()=>({items:[],index:{error:'fill history unavailable'}}));
 if(wallet){
  try{
   const w=wallet as `0x${string}`,token=tokenAddress(e);
   const [mine,nibBal,allowance,credit]=await Promise.all([c.readContract({address:market,abi:marketAbi,functionName:'bidderBids',args:[w,0n,50n]}),c.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[w]}),c.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[w,market]}),c.readContract({address:market,abi:marketAbi,functionName:'credits',args:[w]})]);
   out.user={wallet:lc(wallet),nibBalance:nibBal.toString(),nib:formatUnits(nibBal,18),allowance:allowance.toString(),creditBnb:formatUnits(credit,18),myBids:(mine as Bid[]).map(b=>bidJson(b,nowSec))};
  }catch{out.user={wallet:lc(wallet),error:'Could not read your NIB balance or bids right now.'};}
 }
 return out;
}

/* ---------- recent fills: BidAccepted events, chunked scan cached per server instance ---------- */
type Fill={bidId:string;bidder:string;seller:string;nib:string;bnb:string;priceBnb:string;buyerFee:string;sellerFee:string;nibRemaining:string;transactionHash:string;blockNumber:number;logIndex:number;timestamp:number|null;url:string};
type FillState={from:bigint;scanned:bigint|null;fills:Map<string,Fill>;blocks:Map<bigint,number>;checkedAt:number;inflight:Promise<void>|null;error:string|null;head:bigint|null};
const fillStates=new Map<string,FillState>();
async function scanFills(s:FillState,market:string,e:NibMarketEnv){
 let last='';
 for(const url of logRpcUrls(e)){
  try{
   const c=createPublicClient({chain:bsc,transport:http(url,{timeout:10000,retryCount:1})}) as any,head=await c.getBlockNumber();s.head=head;
   let next=s.scanned===null?s.from:(s.scanned>SALES_OVERLAP?s.scanned-SALES_OVERLAP+1n:0n);if(next>head)next=head;
   const ranges:[bigint,bigint][]=[];for(let a=next;a<=head;a+=SALES_CHUNK)ranges.push([a,a+SALES_CHUNK-1n>head?head:a+SALES_CHUNK-1n]);
   for(let i=0;i<ranges.length;i+=4){
    const batch=ranges.slice(i,i+4),logs=(await Promise.all(batch.map(([fromBlock,toBlock])=>c.getLogs({address:market,event:acceptedEvent,fromBlock,toBlock})))).flat();
    for(const l of logs){const a=l.args,hash=String(l.transactionHash);s.fills.set(hash+':'+l.logIndex,{bidId:String(a.id),bidder:lc(a.bidder),seller:lc(a.seller),nib:formatUnits(a.nibAmount,18),bnb:formatUnits(a.bnbAmount,18),priceBnb:a.nibAmount?formatUnits(a.bnbAmount*E18/a.nibAmount,18):'0',buyerFee:formatUnits(a.buyerFee,18),sellerFee:formatUnits(a.sellerFee,18),nibRemaining:formatUnits(a.nibRemaining,18),transactionHash:hash,blockNumber:Number(l.blockNumber),logIndex:Number(l.logIndex),timestamp:null,url:'https://bscscan.com/tx/'+hash});}
    const need=[...new Set(logs.map((l:any)=>BigInt(l.blockNumber)))].filter(b=>!s.blocks.has(b));
    await Promise.all(need.map(async b=>{try{s.blocks.set(b,Number((await c.getBlock({blockNumber:b})).timestamp)*1000);}catch{}}));
    s.scanned=batch[batch.length-1][1];
   }
   for(const f of s.fills.values())if(f.timestamp===null)f.timestamp=s.blocks.get(BigInt(f.blockNumber))??null;
   if(s.fills.size>200)s.fills=new Map([...s.fills.entries()].sort((a,b)=>b[1].blockNumber-a[1].blockNumber||b[1].logIndex-a[1].logIndex).slice(0,200));
   s.error=null;return;
  }catch(err){last=err instanceof Error?err.message.split('\n')[0].slice(0,160):'unknown';}
 }
 s.error=last||'No log RPC available';
}
/** Scan starts at NIB_MARKET_FROM_BLOCK (set it to the deployment block); otherwise only about the last day of blocks is scanned. */
export async function recentFills(e:NibMarketEnv,market:string,limit=12,now=Date.now(),budgetMs=7000){
 const key=lc(market)+':'+logRpcUrls(e).join(',');let s=fillStates.get(key);
 if(!s){const configured=e.NIB_MARKET_FROM_BLOCK&&/^\d{1,12}$/.test(e.NIB_MARKET_FROM_BLOCK)?BigInt(e.NIB_MARKET_FROM_BLOCK):-1n;s={from:configured,scanned:null,fills:new Map(),blocks:new Map(),checkedAt:0,inflight:null,error:null,head:null};if(fillStates.size>=8)fillStates.clear();fillStates.set(key,s);}
 const st=s;
 if(st.from<0n){try{const c=createPublicClient({chain:bsc,transport:http(logRpcUrls(e)[0],{timeout:10000,retryCount:1})}) as any,head=await c.getBlockNumber();st.from=head>50000n?head-50000n:0n;}catch{st.from=-1n;}}
 if(st.from>=0n&&st.checkedAt+SALES_TTL_MS<=now&&!st.inflight)st.inflight=scanFills(st,market,e).finally(()=>{st.checkedAt=Date.now();st.inflight=null;});
 if(st.inflight)await Promise.race([st.inflight,new Promise<void>(r=>setTimeout(r,budgetMs))]);
 const items=[...st.fills.values()].sort((a,b)=>b.blockNumber-a.blockNumber||b.logIndex-a.logIndex).slice(0,Math.max(1,Math.min(50,limit)));
 return {items,index:{fromBlock:st.from<0n?null:Number(st.from),scannedToBlock:st.scanned===null?null:Number(st.scanned),headBlock:st.head===null?null:Number(st.head),total:st.fills.size,complete:st.scanned!==null&&st.head!==null&&st.scanned>=st.head&&!st.inflight,error:st.error,source:'BidAccepted events'}};
}

/* ---------- signed agent actions: return baw preview commands, never send ---------- */
const tx=(from:string,to:string,abi:any,functionName:string,args:any[],value=0n)=>({chainId:56,from,to,value:value.toString(),data:encodeFunctionData({abi,functionName,args} as any)});
const baw=(t:{from:string;to:string;value:string;data:string})=>`baw contract-call preview --binanceChainId 56 --from ${t.from} --to ${t.to} --value ${t.value} --inputData ${t.data} --json`;
const PREVIEW_NOTE='Run the baw preview, show the user the parsed call, gas and risks, and execute only after explicit approval. Previews expire in about 5 minutes. Never re-execute an uncertain transaction: check the hash first.';
async function requireMarket(e:NibMarketEnv){
 const market=marketAddress(e);if(!market)return fail(503,'The NIB pre-market contract is not deployed yet.');
 const c=client(e);let code:string|undefined;try{code=await c.getCode({address:market});}catch{return fail(503,'The NIB pre-market contract could not be read. Nothing was changed.');}
 if(!code||code==='0x')return fail(503,'The NIB pre-market contract is not deployed yet.');return {market,c};
}
const liveBook=async(c:any,market:`0x${string}`,nowSec:number)=>{const count=await c.readContract({address:market,abi:marketAbi,functionName:'activeCount'});return sortBids((await readAllActive(c,market,Number(count))).filter(b=>isLiveBid(b,nowSec)));};
export async function placeBidAction(e:NibMarketEnv,a:any,payload:any,now:number){
 await requireGameAccess(e,a);
 const {market,c}=await requireMarket(e);
 if(await c.readContract({address:market,abi:marketAbi,functionName:'paused'}))fail(409,'New bids are paused. Existing bids can still be accepted and cancelled.');
 const t=bidTerms(payload);let expiresAt=0n;
 if(payload?.expiresInHours!==undefined&&payload.expiresInHours!==null&&payload.expiresInHours!==''){const h=Number(payload.expiresInHours);if(!Number.isFinite(h)||h<=0||h*3600>MAX_EXPIRY_SECONDS)fail(400,'expiresInHours must be above 0 and at most 8760 (one year). Omit for no expiry.');expiresAt=BigInt(Math.floor(now/1000)+Math.ceil(h*3600));}
 const balance=await c.getBalance({address:a.wallet});if(balance<t.deposit)fail(409,`Your wallet has ${formatUnits(balance,18)} BNB, but this bid escrows ${formatUnits(t.deposit,18)} BNB plus gas.`);
 const book=await liveBook(c,market,Math.floor(now/1000)),best=book[0]||null;
 const transaction=tx(a.wallet,market,marketAbi,'placeBid',[t.nib,t.bnb,expiresAt],t.deposit);
 return {nibMarket:{action:'place-bid',summary:{wants:formatUnits(t.nib,18)+' NIB',pricePerNibBnb:formatUnits(t.priceE18,18),bnbForNib:formatUnits(t.bnb,18),buyerFee2pct:formatUnits(t.buyerFee,18),totalEscrowedBnb:formatUnits(t.deposit,18),expires:expiresAt?new Date(Number(expiresAt)*1000).toISOString():'never (cancel any time for a full refund)',
  marketContext:best?{bestBidPriceBnb:formatUnits(best.priceE18,18),yourBidIs:t.priceE18>best.priceE18?'the new top bid':t.priceE18===best.priceE18?'tied with the top bid (older bid fills first)':'below the top bid'}:{bestBidPriceBnb:null,yourBidIs:'the first bid'}},
  note:'You only get NIB when a holder accepts your bid. Unfilled BNB (and its unspent 2% fee) is refunded in full when you cancel. '+PREVIEW_NOTE,transaction,baw:baw(transaction)}};
}
export async function cancelBidAction(e:NibMarketEnv,a:any,payload:any,now:number){
 const {market,c}=await requireMarket(e);
 let id:bigint;try{id=BigInt(String(payload?.id??''));}catch{return fail(400,'Give the bid id to cancel, for example {"id":"3"}.');}
 let bid:Bid;try{bid=await c.readContract({address:market,abi:marketAbi,functionName:'getBid',args:[id]});}catch{return fail(503,'The NIB pre-market contract could not be read. Nothing was changed.');}
 if(!bid||bid.bidder===('0x'+'0'.repeat(40)))fail(404,'That bid no longer exists (it was filled or already cancelled).');
 if(lc(bid.bidder)!==lc(a.wallet))fail(403,'That bid belongs to a different wallet.');
 const refund=bid.bnbRemaining+bid.feeRemaining,transaction=tx(a.wallet,market,marketAbi,'cancelBid',[id]);
 return {nibMarket:{action:'cancel-bid',summary:{bidId:id.toString(),refundBnb:formatUnits(refund,18),note:'Full refund of the remaining BNB and its unspent fee; cancelling costs only gas.'},note:PREVIEW_NOTE,transaction,baw:baw(transaction)}};
}
export async function acceptBidAction(e:NibMarketEnv,a:any,payload:any,now:number){
 await requireGameAccess(e,a);
 const {market,c}=await requireMarket(e),token=tokenAddress(e),nowSec=Math.floor(now/1000),wallet=a.wallet as `0x${string}`;
 const book=(await liveBook(c,market,nowSec)).filter(b=>lc(b.bidder)!==lc(wallet));
 if(!book.length)fail(409,'There is no open bid you can accept right now.');
 const want=payload?.id===undefined||payload?.id===null||payload.id===''||payload.id==='top'?'top':payload.id;
 let bid:Bid|undefined;
 if(want==='top')bid=book[0];else{let id:bigint;try{id=BigInt(String(want));}catch{return fail(400,'Use id "top" or a bid id such as "3".');}bid=book.find(b=>b.id===id);if(!bid)fail(404,'That bid is not open, was filled, expired, or is your own.');}
 const b=bid!;
 const [balance,allowance]=await Promise.all([c.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[wallet]}),c.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[wallet,market]})]);
 if(balance<=0n)fail(409,'This wallet holds no NIB to sell.');
 let amount:bigint;const raw=payload?.nib;
 if(raw===undefined||raw===null||raw===''||raw==='max'||raw==='all')amount=balance<b.nibRemaining?balance:b.nibRemaining;
 else{if((typeof raw!=='string'&&typeof raw!=='number')||!/^\d{1,10}(\.\d{1,18})?$/.test(String(raw)))fail(400,'nib must be a decimal NIB amount, or "max".');amount=parseUnits(String(raw),18);}
 if(amount<=0n)fail(400,'Amount must be above zero.');
 if(amount>balance)fail(409,`You only hold ${formatUnits(balance,18)} NIB.`);
 let capped=false;if(amount>b.nibRemaining){amount=b.nibRemaining;capped=true;}
 if(payload?.minPrice!==undefined&&payload.minPrice!==null&&payload.minPrice!==''){const mp=parseUnits(String(payload.minPrice),18);if(b.priceE18<mp)fail(409,`The best bid pays ${formatUnits(b.priceE18,18)} BNB per NIB, below your minimum of ${formatUnits(mp,18)}. Nothing to prepare.`);}
 const q=acceptQuote(b,amount);if(q.bnb===0n)fail(400,'That amount is too small to be worth any BNB. Sell more NIB.');
 const minOut=q.proceeds-q.proceeds/1000n,deadline=BigInt(nowSec+600);
 const approve=allowance<amount?tx(wallet,token,erc20Abi,'approve',[market,amount]):null,accept=tx(wallet,market,marketAbi,'acceptBid',[b.id,amount,minOut,deadline]);
 return {nibMarket:{action:'accept-bid',summary:{bidId:b.id.toString(),buyer:lc(b.bidder),selling:formatUnits(amount,18)+' NIB',partialFill:amount<b.nibRemaining,cappedToBidSize:capped,pricePerNibBnb:formatUnits(b.priceE18,18),grossBnb:formatUnits(q.bnb,18),sellerFee2pct:formatUnits(q.sellerFee,18),youReceiveBnb:formatUnits(q.proceeds,18),minimumAcceptedBnb:formatUnits(minOut,18)},
  steps:[...(approve?[{step:1,name:'approve NIB for the pre-market (exact amount)',transaction:approve,baw:baw(approve)}]:[]),{step:approve?2:1,name:'accept the bid',transaction:accept,baw:baw(accept),validUntil:new Date(Number(deadline)*1000).toISOString(),dependsOn:approve?'Execute only after the approval transaction has confirmed.':null}],
  note:'The NIB moves straight from your wallet to the buyer and the BNB is paid to you in the same transaction. '+PREVIEW_NOTE}};
}
export async function nibMarketAction(e:NibMarketEnv,a:any,action:string,payload:any,now:number){
 if(action==='nib-market-state')return {nibMarket:await nibMarketState(e,a?.wallet||null,now)};
 if(action==='nib-bid-place')return placeBidAction(e,a,payload,now);
 if(action==='nib-bid-cancel')return cancelBidAction(e,a,payload,now);
 if(action==='nib-bid-accept')return acceptBidAction(e,a,payload,now);
 return fail(400,'Unknown NIB market action.');
}
export async function nibMarketRoute(request:Request,e:NibMarketEnv,a:any|null,now:number):Promise<Response|null>{
 const path=new URL(request.url).pathname.replace(/^\/api/,'');
 if(path==='/nib-market'&&request.method==='GET')return new Response(JSON.stringify(await nibMarketState(e,a?.connected?a.wallet:null,now)),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 return null;
}
