import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import fs from 'node:fs';
import {PostgresDatabase,placeholders} from '../deploy/vercel/lib/postgres';import {browserSession} from '../deploy/vercel/lib/browser-session';import {handle} from '../lib/api';
test('PostgreSQL adapter executes game SQL and rolls back ledger batches',async()=>{
 const pg=new PGlite();const schema=fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort().map(n=>fs.readFileSync('drizzle/'+n,'utf8')).join('\n').replaceAll('`','"').replace(/\binteger\b/g,'bigint').replaceAll('--> statement-breakpoint','');await pg.exec(schema);
 const query=async(sql:string,args:any[]=[])=>{const r=await pg.query(sql,args);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};};
 const pool:any={query,async connect(){return {query,release(){}};}};const db=new PostgresDatabase(pool);
 try{
 await db.prepare('INSERT INTO agents(wallet,user_id,name,updated_at,created_at) VALUES(?,?,?,?,?)').bind('wallet','user','Agent',1800000000000,1800000000000).run();
 const a:any=await db.prepare('SELECT * FROM agents WHERE user_id=?').bind('user').first();assert.equal(Number(a.points),0);assert.equal(Number(a.created_at),1800000000000);
 const request=async(path:string,body?:any)=>{const r=await handle(new Request('https://game.test/api/'+path,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':'user',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),{DB:db,STORAGE_NAME:'PostgreSQL'} as any);return {status:r.status,body:await r.json()};};
 assert.equal((await request('health')).body.storage,'PostgreSQL');const command=await request('commands',{prompt:'Tap 100 times'});assert.equal(command.status,201);assert.equal((await request('commands/cancel',{id:command.body.id})).status,200);
 const bootstrap=await request('bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.body.agent.points,0);assert.equal(bootstrap.body.agent.commands[0].status,'cancelled');
 await assert.rejects(db.batch([db.prepare('UPDATE agents SET points=points+? WHERE wallet=?').bind(100,'wallet'),db.prepare('INSERT INTO missing_table(id) VALUES(?)').bind('x')]));assert.equal(Number((await db.prepare('SELECT points FROM agents WHERE wallet=?').bind('wallet').first<any>()).points),0);
 assert.equal(placeholders("SELECT '?' AS literal, ? AS value, 'it''s ?' AS text"),"SELECT '?' AS literal, $1 AS value, 'it''s ?' AS text");
 }finally{await pg.close();}
});
test('Vercel browser sessions reject spoofing and preserve signed accounts',()=>{
 const original=process.env.AUTH_SECRET;process.env.AUTH_SECRET='a'.repeat(64);
 try{const first=browserSession(new Request('https://game.test/api/bootstrap'));assert.ok(first.cookie?.includes('HttpOnly'));assert.ok(first.cookie?.includes('Secure'));const cookie=first.cookie!.split(';')[0];const second=browserSession(new Request('https://game.test/api/bootstrap',{headers:{cookie}}));assert.equal(second.userId,first.userId);assert.equal(second.cookie,null);const forged=browserSession(new Request('https://game.test/api/bootstrap',{headers:{cookie:cookie.slice(0,-1)+(cookie.endsWith('0')?'1':'0')}}));assert.notEqual(forged.userId,first.userId);
 delete process.env.AUTH_SECRET;assert.throws(()=>browserSession(new Request('https://game.test/api/bootstrap')));
 }finally{if(original===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=original;}
});
