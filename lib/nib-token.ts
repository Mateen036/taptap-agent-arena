import {createPublicClient,parseAbi,formatUnits} from 'viem';
import {bsc} from 'viem/chains';
import {bscTransport} from './rpc';
import {memo} from './season';
// Public NIB token facts for the "NIB Token" page: live PancakeSwap V2 pair state read from BNB Chain (identical for every visitor, so cached ~20 s).
export const NIB_TOKEN_ADDRESS='0x1F11d9feAF354aD31861B4fa26759349e2860cFb' as const;
export const NIB_PAIR='0xD98132535fA350c23a26b22C6a77678F99094BB9' as const;
const DEAD='0x000000000000000000000000000000000000dEaD' as const;
const BNB_USD_FEED='0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE' as const;
const TTL_MS=20000;
const abi=parseAbi([
 'function name() view returns (string)','function symbol() view returns (string)','function decimals() view returns (uint8)','function totalSupply() view returns (uint256)','function balanceOf(address) view returns (uint256)',
 'function token0() view returns (address)','function getReserves() view returns (uint112,uint112,uint32)',
 'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'
]);
export type NibTokenEnv={BSC_RPC_URL?:string;PUBLIC_READ_CACHE?:boolean};
async function load(e:NibTokenEnv){
 const c=createPublicClient({chain:bsc,transport:bscTransport(e.BSC_RPC_URL)}) as any;
 const call=(address:`0x${string}`,functionName:string,args:any[]=[])=>({address,abi,functionName,args} as any);
 const r:any[]=await c.multicall({allowFailure:true,contracts:[
  call(NIB_TOKEN_ADDRESS,'name'),call(NIB_TOKEN_ADDRESS,'symbol'),call(NIB_TOKEN_ADDRESS,'decimals'),call(NIB_TOKEN_ADDRESS,'totalSupply'),
  call(NIB_PAIR,'token0'),call(NIB_PAIR,'getReserves'),call(NIB_PAIR,'totalSupply'),call(NIB_PAIR,'balanceOf',[DEAD]),call(NIB_PAIR,'balanceOf',['0x0000000000000000000000000000000000000000']),
  call(BNB_USD_FEED,'latestRoundData')
 ]});
 const ok=(i:number)=>r[i]?.status==='success'?r[i].result:undefined;
 const decimals=Number(ok(2)??18);
 const out:any={token:{address:NIB_TOKEN_ADDRESS,name:ok(0)??null,symbol:ok(1)??null,decimals,totalSupply:ok(3)!==undefined?formatUnits(ok(3),decimals):null},pool:null,updatedAt:Date.now()};
 const res=ok(5),t0=ok(4);
 if(res&&t0){
  // The pair is NIB/WBNB; token0 tells which reserve is which.
  const nibIs0=String(t0).toLowerCase()===NIB_TOKEN_ADDRESS.toLowerCase();
  const rn=nibIs0?res[0]:res[1],rb=nibIs0?res[1]:res[0];
  const nib=Number(formatUnits(rn,decimals)),bnb=Number(formatUnits(rb,18));
  const feed=ok(9),bnbUsd=feed&&feed[1]>0n&&Date.now()/1000-Number(feed[3])<86400?Number(feed[1])/1e8:null;
  const lp=ok(6),burned=(ok(7)??0n)+(ok(8)??0n);
  out.pool={address:NIB_PAIR,reserveNib:formatUnits(rn,decimals),reserveBnb:formatUnits(rb,18),priceBnb:nib>0?bnb/nib:null,bnbUsd,priceUsd:nib>0&&bnbUsd?bnb/nib*bnbUsd:null,liquidityBnb:bnb*2,liquidityUsd:bnbUsd?bnb*2*bnbUsd:null,lpTotal:lp!==undefined?formatUnits(lp,18):null,lpBurnedPct:lp&&lp>0n?Number(burned*1000000n/lp)/10000:null};
 }
 return out;
}
export async function nibTokenState(e:NibTokenEnv){return memo(e,'nib-token',TTL_MS,()=>load(e));}
export async function nibTokenRoute(request:Request,e:NibTokenEnv):Promise<Response|null>{
 const path=new URL(request.url).pathname.replace(/^\/api/,'');
 if(path!=='/nib-token'||request.method!=='GET')return null;
 try{
  return new Response(JSON.stringify(await nibTokenState(e)),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=0, s-maxage=20, stale-while-revalidate=60','X-Content-Type-Options':'nosniff'}});
 }catch{
  return new Response(JSON.stringify({error:'Live pool data is temporarily unavailable.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
}
