import {build} from 'esbuild';
await build({entryPoints:['agent/connector.ts'],outfile:'public/taptap-agent.mjs',bundle:true,platform:'node',format:'esm',target:'node22',minify:false,legalComments:'eof'});
