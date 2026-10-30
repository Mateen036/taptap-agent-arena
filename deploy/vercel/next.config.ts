import type {NextConfig} from 'next';
const config:NextConfig={poweredByHeader:false,serverExternalPackages:['@resvg/resvg-js'],outputFileTracingIncludes:{'/api/nft/preview/v1/*':['./public/fonts/roboto-mono.ttf'],'/api/card/**/*':['./public/fonts/dm-sans-400.ttf','./public/fonts/dm-sans-700.ttf','./public/brand/nib-mascot.png']}};
export default config;
