import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {PostgresDatabase} from '../../deploy/vercel/lib/postgres';
const migrations=()=>fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort().map(n=>fs.readFileSync('drizzle/'+n,'utf8')).join('\n');
class Mutex{private tail:Promise<void>=Promise.resolve();async lock(){let release!:()=>void;const prior=this.tail;this.tail=new Promise<void>(r=>{release=r});await prior;return release;}}
export class SQLiteDatabase{
 raw=new DatabaseSync(':memory:');mutex=new Mutex();
 constructor(){this.raw.exec(migrations());}
 prepare(sql:string){const owner=this;return {sql,args:[] as any[],bind(...args:any[]){return {...this,args};},async first(){const release=await owner.mutex.lock();try{return owner.raw.prepare(sql).get(...this.args)||null;}finally{release();}},async all(){const release=await owner.mutex.lock();try{return {results:owner.raw.prepare(sql).all(...this.args)};}finally{release();}},async run(){const release=await owner.mutex.lock();try{return {success:true,meta:{changes:Number(owner.raw.prepare(sql).run(...this.args).changes)}};}finally{release();}}};}
 async batch(statements:any[]){const release=await this.mutex.lock();try{this.raw.exec('BEGIN IMMEDIATE');const results=statements.map(s=>({success:true,meta:{changes:Number(this.raw.prepare(s.sql).run(...s.args).changes)}}));this.raw.exec('COMMIT');return results;}catch(error){this.raw.exec('ROLLBACK');throw error;}finally{release();}}
 async close(){this.raw.close();}
}
export async function databaseFixture(kind:'sqlite'|'postgres'){
 if(kind==='sqlite')return new SQLiteDatabase();
 const pg=new PGlite();await pg.exec(migrations().replaceAll('`','"').replace(/\binteger\b/g,'bigint').replaceAll('--> statement-breakpoint',''));
 const mutex=new Mutex();const query=async(sql:string,args:any[]=[])=>{const r=await pg.query(sql,args);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};};
 const pool:any={async query(sql:string,args:any[]){const release=await mutex.lock();try{return await query(sql,args)}finally{release();}},async connect(){const release=await mutex.lock();return {query,release};}};
 const db=new PostgresDatabase(pool) as PostgresDatabase&{close:()=>Promise<void>};db.close=()=>pg.close();return db;
}
