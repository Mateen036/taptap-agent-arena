import fs from 'node:fs';import pg from 'pg';import {createHash} from 'node:crypto';
const url=process.env.POSTGRES_URL||process.env.DATABASE_URL;if(!url)throw Error('Set POSTGRES_URL or DATABASE_URL in your deployment environment.');
const client=new pg.Client({connectionString:url});await client.connect();
try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(812340172)');await client.query('CREATE TABLE IF NOT EXISTS taptap_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort()){
 const raw=fs.readFileSync('drizzle/'+name,'utf8'),checksum=createHash('sha256').update(raw).digest('hex'),existing=await client.query('SELECT checksum FROM taptap_migrations WHERE name=$1',[name]);if(existing.rows.length){if(existing.rows[0].checksum!==checksum)throw Error('Applied migration checksum changed: '+name);continue;}
 const sql=raw.replaceAll('`','"').replace(/\binteger\b/g,'bigint').replaceAll('--> statement-breakpoint','');await client.query(sql);await client.query('INSERT INTO taptap_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);console.log('Applied '+name);
}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
