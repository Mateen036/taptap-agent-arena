// Node-only website previews. The on-chain renderer and original SVG/metadata stay unchanged.
import {join} from 'node:path';import {Resvg} from '@resvg/resvg-js';
import {nftSvg} from './nft-art';
const previews=new Map<number,Uint8Array>();
export function nftPreviewResponse(filename:string):Response{
 if(!/^(?:[1-9][0-9]{0,3}|10000)\.png$/.test(filename))return new Response('NFT preview not found',{status:404});
 const id=Number(filename.slice(0,-4));
 try{
  let png=previews.get(id);
  if(!png){
   const renderer=new Resvg(nftSvg(id),{font:{loadSystemFonts:false,fontFiles:[join(process.cwd(),'public/fonts/roboto-mono.ttf')],defaultFontFamily:'Roboto Mono',monospaceFamily:'Roboto Mono'}});
   png=new Uint8Array(renderer.render().asPng());if(previews.size>=64)previews.delete(previews.keys().next().value!);previews.set(id,png);
  }
  return new Response(new Uint8Array(png),{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=31536000, immutable','CDN-Cache-Control':'public, s-maxage=31536000','Vercel-CDN-Cache-Control':'public, s-maxage=31536000','X-Content-Type-Options':'nosniff'}});
 }catch(error){console.error('NFT preview unavailable',error instanceof Error?error.name:'unknown');return new Response('NFT preview temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
}
