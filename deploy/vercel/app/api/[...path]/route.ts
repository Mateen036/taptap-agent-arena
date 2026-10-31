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
 const response=await handle(forwarded,{DB:database(),NFT_COLLECTION:process.env.NFT_COLLECTION,NFT_GAME_UTILITY:process.env.NFT_GAME_UTILITY,NFT_MARKETPLACE:process.env.NFT_MARKETPLACE,NFT_COLLECTION_BIDS:process.env.NFT_COLLECTION_BIDS,NIB_VAULT_V2:process.env.NIB_VAULT_V2,NFT_COLLECTION_V2:process.env.NFT_COLLECTION_V2,NFT_MARKETPLACE_V2:process.env.NFT_MARKETPLACE_V2,NFT_COLLECTION_BIDS_V2:process.env.NFT_COLLECTION_BIDS_V2,NFT_LEGACY_COLLECTION:process.env.NFT_LEGACY_COLLECTION,NFT_LOGS_RPC_URL:process.env.NFT_LOGS_RPC_URL,NFT_MARKETPLACE_FROM_BLOCK:process.env.NFT_MARKETPLACE_FROM_BLOCK,NFT_LP_VAULT:process.env.NFT_LP_VAULT,NFT_FEE_RECIPIENT:process.env.NFT_FEE_RECIPIENT,ADMIN_WALLET:process.env.ADMIN_WALLET,NIB_SIGNER_PRIVATE_KEY:process.env.NIB_SIGNER_PRIVATE_KEY,NIB_AIRDROP:process.env.NIB_AIRDROP,NIB_TOKEN:process.env.NIB_TOKEN,NIB_BID_MARKET:process.env.NIB_BID_MARKET,NIB_MARKET_FROM_BLOCK:process.env.NIB_MARKET_FROM_BLOCK,BUG_BOUNTY_CONTRACT:process.env.BUG_BOUNTY_CONTRACT,BUG_BOUNTY_REPORT_KEY:process.env.BUG_BOUNTY_REPORT_KEY,BUG_BOUNTY_SIGNER_PRIVATE_KEY:process.env.BUG_BOUNTY_SIGNER_PRIVATE_KEY,BSC_RPC_URL:process.env.BSC_RPC_URL,ALLOW_WALLET_RELINK:true,PUBLIC_READ_CACHE:true,STORAGE_NAME:'PostgreSQL'} as any);
 // Never attach a per-visitor cookie to a CDN-cacheable public response (it would be cached and shared).
 if(session?.cookie&&!/s-maxage/.test(response.headers.get('Cache-Control')||''))response.headers.append('Set-Cookie',session.cookie);return response;
 }catch(error){console.error('TapTap runtime unavailable',error instanceof Error?error.name:'unknown');return Response.json({error:'The game service is not configured. Database and session configuration are required.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export const GET=route;export const POST=route;
