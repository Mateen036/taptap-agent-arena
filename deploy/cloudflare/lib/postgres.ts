import {Pool,types} from 'pg';
// D1's integer fields are all bounded below Number.MAX_SAFE_INTEGER. Token units remain TEXT.
types.setTypeParser(20,value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw Error('Database integer exceeds the safe game range.');return n;});
export function placeholders(sql:string){let index=0,quote='';let out='';for(let i=0;i<sql.length;i++){const c=sql[i];if(quote){out+=c;if(c===quote){if(sql[i+1]===quote){out+=sql[++i];}else quote='';}}else if(c==="'"||c==='"'){quote=c;out+=c;}else out+=c==='?'?'$'+(++index):c;}return out;}
class Prepared {
 args:any[]=[];
 constructor(readonly db:PostgresDatabase,readonly sql:string){}
 bind(...args:any[]){const s=new Prepared(this.db,this.sql);s.args=args;return s;}
 async first<T=any>():Promise<T|null>{const r=await this.db.pool.query(placeholders(this.sql),this.args);return r.rows[0]||null;}
 async all<T=any>():Promise<{results:T[]}>{const r=await this.db.pool.query(placeholders(this.sql),this.args);return {results:r.rows};}
 async run(){const r=await this.db.pool.query(placeholders(this.sql),this.args);return {success:true,meta:{changes:r.rowCount||0}};}
}
export class PostgresDatabase{
 constructor(readonly pool:Pick<Pool,'query'|'connect'>){}
 prepare(sql:string){return new Prepared(this,sql);}
 async batch(statements:Prepared[]){for(let attempt=0;attempt<3;attempt++){const client=await this.pool.connect();try{await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');const results=[];for(const s of statements){const r=await client.query(placeholders(s.sql),s.args);results.push({success:true,meta:{changes:r.rowCount||0}});}await client.query('COMMIT');return results;}catch(error:any){await client.query('ROLLBACK');if(!['40001','40P01'].includes(error.code)||attempt===2)throw error;}finally{client.release();}}throw Error('Transaction retry limit.');}
}
// Cloudflare Workers cannot share I/O objects (TCP sockets) between requests, so a Pool must never outlive the request that created it.
// One short-lived pool is created per request (database() is called once per request) and its sockets are closed with the request.
export function database(){
 const url=process.env.POSTGRES_URL||process.env.DATABASE_URL;
 if(!url)throw Error('Connect a PostgreSQL database and configure POSTGRES_URL or DATABASE_URL before enabling gameplay.');
 // pg does not need channel_binding; Neon accepts SCRAM without it when sslmode=require.
 const u=new URL(url);u.searchParams.delete('channel_binding');
 const pool=new Pool({connectionString:u.toString(),max:3,idleTimeoutMillis:5000,connectionTimeoutMillis:8000});
 pool.on('error',()=>{});
 return new PostgresDatabase(pool);
}
