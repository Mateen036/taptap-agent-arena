import {getCloudflareContext} from '@opennextjs/cloudflare';
// Workers have no filesystem: read bundled static files (fonts, mascot) through the assets binding instead.
const cache=new Map<string,Uint8Array>();
export async function asset(path:string):Promise<Uint8Array>{
 const hit=cache.get(path);if(hit)return hit;
 const {env}=getCloudflareContext();
 const response=await (env as any).ASSETS.fetch(new Request('https://assets.invalid'+path));
 if(!response.ok)throw Error('Asset unavailable: '+path);
 const bytes=new Uint8Array(await response.arrayBuffer());cache.set(path,bytes);return bytes;
}
