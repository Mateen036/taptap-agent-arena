import {handle} from '../../generated/api';
import {database} from '../../../lib/postgres';
import {browserSession} from '../../../lib/browser-session';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
async function route(request:Request){
 try{
 const path=new URL(request.url).pathname;const headers=new Headers(request.headers);
 // Sites dispatch headers have no authority on Vercel. Never trust a caller-supplied user ID.
 for(const name of [...headers.keys()])if(name.toLowerCase().startsWith('oai-authenticated-'))headers.delete(name);
 const browserEndpoint=!/^\/api\/(agent\/|admin\/|health$)/.test(path);
 const session=browserEndpoint?browserSession(request):null;if(session)headers.set('oai-authenticated-user-id',session.userId);
 const forwarded=new Request(request,{headers});
 const response=await handle(forwarded,{DB:database(),NFT_COLLECTION:process.env.NFT_COLLECTION,NFT_GAME_UTILITY:process.env.NFT_GAME_UTILITY,NFT_MARKETPLACE:process.env.NFT_MARKETPLACE,NFT_LOGS_RPC_URL:process.env.NFT_LOGS_RPC_URL,NFT_MARKETPLACE_FROM_BLOCK:process.env.NFT_MARKETPLACE_FROM_BLOCK,NFT_LP_VAULT:process.env.NFT_LP_VAULT,NFT_FEE_RECIPIENT:process.env.NFT_FEE_RECIPIENT,ADMIN_WALLET:process.env.ADMIN_WALLET,NIB_SIGNER_PRIVATE_KEY:process.env.NIB_SIGNER_PRIVATE_KEY,NIB_AIRDROP:process.env.NIB_AIRDROP,NIB_TOKEN:process.env.NIB_TOKEN,NIB_BID_MARKET:process.env.NIB_BID_MARKET,NIB_MARKET_FROM_BLOCK:process.env.NIB_MARKET_FROM_BLOCK,BSC_RPC_URL:process.env.BSC_RPC_URL,ALLOW_WALLET_RELINK:true,STORAGE_NAME:'PostgreSQL'} as any);
 if(session?.cookie)response.headers.append('Set-Cookie',session.cookie);return response;
 }catch(error){console.error('TapTap runtime unavailable',error instanceof Error?error.name:'unknown');return Response.json({error:'The game service is not configured. Database and session configuration are required.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export const GET=route;export const POST=route;
