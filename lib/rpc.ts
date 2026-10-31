import {http,fallback} from 'viem';
/** Public BNB Chain RPC endpoints, tried in order. A single public endpoint rate-limits shared serverless IPs under load, which surfaced as intermittent 500/503 on the NFT, convert and game-gate checks. */
export const PUBLIC_BSC_RPCS=['https://bsc-dataseed.bnbchain.org','https://bsc-dataseed-public.bnbchain.org','https://bsc-dataseed1.defibit.io','https://bsc-rpc.publicnode.com'] as const;
/** An explicitly configured RPC URL is used alone (with retries). Otherwise fall through every public endpoint on transport errors; contract reverts are NOT retried. */
export function bscTransport(url?:string,timeout=8000){
 if(url)return http(url,{timeout,retryCount:2,retryDelay:150});
 return fallback(PUBLIC_BSC_RPCS.map(u=>http(u,{timeout,retryCount:0})),{retryCount:1,retryDelay:150});
}
/** Run `fn` over `items` with at most `limit` in flight so one request cannot burst hundreds of RPC calls. */
export async function mapLimit<T,R>(items:readonly T[],limit:number,fn:(item:T,index:number)=>Promise<R>):Promise<R[]>{
 const out=new Array<R>(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i],i);}}));
 return out;
}
/** Short, secret-free description of an error for logs (no URLs, which may embed provider keys). Walks the cause chain so the underlying transport failure (HTTP status, timeout) is visible. */
export function errorSummary(e:unknown):string{
 const parts:string[]=[];let x:any=e;
 for(let depth=0;x&&depth<5;depth++,x=x.cause){
  const msg=String(x.shortMessage||x.details||x.message||'').split('\n')[0];
  parts.push((x.name||'Error')+(x.status?'['+x.status+']':'')+(msg?': '+msg:''));
 }
 return parts.join(' <- ').replace(/https?:\/\/\S+/g,'<url>').slice(0,400);
}
