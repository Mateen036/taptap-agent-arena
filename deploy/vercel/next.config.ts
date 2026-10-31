import type {NextConfig} from 'next';
const immutable='public, max-age=31536000, immutable';
const asset=(source:string,value:string,versioned=false)=>({source,...(versioned?{has:[{type:'query' as const,key:'v'}]}:{}),headers:[{key:'Cache-Control',value}]});
const config:NextConfig={poweredByHeader:false,serverExternalPackages:['@resvg/resvg-js'],outputFileTracingIncludes:{'/api/nft/preview/v2/*':['./public/fonts/roboto-mono.ttf'],'/api/card/**/*':['./public/fonts/dm-sans-400.ttf','./public/fonts/dm-sans-700.ttf','./public/brand/nib-mascot.png']},
 // Repeat visitors should not re-request static files on every page load (each 304 still counts as an edge request).
 async headers(){return [
  asset('/fonts/:path*',immutable),
  asset('/brand/:path*','public, max-age=3600, stale-while-revalidate=86400'),
  // Scripts and styles are referenced as /file?v=<commit>, so a new deploy gets a new URL and can be cached forever.
  asset('/:file(.+\\.js)',immutable,true),
  asset('/:file(.+\\.css)',immutable,true),
  asset('/favicon.svg','public, max-age=86400, stale-while-revalidate=604800'),
 ];},
};
export default config;
