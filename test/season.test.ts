import {test} from 'node:test';import assert from 'node:assert/strict';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {handle} from '../lib/api';import {actionData} from '../lib/protocol';
import {databaseFixture} from './helpers/database';
import {seasonAction,currentSeason} from '../lib/season';
import {arenaView,strategyDecision,arenaTick} from '../lib/arena';
for(const backend of ['sqlite','postgres'] as const)test(`${backend}: signed Season 0 flow, equal resources, private profiles, jobs and rematches`,async()=>{
 const db=await databaseFixture(backend),env:any={DB:db,BSC_RPC_URL:'https://identity.test'},oldFetch=globalThis.fetch,oldNow=Date.now;let now=Date.parse('2026-10-29T12:00:00Z');Date.now=()=>now;
 globalThis.fetch=async(_url:any,options:any)=>{const b=JSON.parse(options.body);return Response.json({jsonrpc:'2.0',id:b.id,result:b.method==='eth_chainId'?'0x38':b.method==='eth_getCode'?'0x':'0x'+1n.toString(16).padStart(64,'0')});};
 const req=async(path:string,body?:any,user='')=>{const r=await handle(new Request('https://game.test/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{'oai-authenticated-user-id':user}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json()};};
 async function player(user:string){const account=privateKeyToAccount(generatePrivateKey()),key=privateKeyToAccount(generatePrivateKey());const pair=await req('pair',{},user);const c=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:key.address});const s=await req('agent/session',{challengeId:c.body.challengeId,signature:await account.signTypedData(c.body.typedData)});assert.equal(s.status,200,JSON.stringify(s.body));let nonce=0;return {wallet:account.address.toLowerCase(),user,async act(action:string,payload:any={}){const envelope={sessionId:s.body.sessionId,nonce,timestamp:now,action,payload},signature=await key.signTypedData(actionData('https://game.test',envelope) as any);const result=await req('agent/action',{...envelope,signature});if(result.body.nonce!==undefined)nonce=result.body.nonce;return {...result,envelope,signature};}};}
 try{
 const a=await player('alpha'),b=await player('beta'),c=await player('gamma');
 await db.prepare('UPDATE agents SET points=100,earned=100,taps=100,power_level=5,speed_level=3 WHERE wallet=?').bind(a.wallet).run();
 assert.equal((await req('jobs',{kind:'daily-join',payload:{}},'stranger')).status,409);
 assert.equal((await req('profile',{name:'<script>',bio:''},a.user)).status,400);
 assert.equal((await req('profile',{name:'Nib Commander',bio:'A real test agent',strategy:'balanced'},a.user)).status,200);
 const job=await req('jobs',{kind:'season-join',payload:{}},a.user);assert.equal(job.status,201);
 assert.equal((await a.act('season-join',{jobId:job.body.id})).status,409,'Unclaimed job cannot execute');
 assert.equal((await a.act('job-start',{jobId:job.body.id})).status,200);
 assert.equal((await a.act('season-join',{jobId:job.body.id})).status,200);
 assert.equal((await a.act('job-complete',{jobId:job.body.id})).status,200);
 const command=await req('commands',{prompt:'Tap 10 times'},a.user);await a.act('start',{commandId:command.body.id});now+=2000;assert.equal((await a.act('tap',{commandId:command.body.id,taps:10})).body.agent.points,190);
 const boot=await req('bootstrap',undefined,a.user);assert.equal(boot.body.competition.seasonScore,90);assert.equal(boot.body.agent.runnerOnline,true);
 const before=boot.body.agent.points;
 const da=await a.act('arena-join',{strategy:'balanced'}),dbb=await b.act('arena-join',{strategy:'hoarder'});assert.equal(da.status,200,JSON.stringify(da.body));assert.equal(dbb.status,200,JSON.stringify(dbb.body));
 assert.equal(da.body.entry.energy,400);assert.equal(da.body.entry.power,1);assert.equal(da.body.entry.speed,dbb.body.entry.speed);assert.equal(da.body.entry.score,0);assert.equal((await a.act('arena-join',{strategy:'sprinter'})).body.entry.id,da.body.entry.id,'One immutable daily entry');
 assert.equal((await a.act('arena-tap',{entryId:da.body.entry.id,taps:100})).status,409,'No immediate taps');
 now+=10_000;const ta=await a.act('arena-tap',{entryId:da.body.entry.id,taps:50}),tb=await b.act('arena-tap',{entryId:dbb.body.entry.id,taps:50});assert.equal(ta.status,200,JSON.stringify(ta.body));assert.equal(ta.body.entry.score,tb.body.entry.score,'Lifetime upgrades do not affect arena scoring');
 assert.equal((await req('agent/action',{...ta.envelope,signature:ta.signature})).status,409);
 assert.equal((await req('agent/action',{...ta.envelope,payload:{entryId:da.body.entry.id,taps:99},signature:ta.signature})).status,403);
 assert.equal((await b.act('arena-tap',{entryId:da.body.entry.id,taps:1})).status,404);
 now+=10_000;await a.act('arena-tap',{entryId:da.body.entry.id,taps:50});const upgraded=await a.act('arena-upgrade',{entryId:da.body.entry.id,kind:'power'});assert.equal(upgraded.status,200,JSON.stringify(upgraded.body));assert.equal(upgraded.body.entry.power,2);assert.equal(upgraded.body.entry.score,20);
 assert.equal((await req('bootstrap',undefined,a.user)).body.agent.points,before,'Round upgrades never spend lifetime points');
 now+=120_000;assert.equal((await a.act('arena-tap',{entryId:da.body.entry.id,taps:1})).status,409);assert.equal((await a.act('arena-finish',{entryId:da.body.entry.id})).status,200);
 const season=await req('season');assert.equal(season.status,200,JSON.stringify(season.body));assert.equal(season.body.daily.length,2);
 const match=await a.act('duel-create',{target:b.wallet,strategy:'sprinter'});assert.equal(match.status,200,JSON.stringify(match.body));
 assert.equal((await a.act('duel-accept',{matchId:match.body.match.id})).status,400);
 assert.equal((await c.act('duel-accept',{matchId:match.body.match.id})).status,403);
 const accepted=await b.act('duel-accept',{matchId:match.body.match.id,strategy:'balanced'});assert.equal(accepted.status,200,JSON.stringify(accepted.body));assert.equal(accepted.body.match.players.length,2);assert.equal(accepted.body.match.status,'countdown');
 const ea=accepted.body.match.players.find((v:any)=>v.wallet===a.wallet),eb=accepted.body.match.players.find((v:any)=>v.wallet===b.wallet);
 assert.equal((await a.act('arena-tap',{entryId:ea.entryId,taps:1})).status,409);
 now+=20_000;assert.equal((await a.act('arena-tap',{entryId:ea.entryId,taps:25})).status,200);assert.equal((await b.act('arena-tap',{entryId:eb.entryId,taps:25})).status,200);
 now+=120_000;const result=await req('public/matches/'+match.body.match.id);assert.equal(result.body.status,'completed');assert.equal(result.body.tie,true);
 const rematch=await b.act('duel-rematch',{matchId:match.body.match.id,strategy:'balanced'});assert.equal(rematch.status,200,JSON.stringify(rematch.body));assert.equal((await b.act('duel-rematch',{matchId:match.body.match.id})).body.match.id,rematch.body.match.id,'Rematch idempotent');
 const publicAgent=await req('public/agents/'+a.wallet);assert.equal(publicAgent.body.name,'Nib Commander');const text=JSON.stringify(publicAgent.body);for(const secret of ['user_id','nonce','session_key','pairing','signature','Tap 10 times'])assert.equal(text.includes(secret),false,secret+' must remain private');
 const queued=await req('jobs',{kind:'duel-create',payload:{}},a.user);assert.equal(queued.status,201);assert.equal((await req('disconnect',{},a.user)).status,200);const stopped=await db.prepare('SELECT status FROM agent_jobs WHERE id=?').bind(queued.body.id).first<any>();assert.equal(stopped.status,'cancelled');assert.equal((await a.act('state')).status,401);
 assert.equal((await req('bootstrap',undefined,a.user)).body.agent.points,before);
 }finally{Date.now=oldNow;globalThis.fetch=oldFetch;await db.close();}
});
for(const backend of ['sqlite','postgres'] as const)test(`${backend}: cohort admission is atomic and stale/disconnected arena writes are rejected`,async()=>{
 const db=await databaseFixture(backend),env:any={DB:db},now=Date.parse('2026-10-29T12:00:00Z');
 try{await currentSeason(env,now);await db.prepare("UPDATE seasons SET capacity=5 WHERE id='season-0'").run();const players=[];
 for(let i=0;i<12;i++){const wallet='0x'+(i+1).toString(16).padStart(40,'0');await db.prepare('INSERT INTO agents(wallet,user_id,name,updated_at,created_at) VALUES(?,?,?,?,?)').bind(wallet,'load-'+i,'Load '+i,now,now).run();players.push(await db.prepare('SELECT * FROM agents WHERE wallet=?').bind(wallet).first<any>());}
 const results=await Promise.allSettled(players.map(p=>seasonAction(env,p,'season-join',{},now)));assert.equal(results.filter(r=>r.status==='fulfilled').length,5);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM season_members').first<any>()).n,5);assert.equal((await db.prepare("SELECT enrolled FROM seasons WHERE id='season-0'").first<any>()).enrolled,5);
 const p=players[0];const joined:any=await seasonAction(env,p,'arena-join',{},now);await db.prepare('UPDATE agents SET connected=0,version=version+1 WHERE wallet=?').bind(p.wallet).run();await assert.rejects(seasonAction(env,p,'arena-tap',{entryId:joined.entry.id,taps:5},now+1000),/changed|ended|maintenance/);
 assert.equal((await db.prepare('SELECT score FROM arena_entries WHERE id=?').bind(joined.entry.id).first<any>()).score,0);
 }finally{await db.close();}
});
test('materialized arena energy is not regenerated twice and idle time never creates score',()=>{
 const entry={id:'entry',rule_day:'2026-10-29',energy:0,resting:1,updated_at:0,started_at:0,ends_at:120000,power_level:1,speed_level:1,score:0,strategy:'balanced',last_tick:0};
 const view=arenaView(entry,10000);assert.equal(view.energy,60);assert.equal(strategyDecision(view,10000),null);assert.equal(view.score,0);
 const active={...entry,energy:400,resting:0};const t=arenaTick(active,100,60000);assert.ok(t.taps<=70,'Heartbeat cap applies to offline time');
});
for(const backend of ['sqlite','postgres'] as const)test(`${backend}: concurrent challenge acceptance, round overlap, UTC rollover and freeze`,async()=>{
 const db=await databaseFixture(backend),env:any={DB:db};let now=Date.parse('2026-10-29T12:00:00Z');
 try{
  const players=[];for(let i=0;i<3;i++){const wallet='0x'+(i+101).toString(16).padStart(40,'0');await db.prepare('INSERT INTO agents(wallet,user_id,name,updated_at,created_at) VALUES(?,?,?,?,?)').bind(wallet,'race-'+i,'Race '+i,now,now).run();players.push(await db.prepare('SELECT * FROM agents WHERE wallet=?').bind(wallet).first<any>());}
  const [a,b,c]=players;const created:any=await seasonAction(env,a,'duel-create',{},now);
  const accepted=await Promise.allSettled([b,c].map(p=>seasonAction(env,p,'duel-accept',{matchId:created.match.id},now)));
  assert.equal(accepted.filter(r=>r.status==='fulfilled').length,1);
  const entries=await db.prepare('SELECT * FROM arena_entries WHERE room_id=?').bind(created.match.id).all<any>();assert.equal(entries.results.length,2);
  await assert.rejects(seasonAction(env,a,'arena-join',{},now),/current arena round/);
  await db.prepare("INSERT INTO game_settings(key,value) VALUES('season_phase_v3','frozen')").run();
  now+=20000;await assert.rejects(seasonAction(env,a,'arena-tap',{entryId:entries.results.find(e=>e.wallet===a.wallet).id,taps:25},now),/closed/);
  assert.equal(Number((await db.prepare('SELECT SUM(score) AS n FROM arena_entries').first<any>()).n),0);
  await db.prepare("DELETE FROM game_settings WHERE key='season_phase_v3'").run();
  now=Date.parse('2026-10-29T23:59:30Z');await assert.rejects(seasonAction(env,a,'arena-join',{},now),/next daily round/);
  now=Date.parse('2026-10-30T00:00:01Z');const next:any=await seasonAction(env,a,'arena-join',{},now);assert.equal(next.entry.daily_day,'2026-10-30');assert.equal(next.entry.energy,400);
  now+=8*86400000;await assert.rejects(seasonAction(env,a,'duel-create',{},now),/closed/);
 }finally{await db.close();}
});

for(const backend of ['sqlite','postgres'] as const)test(`${backend}: scored taps auto-enroll agents in the founding cohort once, atomically, and respect capacity`,async()=>{
 const db=await databaseFixture(backend),env:any={DB:db,BSC_RPC_URL:'https://identity.test'},oldFetch=globalThis.fetch,oldNow=Date.now;let now=Date.parse('2026-10-29T12:00:00Z');Date.now=()=>now;
 globalThis.fetch=async(_url:any,options:any)=>{const b=JSON.parse(options.body);return Response.json({jsonrpc:'2.0',id:b.id,result:b.method==='eth_chainId'?'0x38':b.method==='eth_getCode'?'0x':'0x'+1n.toString(16).padStart(64,'0')});};
 const req=async(path:string,body?:any,user='')=>{const r=await handle(new Request('https://game.test/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{'oai-authenticated-user-id':user}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json()};};
 async function player(user:string){const account=privateKeyToAccount(generatePrivateKey()),key=privateKeyToAccount(generatePrivateKey());const pair=await req('pair',{},user);const c=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:key.address});const s=await req('agent/session',{challengeId:c.body.challengeId,signature:await account.signTypedData(c.body.typedData)});assert.equal(s.status,200,JSON.stringify(s.body));let nonce=0;return {wallet:account.address.toLowerCase(),user,async act(action:string,payload:any={}){const envelope={sessionId:s.body.sessionId,nonce,timestamp:now,action,payload},signature=await key.signTypedData(actionData('https://game.test',envelope) as any);const result=await req('agent/action',{...envelope,signature});if(result.body.nonce!==undefined)nonce=result.body.nonce;return {...result,envelope,signature};}};}
 try{
 const a=await player('auto-a'),b=await player('auto-b'),c=await player('auto-c');
 const enrolled=async()=>(await db.prepare("SELECT enrolled FROM seasons WHERE id='season-0'").first<any>()).enrolled;
 const members=async()=>(await db.prepare('SELECT COUNT(*) AS n FROM season_members').first<any>()).n;
 const tap=async(p:any,n:number)=>{const cmd=await req('commands',{prompt:'Tap '+n+' times'},p.user);assert.equal(cmd.status,201,JSON.stringify(cmd.body));assert.equal((await p.act('start',{commandId:cmd.body.id})).status,200);now+=2000;const r=await p.act('tap',{commandId:cmd.body.id,taps:n});assert.equal(r.status,200,JSON.stringify(r.body));return r;};
 await req('bootstrap',undefined,a.user);
 assert.equal(await members(),0);
 await tap(a,10);
 assert.equal(await members(),1);assert.equal(await enrolled(),1);
 let boot=await req('bootstrap',undefined,a.user);assert.equal(boot.body.competition.member,true);assert.equal(boot.body.competition.seasonScore,10);
 await tap(a,10);assert.equal(await members(),1);assert.equal(await enrolled(),1);
 boot=await req('bootstrap',undefined,a.user);assert.equal(boot.body.competition.seasonScore,20);
 assert.equal((await a.act('season-join',{})).status,200);assert.equal(await members(),1);assert.equal(await enrolled(),1);
 assert.equal((await b.act('season-join',{})).status,200);assert.equal(await members(),2);await tap(b,10);assert.equal(await members(),2);assert.equal(await enrolled(),2);
 await db.prepare("UPDATE seasons SET capacity=2 WHERE id='season-0'").run();
 await tap(c,10);assert.equal(await members(),2);assert.equal(await enrolled(),2);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM season_scores WHERE wallet=?').bind(c.wallet).first<any>()).n,0);
 assert.equal((await db.prepare('SELECT taps FROM agents WHERE wallet=?').bind(c.wallet).first<any>()).taps,10);
 const lb=(await req('season')).body.leaderboard.map((v:any)=>v.wallet).sort();assert.deepEqual(lb,[a.wallet,b.wallet].sort());
 }finally{globalThis.fetch=oldFetch;Date.now=oldNow;await db.close();}
});
