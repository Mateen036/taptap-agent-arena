// Copies shared game code into the Cloudflare Workers target (deploy/cloudflare). Mirrors scripts/prepare-vercel.mjs.
import fs from 'node:fs';
import {execSync} from 'node:child_process';
const T='deploy/cloudflare';
fs.mkdirSync(T+'/app/generated',{recursive:true});
// nft-preview is intentionally not copied: the Workers target uses lib/nft-preview-cf.ts (resvg-wasm instead of the native resvg-js).
for(const name of ['api','game','protocol','arena','season','share-card','nft','nft-art','nft-protocol','utility','points','nft-market','airdrop','nib-market','rpc'])fs.copyFileSync('lib/'+name+'.ts',T+'/app/generated/'+name+'.ts');
fs.copyFileSync('ui/generated.ts',T+'/app/generated/ui.ts');
fs.rmSync(T+'/public',{recursive:true,force:true});
fs.cpSync('public',T+'/public',{recursive:true});
// Static asset cache headers (the Next headers() config does not apply to files served by the Workers assets binding).
const immutable='public, max-age=31536000, immutable';
fs.writeFileSync(T+'/public/_headers',[
 '/fonts/*',`  Cache-Control: ${immutable}`,
 '/brand/*','  Cache-Control: public, max-age=3600, stale-while-revalidate=86400',
 '/favicon.svg','  Cache-Control: public, max-age=86400, stale-while-revalidate=604800',
 // Scripts/styles are referenced as /file?v=<commit>; a new deploy gets a new URL.
 '/*.js',`  Cache-Control: ${immutable}`,
 '/*.mjs','  Cache-Control: public, max-age=300',
 '/*.css',`  Cache-Control: ${immutable}`,
 ''].join('\n'));
let sha='';try{sha=execSync('git rev-parse HEAD').toString().trim();}catch{}
// Unique per build (commit + build time): several deploys can be made from the same commit, and the edge HTML cache and the immutable ?v= asset URLs are keyed by this value, so a commit-only key let stale HTML/assets survive a redeploy.
fs.writeFileSync(T+'/app/generated/version.ts','export const ASSET_VERSION='+JSON.stringify((sha.slice(0,7)||'dev')+'-'+Date.now().toString(36))+';\n');
// Migrations (same schema.sql the Vercel build generates).
fs.mkdirSync(T+'/migrations',{recursive:true});
const sql=fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort().map(n=>fs.readFileSync('drizzle/'+n,'utf8')).join('\n').replace(/`/g,'"').replace(/\binteger\b/g,'bigint').replaceAll('--> statement-breakpoint','');
fs.writeFileSync(T+'/migrations/schema.sql',sql);
