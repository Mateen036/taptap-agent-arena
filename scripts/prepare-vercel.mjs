import fs from 'node:fs';
fs.mkdirSync('deploy/vercel/app/generated',{recursive:true});
for(const name of ['api','game','protocol'])fs.copyFileSync('lib/'+name+'.ts','deploy/vercel/app/generated/'+name+'.ts');
fs.copyFileSync('ui/generated.ts','deploy/vercel/app/generated/ui.ts');
fs.cpSync('public','deploy/vercel/public',{recursive:true});
// Keep deployment configuration explicit and fail closed when runtime storage is missing.
fs.mkdirSync('deploy/vercel/migrations',{recursive:true});
const sql=fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort().map(n=>fs.readFileSync('drizzle/'+n,'utf8')).join('\n').replaceAll('`','"').replace(/\binteger\b/g,'bigint').replaceAll('--> statement-breakpoint','');
fs.writeFileSync('deploy/vercel/migrations/schema.sql',sql);
