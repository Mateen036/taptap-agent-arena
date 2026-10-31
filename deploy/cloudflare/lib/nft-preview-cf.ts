// Workers variant of lib/nft-preview.ts: same SVG, rendered with the WebAssembly build of resvg.
// Imported only from worker.ts (bundled by Wrangler, which supports .wasm module imports; Next's bundler does not).
import {initWasm,Resvg} from '@resvg/resvg-wasm';
// @ts-ignore wasm module import resolved by the Workers bundler
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import {nftSvg} from '../app/generated/nft-art';
const previews=new Map<number,Uint8Array>();
let ready:Promise<void>|undefined;
let font:Uint8Array|undefined;
export async function nftPreviewResponse(filename:string,loadFont:()=>Promise<Uint8Array>):Promise<Response>{
 if(!/^(?:[1-9][0-9]{0,3}|10000)\.png$/.test(filename))return new Response('NFT preview not found',{status:404});
 const id=Number(filename.slice(0,-4));
 try{
  let png=previews.get(id);
  if(!png){
   ready??=initWasm(resvgWasm);await ready;
   font??=await loadFont();
   const renderer=new Resvg(nftSvg(id),{font:{loadSystemFonts:false,fontBuffers:[font],defaultFontFamily:'Roboto Mono',monospaceFamily:'Roboto Mono'}});
   png=new Uint8Array(renderer.render().asPng());if(previews.size>=64)previews.delete(previews.keys().next().value!);previews.set(id,png);
  }
  return new Response(new Uint8Array(png),{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
 }catch(error){ready=undefined;console.error('NFT preview unavailable',error instanceof Error?error.message:'unknown');return new Response('NFT preview temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
}
