import {createPublicClient,http,formatUnits,parseAbiItem} from 'viem';
import {bsc} from 'viem/chains';
import {nftTraits,NFT_SUPPLY} from './nft-art';

/** Marketplace listing sorts. `newest` is the default; every sort ends in token id so order is deterministic. */
export const MARKET_SORTS=[
 {id:'newest',label:'Newest listed'},
 {id:'price_asc',label:'Price: low to high'},
 {id:'price_desc',label:'Price: high to low'},
 {id:'rarity',label:'Rarity: rarest first'},
 {id:'token',label:'Token ID'},
] as const;
export type MarketSort=typeof MARKET_SORTS[number]['id'];
export function parseSort(value:unknown):MarketSort{const v=String(value||'');return (MARKET_SORTS.find(s=>s.id===v)?.id)||'newest';}
export function sortListings<T extends {tokenId:number;listingId:string;priceRaw:string;rarity?:{rank:number}|null}>(items:T[],sort:MarketSort):T[]{
 const out=[...items],byToken=(a:T,b:T)=>a.tokenId-b.tokenId,cmp=(a:bigint,b:bigint)=>a<b?-1:a>b?1:0;
 const orders:Record<MarketSort,(a:T,b:T)=>number>={
  newest:(a,b)=>cmp(BigInt(b.listingId),BigInt(a.listingId))||byToken(a,b),
  price_asc:(a,b)=>cmp(BigInt(a.priceRaw),BigInt(b.priceRaw))||byToken(a,b),
  price_desc:(a,b)=>cmp(BigInt(b.priceRaw),BigInt(a.priceRaw))||byToken(a,b),
  rarity:(a,b)=>((a.rarity?.rank??Infinity)-(b.rarity?.rank??Infinity))||byToken(a,b),
  token:byToken,
 };
 return out.sort(orders[sort]);
}

/** Statistical rarity: for each trait, a Nib scores supply ÷ (number of minted Nibs sharing that trait value); the six scores are summed. */
export const TRAIT_KEYS=['background','chassis','eyes','headgear','emblem','accessory'] as const;
export type TraitKey=typeof TRAIT_KEYS[number];
export type Rarity={score:number;rank:number;of:number;tied:number;tier:'Legendary'|'Epic'|'Rare'|'Uncommon'|'Common'};
type Board={minted:number;scores:number[];ranks:number[];tied:Map<number,number>;uniform:boolean;counts:Record<TraitKey,Map<string,number>>};
const boards=new Map<number,Board>();
function tierFor(rank:number,of:number):Rarity['tier']{const p=rank/of;return p<=0.01?'Legendary':p<=0.05?'Epic':p<=0.2?'Rare':p<=0.5?'Uncommon':'Common';}
export function rarityBoard(minted:number):Board{
 const n=Math.max(0,Math.min(NFT_SUPPLY,Math.floor(Number(minted)||0)));const cached=boards.get(n);if(cached)return cached;
 const counts=Object.fromEntries(TRAIT_KEYS.map(k=>[k,new Map<string,number>()])) as Board['counts'],all:Record<string,string>[]=[];
 for(let id=1;id<=n;id++){const t=nftTraits(id) as any,row:Record<string,string>={};for(const k of TRAIT_KEYS){row[k]=t[k];counts[k].set(t[k],(counts[k].get(t[k])||0)+1);}all.push(row);}
 const scores=all.map(row=>TRAIT_KEYS.reduce((sum,k)=>sum+n/(counts[k].get(row[k])||1),0));
 // Competition ranking: tokens with the same score share the best rank. Scores are compared at 1e-9 to ignore float noise.
 const keys=scores.map(s=>Math.round(s*1e9)),order=keys.map((_,i)=>i).sort((a,b)=>keys[b]-keys[a]||a-b),ranks=new Array<number>(n);
 order.forEach((index,position)=>{ranks[index]=position>0&&keys[index]===keys[order[position-1]]?ranks[order[position-1]]:position+1;});
 const tied=new Map<number,number>();for(const r of ranks)tied.set(r,(tied.get(r)||0)+1);
 const board:Board={minted:n,scores,ranks,tied,uniform:n>0&&keys.every(k=>k===keys[0]),counts};if(boards.size>=8)boards.delete(boards.keys().next().value as number);boards.set(n,board);return board;
}
/** Rank is only defined for minted serials (1..minted). Unminted designs return null. */
export function nftRarity(tokenId:number,minted:number):Rarity|null{
 const board=rarityBoard(minted);if(!Number.isInteger(tokenId)||tokenId<1||tokenId>board.minted)return null;
 const rank=board.ranks[tokenId-1];return {score:Math.round(board.scores[tokenId-1]*100)/100,rank,of:board.minted,tied:board.tied.get(rank)||1,tier:board.uniform?'Common':tierFor(rank,board.minted)};
}
export function traitFrequencies(minted:number){
 const board=rarityBoard(minted);
 return TRAIT_KEYS.map(key=>({key,values:[...board.counts[key].entries()].map(([value,count])=>({value,count,percent:board.minted?Math.round(count/board.minted*10000)/100:0})).sort((a,b)=>a.count-b.count||a.value.localeCompare(b.value))}));
}
export function withRarity<T extends {id?:number;tokenId?:number}>(item:T,minted:number):T&{rarity:Rarity|null}{return {...item,rarity:nftRarity(Number(item.tokenId??item.id),minted)};}

/* ---------- Recent sales: Bought and BidAccepted events, scanned in chunks and cached per server instance ---------- */
const boughtEvent=parseAbiItem('event Bought(uint256 indexed tokenId,uint256 indexed id,address indexed buyer,address seller,uint256 price)');
const acceptedEvent=parseAbiItem('event BidAccepted(uint256 indexed id,uint256 indexed tokenId,address indexed bidder,address seller,uint256 price)');
/** Deploy blocks for known mainnet marketplaces; the scan never needs to look further back. NFT_MARKETPLACE_FROM_BLOCK overrides. */
const DEPLOY_BLOCKS:Record<string,bigint>={'0x8b1434193028a88d2a501a88efc66f4678ef6f02':130650000n};
const PUBLIC_LOG_RPC='https://bsc-rpc.publicnode.com';
export const SALES_TTL_MS=20000,SALES_CHUNK=5000n,SALES_OVERLAP=30n,SALES_KEEP=200;
export type Sale={tokenId:number;kind:'buy'|'bid';listingId:string|null;bidId:string|null;price:string;priceRaw:string;buyer:string;seller:string;transactionHash:string;blockNumber:number;logIndex:number;timestamp:number|null;url:string};
type SalesState={from:bigint;scanned:bigint|null;sales:Map<string,Sale>;blocks:Map<bigint,number>;checkedAt:number;inflight:Promise<void>|null;error:string|null;badUrls:Map<string,number>;head:bigint|null};
const salesStates=new Map<string,SalesState>();
export type SalesEnv={BSC_RPC_URL?:string;NFT_RPC_URL?:string;NFT_LOGS_RPC_URL?:string;NFT_LOGS_CHUNK?:string;NFT_MARKETPLACE_FROM_BLOCK?:string};
const unique=(values:(string|undefined)[])=>[...new Set(values.filter((v):v is string=>!!v))];
/** An explicit NFT_LOGS_RPC_URL is used alone. Otherwise the configured RPCs are tried first, then a public node: BNB's own dataseed nodes reject eth_getLogs. */
export function logRpcUrls(env:SalesEnv){return env.NFT_LOGS_RPC_URL?[env.NFT_LOGS_RPC_URL]:unique([env.NFT_RPC_URL,env.BSC_RPC_URL,PUBLIC_LOG_RPC]);}
const chunkSize=(env:SalesEnv)=>{const n=Number(env.NFT_LOGS_CHUNK);return Number.isInteger(n)&&n>=1&&n<=5000?BigInt(n):SALES_CHUNK;};
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function normalize(log:any,kind:'buy'|'bid'):Sale{
 const a=log.args,hash=String(log.transactionHash);
 return {tokenId:Number(a.tokenId),kind,listingId:kind==='buy'?String(a.id):null,bidId:kind==='bid'?String(a.id):null,price:formatUnits(a.price,18),priceRaw:String(a.price),buyer:String(kind==='buy'?a.buyer:a.bidder).toLowerCase(),seller:String(a.seller).toLowerCase(),transactionHash:hash,blockNumber:Number(log.blockNumber),logIndex:Number(log.logIndex),timestamp:null,url:'https://bscscan.com/tx/'+hash};
}
async function scan(state:SalesState,market:string,env:SalesEnv){
 let lastError='';
 for(const url of logRpcUrls(env)){
  const isBad=(u:string)=>Date.now()-(state.badUrls.get(u)||0)<300000;
  if(isBad(url)&&logRpcUrls(env).some(u=>!isBad(u)))continue;
  try{
   const c=createPublicClient({chain:bsc,transport:http(url,{timeout:10000,retryCount:1})}) as any,head=await c.getBlockNumber();state.head=head;
   let next=state.scanned===null?state.from:(state.scanned>SALES_OVERLAP?state.scanned-SALES_OVERLAP+1n:0n);if(next>head)next=head;
   const ranges:[bigint,bigint][]=[];const size=chunkSize(env);for(let s=next;s<=head;s+=size)ranges.push([s,s+size-1n>head?head:s+size-1n]);
   for(let i=0;i<ranges.length;i+=4){
    const batch=ranges.slice(i,i+4),logs=(await Promise.all(batch.map(([fromBlock,toBlock])=>c.getLogs({address:market,events:[boughtEvent,acceptedEvent],fromBlock,toBlock})))).flat();
    for(const log of logs){const sale=normalize(log,log.eventName==='Bought'?'buy':'bid');state.sales.set(sale.transactionHash+':'+sale.logIndex,sale);}
    const need=[...new Set(logs.map((l:any)=>BigInt(l.blockNumber)))].filter(b=>!state.blocks.has(b));
    await Promise.all(need.map(async b=>{try{state.blocks.set(b,Number((await c.getBlock({blockNumber:b})).timestamp)*1000);}catch{}}));
    state.scanned=batch[batch.length-1][1];
   }
   for(const sale of state.sales.values())if(sale.timestamp===null)sale.timestamp=state.blocks.get(BigInt(sale.blockNumber))??null;
   if(state.sales.size>SALES_KEEP){const keep=[...state.sales.entries()].sort((a,b)=>b[1].blockNumber-a[1].blockNumber||b[1].logIndex-a[1].logIndex).slice(0,SALES_KEEP);state.sales=new Map(keep);}
   state.error=null;state.badUrls.delete(url);return;
  }catch(error){lastError=error instanceof Error?error.message.split('\n')[0].slice(0,160):'unknown';state.badUrls.set(url,Date.now());}
 }
 state.error=lastError||'No log RPC available';
}
export async function recentSales(env:SalesEnv,market:string,limit=12,now=Date.now(),budgetMs=9000){
 const key=market.toLowerCase()+':'+logRpcUrls(env).join(',');let state=salesStates.get(key);
 if(!state){
  const configured=env.NFT_MARKETPLACE_FROM_BLOCK&&/^\d{1,12}$/.test(env.NFT_MARKETPLACE_FROM_BLOCK)?BigInt(env.NFT_MARKETPLACE_FROM_BLOCK):DEPLOY_BLOCKS[market.toLowerCase()];
  state={from:configured??-1n,scanned:null,sales:new Map(),blocks:new Map(),checkedAt:0,inflight:null,error:null,badUrls:new Map(),head:null};
  if(salesStates.size>=8)salesStates.clear();salesStates.set(key,state);
 }
 const s=state;
 if(s.from<0n){ // unknown marketplace: bound the scan to roughly the last six hours of BSC blocks
  try{const c=createPublicClient({chain:bsc,transport:http(logRpcUrls(env)[0],{timeout:10000,retryCount:1})}) as any,head=await c.getBlockNumber();s.from=head>50000n?head-50000n:0n;}catch{s.from=-1n;}
 }
 if(s.from>=0n&&s.checkedAt+SALES_TTL_MS<=now&&!s.inflight){
  s.inflight=scan(s,market,env).finally(()=>{s.checkedAt=Date.now();s.inflight=null;});
 }
 if(s.inflight)await Promise.race([s.inflight,sleep(budgetMs)]);
 const items=[...s.sales.values()].sort((a,b)=>b.blockNumber-a.blockNumber||b.logIndex-a.logIndex).slice(0,Math.max(1,Math.min(50,limit)));
 return {items,index:{fromBlock:s.from<0n?null:Number(s.from),scannedToBlock:s.scanned===null?null:Number(s.scanned),headBlock:s.head===null?null:Number(s.head),total:s.sales.size,complete:s.scanned!==null&&s.head!==null&&s.scanned>=s.head&&!s.inflight,error:s.error,cacheTtlSeconds:SALES_TTL_MS/1000,source:'Bought and BidAccepted events'}};
}
export function resetSalesCache(){salesStates.clear();}
