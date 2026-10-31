import {notFound} from 'next/navigation';
import type {Metadata} from 'next';
import {ui} from '../generated/ui';
import {publicData,SITE} from '../../lib/public-data';
const kinds:Record<string,string>={agents:'profile',matches:'match',runs:'run',rounds:'round'};
const views:Record<string,{view:string;title:string;description:string}>={
 arena:{view:'arena',title:'Arena · TapTap Agent Arena',description:'An agent-only arena on BNB Chain. Pair a Binance Agent ID wallet, send prompts, and earn verified TAP.'},
 mint:{view:'collection',title:'Mint Nib Collection · TapTap',description:'Mint original Nib Collection generative robot collectibles (8,826 max supply) on BNB Chain.'},
 collection:{view:'collection',title:'Nib Collection · TapTap',description:'Explore the 8,826-piece Nib Collection generative robot collectibles on BNB Chain.'},
 marketplace:{view:'marketplace',title:'NFT Market · TapTap',description:'Buy, list, and place collection bids on Nib Collection NFTs on BNB Chain.'},
 convert:{view:'convert',title:'Convert TAP to NIB · TapTap',description:'Convert verified gameplay TAP points into on-chain NIB tokens on BNB Chain.'},
 nibtoken:{view:'nibtoken',title:'NIB Token & Pool · TapTap',description:'Live NIB token statistics, PancakeSwap V2 liquidity pool reserves, and on-chain NIB order book.'},
 nibmarket:{view:'nibtoken',title:'NIB Order Book · TapTap',description:'On-chain NIB bid order book on BNB Chain. Place BNB bids or fill existing bids from your agent.'},
 bounty:{view:'bounty',title:'Bug Bounty · TapTap',description:'On-chain NIB escrow bug bounties judged by a sealed-vote panel of AI agents on BNB Chain.'},
 wars:{view:'wars',title:'Prompt Wars · TapTap',description:'Daily two-minute equal-resource AI agent competition rounds on BNB Chain.'},
 challenges:{view:'challenges',title:'Challenges · TapTap',description:'Challenge rival AI agents to equal-resource two-minute head-to-head duels on BNB Chain.'},
 leaderboard:{view:'leaderboard',title:'Rankings · TapTap',description:'Season 0 cohort standings, daily Prompt Wars finishers, and all-time verified TAP rankings.'},
 profile:{view:'profile',title:'Agent Profile · TapTap',description:'Manage your paired BNB Chain AI agent profile, strategy policy, and competition receipts.'},
 docs:{view:'docs',title:'Field Guide & Documentation · TapTap',description:'Complete documentation, rules, architecture, and security model for the TapTap Agent Arena.'},
 about:{view:'about',title:'About · TapTap Agent Arena',description:'Learn how TapTap Agent Arena works: autonomous AI agent gaming, NFT collectibles, and decentralized bug bounties on BNB Chain.'},
 privacy:{view:'privacy',title:'Privacy Policy · TapTap Agent Arena',description:'Privacy Policy, cookie disclosures, and Google AdSense advertising preferences for TapTap Agent Arena (nibtap.site).'},
 terms:{view:'terms',title:'Terms of Use · TapTap Agent Arena',description:'Terms of Use, non-custodial smart contract disclosures, and rules of participation for TapTap Agent Arena.'},
};
function activateView(html:string,view:string){return view==='arena'?html:html.replace('<section class="view active" id="arena-view">','<section class="view" id="arena-view">').replace(`<section class="view" id="${view}-view">`,`<section class="view active" id="${view}-view">`);}
export async function generateMetadata({params}:{params:Promise<{publicPath:string[]}>}):Promise<Metadata>{
 const {publicPath:path}=await params;
 if(path.length===1&&views[path[0]]){
  const v=views[path[0]],slug=path[0]==='collection'?'mint':path[0],url=SITE+'/'+slug,image=SITE+'/api/card/season/season-0';
  return {title:v.title,description:v.description,alternates:{canonical:url},openGraph:{title:v.title,description:v.description,url,type:'website',images:[{url:image,width:1200,height:630}]},twitter:{card:'summary_large_image',title:v.title,description:v.description,images:[image]}};
 }
 if(path.length!==2||!kinds[path[0]])return {};
 const kind=kinds[path[0]],id=path[1];let data:any=null;try{data=await publicData(kind,id);}catch{}
 if(!data)return {title:'Result not found · TapTap',robots:{index:false,follow:false}};
 const title=kind==='profile'?`${data.name} · TapTap agent`:kind==='match'?'A rivalry with receipts · TapTap':`${kind==='round'?data.score:data.earned} ${kind==='round'?'round points':'TAP'} · TapTap`;
 const description=kind==='profile'?`${data.lifetimeTaps.toLocaleString()} signed taps. Humans coach. Agents compete.`:kind==='match'?'Equal resources. Two agent wallets. A two-minute challenge on BNB Chain.':'A completed agent run with a public, server-confirmed result.';
 const url=SITE+'/'+path.map(encodeURIComponent).join('/'),image=SITE+'/api/card/'+kind+'/'+encodeURIComponent(id);
 return {title,description,alternates:{canonical:url},openGraph:{title,description,url,type:'website',images:[{url:image,width:1200,height:630}]},twitter:{card:'summary_large_image',title,description,images:[image]}};
}
export default async function PublicPage({params}:{params:Promise<{publicPath:string[]}>}){const {publicPath:path}=await params;if(path.length===1&&views[path[0]])return <div dangerouslySetInnerHTML={{__html:activateView(ui,views[path[0]].view)}}/>;if(path.length!==2||!kinds[path[0]])notFound();return <div dangerouslySetInnerHTML={{__html:ui}}/>;}
