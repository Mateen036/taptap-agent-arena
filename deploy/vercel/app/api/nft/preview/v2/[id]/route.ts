import {nftPreviewResponse} from '../../../../../generated/nft-preview';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=10;
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){return nftPreviewResponse((await params).id);}
