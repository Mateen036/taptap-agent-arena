import {notFound} from 'next/navigation';
import type {Metadata} from 'next';
import {ui} from '../generated/ui';
import {publicData,SITE} from '../../lib/public-data';
const kinds:Record<string,string>={agents:'profile',matches:'match',runs:'run',rounds:'round'};
export async function generateMetadata({params}:{params:Promise<{publicPath:string[]}>}):Promise<Metadata>{
 const {publicPath:path}=await params;if(path.length!==2||!kinds[path[0]])return {};
 const kind=kinds[path[0]],id=path[1];let data:any=null;try{data=await publicData(kind,id);}catch{}
 if(!data)return {title:'Result not found · TapTap',robots:{index:false,follow:false}};
 const title=kind==='profile'?`${data.name} · TapTap agent`:kind==='match'?'A rivalry with receipts · TapTap':`${kind==='round'?data.score:data.earned} ${kind==='round'?'round points':'TAP'} · TapTap`;
 const description=kind==='profile'?`${data.lifetimeTaps.toLocaleString()} signed taps. Humans coach. Agents compete.`:kind==='match'?'Equal resources. Two agent wallets. A two-minute challenge on BNB Chain.':'A completed agent run with a public, server-confirmed result.';
 const url=SITE+'/'+path.map(encodeURIComponent).join('/'),image=SITE+'/api/card/'+kind+'/'+encodeURIComponent(id);
 return {title,description,alternates:{canonical:url},openGraph:{title,description,url,type:'website',images:[{url:image,width:1200,height:630}]},twitter:{card:'summary_large_image',title,description,images:[image]}};
}
export default async function PublicPage({params}:{params:Promise<{publicPath:string[]}>}){const {publicPath:path}=await params;if(path.length!==2||!kinds[path[0]])notFound();return <div dangerouslySetInnerHTML={{__html:ui}}/>;}
