import {spawnSync} from 'node:child_process';
if(process.env.VERCEL==='1'){
 const secret=process.env.AUTH_SECRET;if(!secret||Buffer.byteLength(secret)<32)throw Error('Set AUTH_SECRET to at least 32 random bytes in Vercel before deploying the game.');
 if(!process.env.POSTGRES_URL&&!process.env.DATABASE_URL)throw Error('Connect PostgreSQL and set POSTGRES_URL or DATABASE_URL in Vercel before deploying the game.');
 const r=spawnSync(process.execPath,['scripts/migrate-postgres.mjs'],{stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status||1);
}
