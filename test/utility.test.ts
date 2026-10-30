import {test} from 'node:test';import assert from 'node:assert/strict';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {handle} from '../lib/api';import {actionData,AGENT_ID_REGISTRY} from '../lib/protocol';
import {nftMultiplier,pointFields,publicPoints,displayPoints,exactPoints} from '../lib/points';
import {NFT_PAYMENT} from '../lib/nft-protocol';import {databaseFixture} from './helpers/database';import {nftChain} from './helpers/nft-chain';
test('fixed 5x per NFT is linear across the complete collection supply',()=>{
 assert.equal(nftMultiplier(0),0n);assert.equal(nftMultiplier(1),5n);assert.equal(nftMultiplier(3),15n);assert.equal(nftMultiplier(10),50n);
 const max=nftMultiplier(10000);assert.equal(nftMultiplier(2),10n);assert.equal(nftMultiplier(100),500n);assert.equal(max,50000n);assert.equal(nftMultiplier(9999)+5n,max);assert.equal(BigInt(publicPoints(max)),max);assert.equal(pointFields(max,max,true).points_exact,max.toString());assert.equal(displayPoints(max),'50,000');assert.throws(()=>nftMultiplier(10001));assert.throws(()=>exactPoints(Number.MAX_SAFE_INTEGER+1));
});
test('real-chain NFT utility: fresh ownership, exact TAP, independent competition and API enforcement',async t=>{
 const f=await nftChain(),nativeNow=Date.now;let offset=0;Date.now=()=>nativeNow()+offset;
 const abi=f.art('NibCollection').abi;
 async function mint(who:number,n=1){if(n>1)await f.write(NFT_PAYMENT,f.m.MockToken.abi,'approve',[f.collection,BigInt(n-1)*10n**18n],who);await f.write(f.collection,abi,'mint',[BigInt(n),BigInt(n-1)*10n**18n,await f.deadline(),f.intent()],who);}
 async function transfer(id:number,from:number,to:number){await f.write(f.collection,abi,'transferFrom',[f.accounts[from].address,f.accounts[to].address,BigInt(id)],from);}
 try{await mint(1);await mint(2);await mint(3); // ids 1, 2, 3
 for(const backend of ['sqlite','postgres'] as const)await t.test(backend,async()=>{
 const snapshot=await f.provider.request({method:'evm_snapshot',params:[]});
 const db=await databaseFixture(backend),env:any={DB:db,BSC_RPC_URL:f.rpc,NFT_RPC_URL:f.rpc,NFT_COLLECTION:f.collection,NFT_MARKETPLACE:f.market,NFT_LP_VAULT:f.vault,NFT_GAME_UTILITY:'true'};
 const req=async(path:string,body?:any,user='')=>{const r=await handle(new Request('https://game.test/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(user?{'oai-authenticated-user-id':user}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json() as any};};
 async function player(who:number,user:string){const account=f.accounts[who],key=privateKeyToAccount(generatePrivateKey()),pair=await req('pair',{},user),c=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:key.address}),s=await req('agent/session',{challengeId:c.body.challengeId,signature:await account.signTypedData(c.body.typedData)});assert.equal(s.status,200,JSON.stringify(s.body));let nonce=0;return {wallet:account.address.toLowerCase(),user,async act(action:string,payload:any={}){const envelope={sessionId:s.body.sessionId,nonce,timestamp:Date.now(),action,payload},signature=await key.signTypedData(actionData('https://game.test',envelope) as any),result=await req('agent/action',{...envelope,signature});if(result.body.nonce!==undefined)nonce=result.body.nonce;return {...result,envelope,signature};}};}
 try{
 const a=await player(1,'alpha'),b=await player(2,'beta'),z=await player(4,'zero');
 assert.equal((await z.act('state')).body.agent.gameAccess.canPlay,false,'NFT-less agents can pair and read tasks');
 for(const [path,payload] of [['commands',{prompt:'Tap 5 times'}],['jobs',{kind:'daily-join',payload:{}}],['upgrades',{index:0}],['missions/claim',{index:0}]] as const)assert.equal((await req(path,payload,z.user)).status,403,path);
 for(const action of ['start','tap','season-join','arena-join','arena-tap','arena-upgrade','duel-create','duel-accept','duel-rematch'])assert.equal((await z.act(action,{commandId:'none',entryId:'none',taps:1})).status,403,action);
 const intent=await req('nft/intents',{kind:'mint',quantity:1},z.user);assert.equal(intent.status,201,JSON.stringify(intent.body));assert.equal((await z.act('nft-state')).status,200,'NFT tasks bypass game gate');
 await db.prepare('UPDATE agents SET points=123,earned=123 WHERE wallet=?').bind(a.wallet).run();
 assert.equal((await a.act('season-join')).status,200);
 const command=await req('commands',{prompt:'Tap 20 times'},a.user);assert.equal(command.status,201);const cid=command.body.id;assert.equal((await a.act('start',{commandId:cid})).status,200);
 async function tap(owned:number){offset+=1100;const r=await a.act('tap',{commandId:cid,taps:5});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.agent.gameAccess.owned,owned);assert.equal(r.body.agent.gameAccess.multiplier,String(5*owned));assert.equal(r.body.agent.gameAccess.formula,'5*owned');return r;}
 assert.equal((await tap(1)).body.agent.points,148);
 await transfer(2,2,1);assert.equal((await tap(2)).body.agent.points,198);
 await transfer(3,3,1);const boosted=await tap(3);assert.equal(boosted.body.agent.points,273);assert.equal(boosted.body.agent.commands[0].earned,150);
 const boot=await req('bootstrap',undefined,a.user);assert.equal(boot.body.competition.seasonScore,15,'Season points use base gain');assert.equal(boot.body.agent.missions[0].reward,7500);
 assert.equal((await req('agent/action',{...boosted.envelope,signature:boosted.signature})).status,409,'Replay cannot earn twice');
 await transfer(1,1,4);await transfer(2,1,2);await transfer(3,1,3);
 const denied=await a.act('tap',{commandId:cid,taps:5});assert.equal(denied.status,403);assert.equal((await req('bootstrap',undefined,a.user)).body.agent.points,273);
 assert.equal((await a.act('stop',{commandId:cid})).status,200,'Cleanup works without NFT');
 await transfer(1,4,1);assert.equal((await a.act('start',{commandId:cid})).status,200);assert.equal((await tap(1)).body.agent.points,298);
 const claim=await req('missions/claim',{index:0},a.user);assert.equal(claim.status,200);assert.equal((await req('bootstrap',undefined,a.user)).body.agent.points,2798);assert.equal((await req('missions/claim',{index:0},a.user)).status,409);
 // Current holdings, independent of mintedBy or the 10-NFT mint allocation.
 const supply=Number(await f.read(f.collection,abi,'totalSupply'));
 for(let who=5;who<=10;who++){await mint(who,10);for(let j=1;j<=10;j++)await transfer(supply+(who-5)*10+j,who,1);}
 const large=9007199254740993123456789n,fields=pointFields(large,large,true);
 await db.prepare('UPDATE agents SET points=?,earned=?,points_exact=?,earned_exact=? WHERE wallet=?').bind(fields.points,fields.earned,fields.points_exact,fields.earned_exact,a.wallet).run();
 const bigcommand=await req('commands',{prompt:'Tap 5 times'},a.user);assert.equal(bigcommand.status,201);await a.act('start',{commandId:bigcommand.body.id});offset+=1100;const big=await a.act('tap',{commandId:bigcommand.body.id,taps:5});assert.equal(big.status,200,JSON.stringify(big.body));const gain=5n*nftMultiplier(61),expected=large+gain;assert.equal(big.body.agent.points,expected.toString());assert.equal(big.body.agent.commands.find((c:any)=>c.id===bigcommand.body.id).earned,publicPoints(gain));assert.equal(big.body.agent.logs.find((l:any)=>l.kind==='tap').delta,publicPoints(gain));
 const upgrade=await req('upgrades',{index:0},a.user);assert.equal(upgrade.status,200);assert.equal((await req('bootstrap',undefined,a.user)).body.agent.points,(expected-1500n).toString());
 const run=await req('public/runs/'+bigcommand.body.id);assert.equal(run.body.earned,publicPoints(gain));assert.equal(JSON.stringify(run.body).includes('prompt'),false);
 const profile=await req('public/agents/'+a.wallet);assert.equal(profile.body.points,(expected-1500n).toString());assert.equal(profile.body.lifetimeEarned,expected.toString());
 // Two large exact totals are ordered lexically only after length comparison.
 await db.prepare('UPDATE agents SET earned=1,earned_exact=? WHERE wallet=?').bind((large+gain+1n).toString(),b.wallet).run();assert.equal((await req('bootstrap')).body.leaderboard[0].wallet,b.wallet);
 const ar=await a.act('arena-join',{}),br=await b.act('arena-join',{});assert.equal(ar.status,200);assert.equal(br.status,200);offset+=2000;
 const at=await a.act('arena-tap',{entryId:ar.body.entry.id,taps:5}),bt=await b.act('arena-tap',{entryId:br.body.entry.id,taps:5});assert.equal(at.status,200);assert.equal(at.body.entry.score,bt.body.entry.score,'61 NFTs and 1 NFT receive equal competitive resources');
 await f.write(AGENT_ID_REGISTRY,f.m.MockIdentity.abi,'set',[a.wallet,0n]);assert.equal((await req('commands',{prompt:'Tap 5 times'},a.user)).status,403,'Agent ID checked at same block, not just session pairing');await f.write(AGENT_ID_REGISTRY,f.m.MockIdentity.abi,'set',[a.wallet,1n]);
 await db.prepare("INSERT INTO game_settings(key,value) VALUES('nft_utility_v2','active')").run();delete env.NFT_GAME_UTILITY;assert.equal((await req('commands',{prompt:'Tap 5 times'},b.user)).status,201);assert.equal((await z.act('state')).body.agent.gameAccess.canPlay,false,'Persistent setting cannot be bypassed by missing env flag');
 const saved=env.NFT_RPC_URL;env.NFT_RPC_URL='http://127.0.0.1:1';assert.equal((await req('commands',{prompt:'Tap 5 times'},a.user)).status,503);assert.equal((await a.act('state')).body.agent.gameAccess.status,'unavailable');env.NFT_RPC_URL=saved;

 }finally{await db.close();await f.provider.request({method:'evm_revert',params:[snapshot]});}
 });
 }finally{Date.now=nativeNow;await f.close();}
});
