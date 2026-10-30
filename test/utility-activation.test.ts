import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import fs from 'node:fs';
import {freezeLegacy,activateExact} from '../scripts/activate-nft-utility';
test('release preserves balances, drains legacy writes and permanently quarantines old deployments',async()=>{
 const db=new PGlite();try{
 const sql=fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort().map(n=>fs.readFileSync('drizzle/'+n,'utf8')).join('\n');await db.exec(sql.replaceAll('`','"').replace(/\binteger\b/g,'bigint').replaceAll('--> statement-breakpoint',''));
 await db.query("INSERT INTO agents(wallet,user_id,name,points,earned,created_at,updated_at) VALUES('wallet','user','Agent',123,456,0,0)");
 await freezeLegacy(db,1000);await assert.rejects(activateExact(db,60000),/60 seconds/);
 await activateExact(db,61000);const agent:any=(await db.query('SELECT points_exact,earned_exact FROM agents')).rows[0];assert.equal(agent.points_exact,'123');assert.equal(agent.earned_exact,'456');
 const old:any=await db.query("UPDATE agents SET points=999 WHERE NOT EXISTS(SELECT 1 FROM game_settings WHERE key='season_phase' AND value='frozen') RETURNING wallet");assert.equal(old.rows.length,0,'Old deployment SQL cannot award legacy unboosted points');
 assert.equal((await db.query("SELECT value FROM game_settings WHERE key='season_phase_v2'")).rows[0].value,'open');assert.equal((await db.query("SELECT value FROM game_settings WHERE key='nft_utility_v1'")).rows[0].value,'active');await assert.rejects(freezeLegacy(db,70000),/already active/);
 }finally{await db.close();}
});
