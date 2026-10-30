// Operator-only release command. Never imported into API routes.
import fs from 'node:fs';import {pathToFileURL} from 'node:url';
import pg from 'pg';import {createPublicClient,http,parseAbi} from 'viem';import {bsc} from 'viem/chains';
import {nftDeploymentPlan,normalizeRuntime} from './nft-deploy';import {nftGameHolding} from '../lib/nft';import {nftAbi} from '../lib/nft-protocol';
import {PostgresDatabase} from '../deploy/vercel/lib/postgres';
export async function freezeLegacy(client:any,now:number){
 const active=await client.query("SELECT value FROM game_settings WHERE key='nft_utility_v2'");if(active.rows[0]?.value==='active')throw Error('Utility is already active. Never revert to legacy numeric accounting.');
 await client.query("INSERT INTO game_settings(key,value) SELECT 'nft_utility_v2_previous_phase',COALESCE((SELECT value FROM game_settings WHERE key='season_phase_v3'),'open') ON CONFLICT(key) DO NOTHING");
 await client.query("INSERT INTO game_settings(key,value) VALUES('season_phase','frozen'),('season_phase_v2','frozen'),('season_phase_v3','frozen') ON CONFLICT(key) DO UPDATE SET value='frozen'");
 await client.query("INSERT INTO game_settings(key,value) VALUES('nft_utility_v2_frozen_at',$1) ON CONFLICT(key) DO NOTHING",[String(now)]);
}
export async function activateExact(client:any,now:number){
 const row=await client.query("SELECT value FROM game_settings WHERE key='nft_utility_v2_frozen_at'");if(!row.rows.length||now-Number(row.rows[0].value)<60000)throw Error('Freeze all runtime generations first, then allow at least 60 seconds for in-flight requests to drain.');
 const phases=await client.query("SELECT key,value FROM game_settings WHERE key IN ('season_phase','season_phase_v2','season_phase_v3')");if(phases.rows.length!==3||phases.rows.some((v:any)=>v.value!=='frozen'))throw Error('All legacy and current game runtimes must be frozen before activation.');
 await client.query('UPDATE agents SET points_exact=COALESCE(points_exact,CAST(points AS TEXT)),earned_exact=COALESCE(earned_exact,CAST(earned AS TEXT))');
 await client.query('UPDATE commands SET earned_exact=COALESCE(earned_exact,CAST(earned AS TEXT))');
 await client.query('UPDATE ledger SET delta_exact=COALESCE(delta_exact,CAST(delta AS TEXT))');
 await client.query("INSERT INTO game_settings(key,value) VALUES('nft_utility_v2','active') ON CONFLICT(key) DO UPDATE SET value='active'");
 await client.query("UPDATE game_settings SET value=COALESCE((SELECT value FROM game_settings WHERE key='nft_utility_v2_previous_phase'),'open') WHERE key='season_phase_v3'");
}
async function run(){
 const mode=process.argv[2]||'check';if(!['check','freeze','activate'].includes(mode))throw Error('Use check, freeze or activate.');
 const owner=process.env.ADMIN_WALLET as `0x${string}`,plan=nftDeploymentPlan(owner),env:any=process.env;
 for(const [key,value]of [['NFT_COLLECTION',plan.contracts.collection],['NFT_MARKETPLACE',plan.contracts.market],['NFT_LP_VAULT',plan.contracts.vault]])if(env[key]?.toLowerCase()!==value.toLowerCase())throw Error('Environment differs from reviewed deployment: '+key);
 const chain=createPublicClient({chain:bsc,transport:http(env.NFT_RPC_URL||env.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org')});if(await chain.getChainId()!==56)throw Error('BNB mainnet required.');
 for(const step of plan.steps){const art=JSON.parse(fs.readFileSync('artifacts/'+step.name+'.json','utf8')),code=await chain.getCode({address:step.address});if(!code||normalizeRuntime(code,art)!==art.deployedBytecode)throw Error(step.name+' is missing or has unexpected bytecode.');}
 if((await chain.readContract({address:plan.contracts.collection,abi:nftAbi,functionName:'renderer'})).toLowerCase()!==plan.contracts.renderer.toLowerCase())throw Error('Unexpected renderer link.');
 const ownerAbi=parseAbi(['function owner() view returns(address)']);for(const address of [plan.contracts.collection,plan.contracts.vault])if((await chain.readContract({address,abi:ownerAbi,functionName:'owner'})).toLowerCase()!==owner.toLowerCase())throw Error('Unexpected contract owner.');
 const pool=new pg.Pool({connectionString:env.POSTGRES_URL||env.DATABASE_URL,max:1});
 try{
 await nftGameHolding({...env,DB:new PostgresDatabase(pool)},owner); // Checks immutable links and economics too.
 const db=await pool.connect();try{
 await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(812340172)');
 await db.query('SELECT points_exact,earned_exact FROM agents LIMIT 1');await db.query('SELECT earned_exact FROM commands LIMIT 1');await db.query('SELECT delta_exact FROM ledger LIMIT 1');
 if(mode==='freeze')await freezeLegacy(db,Date.now());
 if(mode==='activate')await activateExact(db,Date.now());
 await db.query('COMMIT');console.log(JSON.stringify({ok:true,mode,chainId:56,contracts:plan.contracts,next:mode==='freeze'?'Wait at least 60 seconds, then run activate. Legacy deployments stay frozen permanently.':mode==='activate'?'Verify NFT-less rejection, first free mint, transfer locks and boosted earnings on production.':'Checks passed. No data changed.'}));
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
 }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(error=>{console.error(error.message);process.exitCode=1;});
