import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {publicData} from '../../../../../lib/public-data';
import {createPublicCard} from '../../../../generated/share-card';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{kind:string,id:string}>}){
 const {kind,id}=await params;if(!['profile','match','run','round','season'].includes(kind))return new Response('Card not found',{status:404});
 let data:any;try{data=await publicData(kind,id);}catch{return new Response('Card temporarily unavailable',{status:503});}if(!data)return new Response('Result not found',{status:404});
 let mascot:string|undefined;try{mascot='data:image/png;base64,'+readFileSync(join(process.cwd(),'public/brand/nib-mascot.png')).toString('base64');}catch{}
 try{return createPublicCard(kind,data,mascot,{regular:readFileSync(join(process.cwd(),'public/fonts/dm-sans-400.ttf')),bold:readFileSync(join(process.cwd(),'public/fonts/dm-sans-700.ttf'))});}catch{return new Response('Card temporarily unavailable',{status:503});}
}
