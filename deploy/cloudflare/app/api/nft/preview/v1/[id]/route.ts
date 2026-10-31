// Legacy preview URLs forward to the current branded image version.
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^(?:[1-9][0-9]{0,3}|10000)\.png$/.test(id))return new Response('NFT preview not found',{status:404});
 return new Response(null,{status:307,headers:{Location:'https://www.nibtap.site/api/nft/preview/v2/'+id,'Cache-Control':'public, max-age=86400'}});
}
