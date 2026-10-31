import {errorSummary,bscTransport} from './rpc';
import {createPublicClient,http,fallback,parseAbi,isAddress,verifyTypedData,keccak256,toHex,encodeAbiParameters,concat} from 'viem';
import {bsc} from 'viem/chains';
import {utilityPolicy,gameAccessSnapshot,requireGameAccess,type UtilityPolicy} from './utility';
import {exactPoints,pointBalance,earnedBalance,pointFields,publicPoints,legacyPoints,displayPoints} from './points';
import {capacity,power,speed,energyAt,upgradeCost,parseCommand,tickPlan,missions,MAX_POINTS,canonical} from './game';
import {sessionData,actionData,AGENT_ID_REGISTRY,domain} from './protocol';
import {NftError,nftRoute,nftAction,NFT_ACTIONS,nftIntents,nftArtResponse,type NftEnv} from './nft';
import {AirdropError,airdropRoute,airdropAction,AIRDROP_ACTIONS,type AirdropEnv} from './airdrop';
import {NibMarketError,nibMarketRoute,nibMarketAction,NIB_MARKET_ACTIONS,type NibMarketEnv} from './nib-market';
import {SeasonError,currentSeason,seasonRoute,seasonSnapshot,seasonAction,SEASON_ACTIONS,seasonTapStatement,seasonEnrollStatements,track,memo} from './season';
type Env=NftEnv&AirdropEnv&NibMarketEnv&{DB:D1Database;BSC_RPC_URL?:string;ADMIN_WALLET?:string;ALLOW_WALLET_RELINK?:boolean;STORAGE_NAME?:string;NFT_GAME_UTILITY?:string;_utilityPolicy?:UtilityPolicy};
class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
function fail(status:number,message:string):never{throw new HttpError(status,message)}
const uid=(r:Request)=>r.headers.get('oai-authenticated-user-id')||fail(401,'Sign in to manage your agent.');
const json=(data:any,status=200)=>new Response(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
const id=()=>crypto.randomUUID();
const hash=(v:string)=>keccak256(toHex(v));
const lower=(v:any)=>typeof v==='string'&&isAddress(v)?v.toLowerCase():fail(400,'A valid wallet address is required.');
const publicClient=(e:Env)=>createPublicClient({chain:bsc,transport:bscTransport(e.BSC_RPC_URL)});
const gateAbi=parseAbi(['function balanceOf(address) view returns (uint256)']);
export async function eligible(wallet:string,env:Env){
 try{const client=publicClient(env);const chain=await client.getChainId();if(chain!==56)fail(503,'The identity RPC is on the wrong chain.');const balance=await client.readContract({address:AGENT_ID_REGISTRY,abi:gateAbi,functionName:'balanceOf',args:[wallet as `0x${string}`]});if(balance===0n)fail(403,'This wallet does not hold a Binance .ai Agent ID. Claim one in Binance Wallet first.');return true;}
 catch(e){if(e instanceof HttpError)throw e;fail(503,'BNB Chain identity verification is temporarily unavailable. No points were awarded.');}
}
async function body(r:Request){if(!r.headers.get('content-type')?.includes('application/json'))fail(415,'Use application/json.');let size=0;const chunks:Uint8Array[]=[];const reader=r.body?.getReader()??fail(400,'JSON body is required.');if(!reader)fail(400,'JSON body is required.');while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();fail(413,'Request is too large.');}chunks.push(value);}try{const all=new Uint8Array(size);let n=0;for(const chunk of chunks){all.set(chunk,n);n+=chunk.length;}const b=JSON.parse(new TextDecoder().decode(all));if(!b||typeof b!=='object'||Array.isArray(b))throw Error();return b;}catch{fail(400,'Invalid JSON object.');}}
const stmt=(e:Env,q:string,...args:any[])=>e.DB.prepare(q).bind(...args);
const first=(e:Env,q:string,...args:any[])=>stmt(e,q,...args).first<any>();
async function own(e:Env,r:Request){const a=await first(e,'SELECT * FROM agents WHERE user_id=?',uid(r));if(!a||!a.connected)fail(409,'Pair a verified agent first.');return a;}
async function active(e:Env,wallet:string){return first(e,"SELECT * FROM commands WHERE wallet=? AND status='running' ORDER BY created_at DESC LIMIT 1",wallet);}
async function cas(e:Env,a:any,fields:Record<string,any>,kind:string,delta:number|bigint,detail:string,extra:D1PreparedStatement[]=[]){
 const event=a._event||id(),now=Date.now();const entries=Object.entries(fields);const res=await e.DB.batch([
 stmt(e,`UPDATE agents SET ${entries.map(([k])=>`${k}=?`).join(',')},version=version+1,last_event=? WHERE wallet=? AND version=?${['tap','start','upgrade','mission'].includes(kind)?" AND NOT EXISTS(SELECT 1 FROM game_settings WHERE key='season_phase_v3' AND value='frozen')":''}`,...entries.map(([,v])=>v),event,a.wallet,a.version),
 a._gameAccess?.required?stmt(e,'INSERT INTO ledger(id,wallet,kind,delta,delta_exact,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',event,a.wallet,kind,legacyPoints(exactPoints(delta)),exactPoints(delta).toString(),detail,now,a.wallet,event):stmt(e,'INSERT INTO ledger(id,wallet,kind,delta,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',event,a.wallet,kind,delta,detail,now,a.wallet,event),
 ...extra.map(s=>s)
 ]);
 if(!res[0].meta.changes)fail(409,'Your agent changed during this request. Refresh and retry.');return event;
}
// Extra statements must independently test the agent's new version; D1 batch is transactional.
const guard=(a:any)=>[a.wallet,a._event??=id()];
async function snapshot(e:Env,a:any,accessOverride?:any){
 const c=await active(e,a.wallet),access=accessOverride||await gameAccessSnapshot(e,a.wallet),exact=(await utilityPolicy(e)).active;
 const session=await first(e,'SELECT expires_at,last_seen_at FROM sessions WHERE wallet=? AND revoked=0 AND expires_at>? ORDER BY expires_at DESC LIMIT 1',a.wallet,Date.now());
 const logs=await stmt(e,'SELECT * FROM ledger WHERE wallet=? ORDER BY created_at DESC LIMIT 20',a.wallet).all<any>();
 const commandRows=await stmt(e,'SELECT * FROM commands WHERE wallet=? ORDER BY created_at DESC LIMIT 10',a.wallet).all<any>();
 const claimed=await stmt(e,'SELECT mission FROM mission_claims WHERE wallet=?',a.wallet).all<any>();
 return {wallet:a.wallet,name:a.name,points:exact?publicPoints(pointBalance(a)):a.points,earned:exact?publicPoints(earnedBalance(a)):a.earned,taps:a.taps,runs:a.runs,power:power(a),capacity:capacity(a),speed:speed(a),energy:energyAt(a,Date.now(),!!c),levels:[a.power_level,a.tank_level,a.speed_level],connected:!!a.connected,updatedAt:a.updated_at,claimed:claimed.results.map((x:any)=>x.mission),upgrades:[0,1,2].map(i=>({cost:upgradeCost(a,i),level:a[['power_level','tank_level','speed_level'][i]]})),commands:commandRows.results.map(v=>({...v,earned:exact?publicPoints(v.earned_exact??v.earned):v.earned})),logs:logs.results.map(v=>({...v,delta:exact?publicPoints(v.delta_exact??v.delta):v.delta})),sessionOnline:!!session,runnerOnline:!!session&&Date.now()-session.last_seen_at<15000,sessionExpiresAt:session?.expires_at||null,lastSeenAt:session?.last_seen_at||null,gameAccess:access,missions:missions.map((m,i)=>({...m,baseReward:m.reward,reward:exact&&access.canPlay?publicPoints(BigInt(m.reward)*BigInt(access.multiplier)):m.reward,progress:Math.min(m.goal,a[m.key]),claimed:claimed.results.some((v:any)=>v.mission===i)}))};
}
/** Shared by the browser endpoints and the signed agent actions (command-create, mission-claim). */
async function queueCommand(env:Env,a:any,prompt:any,now:number){
 await requireGameAccess(env,a);let target;try{target=parseCommand(prompt);}catch(e){fail(400,(e as Error).message);}
 const recent=await first(env,'SELECT COUNT(*) AS n FROM commands WHERE wallet=? AND created_at>?',a.wallet,now-60000);if(recent.n>=10)fail(429,'Maximum 10 commands per minute.');const pending=await first(env,"SELECT COUNT(*) AS n FROM commands WHERE wallet=? AND status IN ('queued','running','paused')",a.wallet);if(pending.n>=10)fail(409,'Finish or cancel existing commands first.');
 const commandId=id();await stmt(env,'INSERT INTO commands(id,wallet,prompt,target,created_at) VALUES(?,?,?,?,?)',commandId,a.wallet,String(prompt).trim(),target,now).run();await track(env,a.user_id,'command_queued',now).catch(()=>{});return {id:commandId,target,status:'queued'};
}
async function claimMission(env:Env,a:any,index:any,now:number){
 await requireGameAccess(env,a);if(!Number.isInteger(index)||!missions[index])fail(400,'Invalid mission.');const m=missions[index];if(a[m.key]<m.goal)fail(409,'Complete this mission first.');if(await first(env,'SELECT id FROM mission_claims WHERE wallet=? AND mission=?',a.wallet,index))fail(409,'Reward already claimed.');const exact=a._gameAccess?.required===true,reward=BigInt(m.reward)*(exact?BigInt(a._gameAccess.multiplier):1n);if(!exact&&pointBalance(a)+reward>BigInt(MAX_POINTS))fail(409,'Point limit reached.');
 await cas(env,a,pointFields(pointBalance(a)+reward,earnedBalance(a)+reward,exact),'mission',exact?reward:Number(reward),m.name,[stmt(env,'INSERT INTO mission_claims(id,wallet,mission,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',id(),a.wallet,index,now,...guard(a))]);return reward;
}
/** Lifetime upgrade purchase, shared by the browser endpoint and the signed agent action `upgrade`. */
const UPGRADE_NAMES=['Multitap','Energy tank','Agent overclock'];
async function buyUpgrade(env:Env,a:any,index:any,now:number,pauseActive:boolean){
 await requireGameAccess(env,a);if(![0,1,2].includes(index))fail(400,'Invalid upgrade.');
 const run=await active(env,a.wallet);if(run&&!pauseActive)fail(409,'Pause your agent before upgrading.');
 const key=['power_level','tank_level','speed_level'][index];if(a[key]>=20)fail(409,'Maximum upgrade level reached.');const price=upgradeCost(a,index);if(pointBalance(a)<BigInt(price))fail(409,'Not enough TAP points.');
 const energy=energyAt(a,now,!!run);
 await cas(env,a,{[key]:a[key]+1,...pointFields(pointBalance(a)-BigInt(price),earnedBalance(a),a._gameAccess?.required===true),energy:energy+(index===1?1000:0),updated_at:now},'upgrade',-price,UPGRADE_NAMES[index]+' upgraded'+(run?' (running command paused)':''),
  run?[stmt(env,"UPDATE commands SET status='paused',finished_at=? WHERE id=? AND status='running' AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)",now,run.id,...guard(a))]:[]);
 return {index,level:a[key]+1,cost:price,paused:run?String(run.id):null};
}
export const EARN_ACTIONS=['command-create','mission-claim','upgrade'];
export async function handle(request:Request,env:Env):Promise<Response>{
 try{
 const url=new URL(request.url),path=url.pathname.replace(/^\/api/,'');const now=Date.now();
 if(request.method==='GET'&&/^\/nft\/art\/(?:v2\/)?[^/]+$/.test(path))return nftArtResponse(path.split('/').pop()!);
 if(!env.DB)fail(503,'Game storage is not available.');
 // Reads reuse a recent policy; writes always re-check so freezes/policy changes are enforced immediately.
 env={...env,_utilityPolicy:request.method==='GET'?await memo(env,'utility-policy',15000,()=>utilityPolicy(env)):await utilityPolicy(env)};
 if(request.method==='POST'){const origin=request.headers.get('origin');if(origin&&origin!==url.origin)fail(403,'Cross-origin writes are not allowed.');}
 
 const frozen=request.method==='POST'?await first(env,"SELECT value FROM game_settings WHERE key='season_phase_v3'"):null;
 if(frozen?.value==='frozen'&&request.method==='POST'&&['/commands','/upgrades','/missions/claim'].includes(path))fail(409,'Season is frozen for token allocation.');
 if(path.startsWith('/admin/')&&request.method==='POST'){
  if(!env.ADMIN_WALLET||!isAddress(env.ADMIN_WALLET))fail(503,'Launch operator wallet has not been configured.');
  const b=await body(request);if(!Number.isSafeInteger(b.timestamp)||Math.abs(now-b.timestamp)>60000||typeof b.requestId!=='string'||b.requestId.length>80||!b.payload||typeof b.payload!=='object')fail(400,'Invalid operator request.');
  const typed={domain:domain(),types:{AdminAction:[{name:'origin',type:'string'},{name:'requestId',type:'string'},{name:'timestamp',type:'uint256'},{name:'action',type:'string'},{name:'payloadHash',type:'bytes32'}]},primaryType:'AdminAction',message:{origin:url.origin,requestId:b.requestId,timestamp:BigInt(b.timestamp),action:path,payloadHash:hash(canonical(b.payload))}};
  let valid=false;try{valid=await verifyTypedData({address:env.ADMIN_WALLET,...typed,signature:b.signature} as any);}catch{}if(!valid)fail(403,'Invalid operator signature.');
  try{await stmt(env,'INSERT INTO admin_requests(id,created_at) VALUES(?,?)',b.requestId,now).run();}catch{fail(409,'Operator request already used.');}
  if(path==='/admin/freeze'){
   await stmt(env,"INSERT INTO game_settings(key,value) VALUES('season_phase_v3','frozen') ON CONFLICT(key) DO UPDATE SET value='frozen'").run();
   return json({ok:true,phase:'frozen'});
  }
  if(path==='/admin/snapshot'){
   if(frozen?.value!=='frozen')fail(409,'Freeze the season before exporting allocation points.');
   const rows=await stmt(env,'SELECT * FROM agents ORDER BY wallet ASC').all<any>();return json({chainId:56,season:1,createdAt:now,agents:rows.results.map(a=>({wallet:a.wallet,points:publicPoints(pointBalance(a)),earned:publicPoints(earnedBalance(a)),taps:a.taps}))});
  }
  if(path==='/admin/publish-rewards'){
   const p=b.payload;if(!Number.isSafeInteger(p.epoch)||p.epoch<1||!/^0x[0-9a-fA-F]{64}$/.test(p.root||'')||!isAddress(p.contract)||!isAddress(p.token)||!Array.isArray(p.allocations)||p.allocations.length<1||p.allocations.length>5)fail(400,'Invalid rewards batch. Maximum five allocations per request.');
   if(frozen?.value!=='frozen')fail(409,'Freeze the season before publishing rewards.');
   const client=publicClient(env),abi=parseAbi(['function root() view returns(bytes32)','function epoch() view returns(uint256)','function token() view returns(address)','function agentIdRegistry() view returns(address)','function owner() view returns(address)']);
   const [chainId,root,epoch,token,registry,owner]=await Promise.all([client.getChainId(),client.readContract({address:p.contract,abi,functionName:'root'}),client.readContract({address:p.contract,abi,functionName:'epoch'}),client.readContract({address:p.contract,abi,functionName:'token'}),client.readContract({address:p.contract,abi,functionName:'agentIdRegistry'}),client.readContract({address:p.contract,abi,functionName:'owner'})]);
   if(chainId!==56||root.toLowerCase()!==p.root.toLowerCase()||epoch!==BigInt(p.epoch)||token.toLowerCase()!==p.token.toLowerCase()||registry.toLowerCase()!==AGENT_ID_REGISTRY.toLowerCase()||owner.toLowerCase()!==env.ADMIN_WALLET!.toLowerCase())fail(409,'Rewards batch does not match the active on-chain contract.');
   const existing=await first(env,'SELECT * FROM reward_epochs WHERE id=?',p.epoch);if(existing&&(existing.root!==p.root||existing.contract!==p.contract||existing.token!==p.token))fail(409,'Epoch metadata cannot be replaced.');
   const statements:D1PreparedStatement[]=[];
   for(const allocation of p.allocations){const wallet=lower(allocation.wallet);if(!/^\d+$/.test(allocation.amount||'')||BigInt(allocation.amount)>(1n<<256n)-1n||!Array.isArray(allocation.proof)||allocation.proof.length>64||allocation.proof.some((v:any)=>!/^0x[0-9a-fA-F]{64}$/.test(v)))fail(400,'Invalid allocation.');
    let leaf=keccak256(keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint256'},{type:'address'},{type:'uint256'}],[56n,p.contract,BigInt(p.epoch),wallet as any,BigInt(allocation.amount)])));
    for(const sibling of allocation.proof)leaf=keccak256(concat(BigInt(leaf)<BigInt(sibling)?[leaf,sibling]:[sibling,leaf]));if(leaf.toLowerCase()!==root.toLowerCase())fail(400,'Invalid Merkle allocation proof.');
    statements.push(stmt(env,'INSERT INTO reward_proofs(id,wallet,epoch,amount,proof) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING',p.epoch+':'+wallet,wallet,p.epoch,allocation.amount,JSON.stringify(allocation.proof)));
   }
   await env.DB.batch([stmt(env,'INSERT INTO reward_epochs(id,root,contract,token,chain_id,created_at) VALUES(?,?,?,?,56,?) ON CONFLICT(id) DO NOTHING',p.epoch,p.root,p.contract,p.token,now),...statements]);return json({ok:true,imported:statements.length});
  }
  fail(404,'Operator endpoint not found.');
 }
 if(path==='/health'&&request.method==='GET'){await first(env,'SELECT 1');return json({ok:true,chainId:56,storage:env.STORAGE_NAME||'D1',time:now});}
 if(path==='/bootstrap'&&request.method==='GET'){
 const user=request.headers.get('oai-authenticated-user-id');const a=user?await first(env,'SELECT * FROM agents WHERE user_id=?',user):null;
 const boosted=env._utilityPolicy?.active;
 const leaders=await memo(env,'boot-leaders:'+(boosted?'b':'n'),15000,()=>stmt(env,boosted?"SELECT wallet,name,COALESCE(earned_exact,CAST(earned AS TEXT)) AS earned,taps FROM agents WHERE connected=1 AND earned>0 ORDER BY LENGTH(COALESCE(earned_exact,CAST(earned AS TEXT))) DESC,COALESCE(earned_exact,CAST(earned AS TEXT)) DESC,created_at ASC LIMIT 50":'SELECT wallet,name,earned,taps FROM agents WHERE connected=1 AND earned>0 ORDER BY earned DESC,created_at ASC LIMIT 50').all());
 const access=await gameAccessSnapshot(env,a?.wallet||null);
 const epoch=await memo(env,'boot-epoch',30000,()=>first(env,'SELECT * FROM reward_epochs ORDER BY id DESC LIMIT 1'));
 const proof=a&&epoch?await first(env,'SELECT amount,proof,epoch FROM reward_proofs WHERE wallet=? AND epoch=?',a.wallet,epoch.id):null;
 return json({authenticated:!!user,gameAccess:access,agent:a?await snapshot(env,a,access):null,leaderboard:leaders.results,season:await currentSeason(env,now),competition:a?await seasonSnapshot(env,a,now):null,chainId:56,registry:AGENT_ID_REGISTRY,serverTime:now,rewards:epoch?{...epoch,proof:proof?{...proof,proof:JSON.parse(proof.proof)}:null}:{status:'awaiting_token_launch'}});
 }
 if(path==='/eligibility'&&request.method==='POST'){
 const b=await body(request);const wallet=lower(b.wallet);await eligible(wallet,env);return json({eligible:true,wallet,chainId:56});
 }
 if(path==='/pair/status'&&request.method==='POST'){
 const user=uid(request),b=await body(request);if(!/^[0-9a-f]{64}$/.test(b.pairingCode||''))fail(400,'Invalid pairing code.');const p=await first(env,'SELECT stage,error_code,expires_at,used FROM pairings WHERE code_hash=? AND user_id=?',hash(b.pairingCode),user);if(!p)fail(404,'Pairing not found.');return json({...p,stage:p.used?'paired':p.expires_at<=now?'expired':p.stage});
 }
 if(path==='/agent/report'&&request.method==='POST'){
 const b=await body(request);if(!/^[0-9a-f]{64}$/.test(b.pairingCode||'')||!['wallet_check','identity_check','preview','approval','failed'].includes(b.stage))fail(400,'Invalid pairing update.');const code=['351509','351802','351803','351804','identity','unconnected','unknown'].includes(String(b.code))?String(b.code):null;
 await stmt(env,'UPDATE pairings SET stage=?,error_code=?,reports=reports+1 WHERE code_hash=? AND used=0 AND expires_at>? AND reports<20',b.stage,code,hash(b.pairingCode),now).run();return json({ok:true});
 }
 if(path==='/airdrop'||path.startsWith('/airdrop/')){const user=request.headers.get('oai-authenticated-user-id');const a=user?await first(env,'SELECT * FROM agents WHERE user_id=?',user):null;const result=await airdropRoute(request,env,a,()=>body(request),now);if(result)return result;}
 if(path==='/nib-market'){const user=request.headers.get('oai-authenticated-user-id');const a=user?await first(env,'SELECT * FROM agents WHERE user_id=?',user):null;const result=await nibMarketRoute(request,env,a,now);if(result)return result;}
 if(path.startsWith('/nft')){const user=request.headers.get('oai-authenticated-user-id');const a=user?await first(env,'SELECT * FROM agents WHERE user_id=?',user):null;const result=await nftRoute(request,env,a,()=>body(request),now);if(result)return result;}
 if(path==='/season'||path.startsWith('/public/')||['/profile','/jobs','/jobs/cancel','/analytics'].includes(path)){
 const user=request.headers.get('oai-authenticated-user-id')||undefined;
 const owner=user?await first(env,'SELECT * FROM agents WHERE user_id=?',user):null;
 const result=await seasonRoute(request,env,user,owner,()=>body(request),now);if(result)return result;
 }
 if(path==='/pair'&&request.method==='POST'){
 const user=uid(request);await body(request);const count=await first(env,'SELECT COUNT(*) AS n FROM pairings WHERE user_id=? AND created_at>?',user,now-60000);if(count.n>=5)fail(429,'Wait a minute before creating another pairing.');
 const code=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 await env.DB.batch([stmt(env,'UPDATE pairings SET used=1 WHERE user_id=?',user),stmt(env,'INSERT INTO pairings(code_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',hash(code),user,now+600000,now)]);
 await track(env,user,'pair_created',now).catch(()=>{});
 return json({pairingCode:code,expiresAt:now+600000,skillUrl:url.origin+'/agent-skill.md',agentScript:url.origin+'/taptap-agent.mjs'});
 }
 if(path==='/agent/challenge'&&request.method==='POST'){
 const b=await body(request),wallet=lower(b.wallet),key=lower(b.sessionKey);if(!/^[0-9a-f]{64}$/.test(b.pairingCode||''))fail(400,'Invalid pairing code.');const pairing=await first(env,'SELECT * FROM pairings WHERE code_hash=? AND used=0 AND expires_at>?',hash(b.pairingCode),now);if(!pairing)fail(403,'Pairing code is invalid or expired.');
 const cnt=await first(env,'SELECT COUNT(*) AS n FROM challenges WHERE pairing_hash=?',pairing.code_hash);if(cnt.n>=10)fail(429,'Too many challenges. Create a fresh pairing code.');
 const existing=await first(env,'SELECT user_id FROM agents WHERE wallet=?',wallet);if(existing&&existing.user_id!==pairing.user_id&&!env.ALLOW_WALLET_RELINK)fail(409,'This wallet is already paired to another account.');const current=await first(env,'SELECT wallet FROM agents WHERE user_id=?',pairing.user_id);if(current&&current.wallet!==wallet)fail(409,'This account is bound to a different wallet. Wallet replacement requires an account migration.');
 const c={id:id(),pairing_hash:pairing.code_hash,wallet,session_key:key,expires_at:now+3600000};
 await stmt(env,'INSERT INTO challenges(id,pairing_hash,wallet,session_key,expires_at) VALUES(?,?,?,?,?)',c.id,c.pairing_hash,wallet,key,c.expires_at).run();
 return json({challengeId:c.id,typedData:sessionData(url.origin,c),expiresAt:c.expires_at});
 }
 if(path==='/agent/session'&&request.method==='POST'){
 const b=await body(request);const c=await first(env,'SELECT * FROM challenges WHERE id=? AND used=0 AND expires_at>?',String(b.challengeId),now);if(!c)fail(403,'Challenge is invalid or expired.');const pairing=await first(env,'SELECT * FROM pairings WHERE code_hash=? AND used=0 AND expires_at>?',c.pairing_hash,now);if(!pairing)fail(403,'Pairing code was used or expired.');
 if(!/^0x[0-9a-fA-F]{130}$/.test(b.signature||''))fail(400,'A 65-byte EIP-712 signature is required.');
 let valid=false;try{valid=await verifyTypedData({address:c.wallet,...sessionData(url.origin,c),signature:b.signature} as any);if(!valid){const client=publicClient(env);const code=await client.getCode({address:c.wallet});if(code&&code!=='0x')valid=await client.verifyTypedData({address:c.wallet,...sessionData(url.origin,c),signature:b.signature} as any);}}catch{fail(503,'Wallet signature verification is temporarily unavailable.');}if(!valid)fail(403,'The signature does not match the agent wallet.');await eligible(c.wallet,env);
 await currentSeason(env,now);const sid=id();const sessionInsert=stmt(env,`INSERT INTO sessions(id,wallet,session_key,expires_at,verified_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pairings WHERE code_hash=? AND used=0 AND expires_at>?) AND EXISTS(SELECT 1 FROM challenges WHERE id=? AND used=0)`,sid,c.wallet,c.session_key,c.expires_at,now,c.pairing_hash,now,c.id);
 try{const results=await env.DB.batch([
 sessionInsert,
 stmt(env,'UPDATE sessions SET revoked=1 WHERE wallet=? AND id<>? AND EXISTS(SELECT 1 FROM sessions WHERE id=?)',c.wallet,sid,sid),
 stmt(env,`INSERT INTO agents(wallet,user_id,name,updated_at,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE id=?) ON CONFLICT(wallet) DO UPDATE SET connected=1${env.ALLOW_WALLET_RELINK?',user_id=excluded.user_id':' WHERE agents.user_id=excluded.user_id'}`,c.wallet,pairing.user_id,'Agent '+c.wallet.slice(2,8),now,now,sid),
 stmt(env,'UPDATE pairings SET used=1 WHERE code_hash=? AND EXISTS(SELECT 1 FROM sessions WHERE id=?)',c.pairing_hash,sid),
 stmt(env,'UPDATE challenges SET used=1 WHERE id=? AND EXISTS(SELECT 1 FROM sessions WHERE id=?)',c.id,sid)
 ]);if(!results[0].meta.changes)fail(409,'Pairing was already completed.');}catch(e){if(e instanceof HttpError)throw e;fail(409,'Account pairing conflict. Create a fresh pairing code.');}
 await track(env,pairing.user_id,'paired',now).catch(()=>{});
 return json({sessionId:sid,nonce:0,expiresAt:c.expires_at,wallet:c.wallet});
 }
 if(path==='/agent/action'&&request.method==='POST'){
 const b=await body(request);if(!['state','start','tap','stop',...EARN_ACTIONS,...SEASON_ACTIONS,...NFT_ACTIONS,...AIRDROP_ACTIONS,...NIB_MARKET_ACTIONS].includes(b.action)||!Number.isSafeInteger(b.nonce)||b.nonce<0||!Number.isSafeInteger(b.timestamp)||Math.abs(now-b.timestamp)>60000||typeof b.payload!=='object'||b.payload===null||Array.isArray(b.payload))fail(400,'Invalid action envelope or expired timestamp.');
 const s=await first(env,'SELECT * FROM sessions WHERE id=? AND revoked=0 AND expires_at>?',String(b.sessionId),now);if(!s)fail(401,'Agent session expired or revoked. Pair your agent again.');
 let valid=false;try{valid=await verifyTypedData({address:s.session_key,...actionData(url.origin,b),signature:b.signature} as any);}catch{}if(!valid)fail(403,'Invalid agent command signature.');if(s.nonce!==b.nonce)return json({error:'Nonce mismatch. Resynchronize before sending another command.',nonce:s.nonce},409);
 if(now-s.verified_at>300000){await eligible(s.wallet,env);await stmt(env,'UPDATE sessions SET verified_at=? WHERE id=?',now,s.id).run();}
 const consumed=await stmt(env,'UPDATE sessions SET nonce=nonce+1,last_seen_at=? WHERE id=? AND nonce=? AND revoked=0 AND expires_at>?',now,s.id,b.nonce,now).run();if(!consumed.meta.changes)fail(409,'Replay rejected.');
 const nextNonce=b.nonce+1;
 try{let a=await first(env,'SELECT * FROM agents WHERE wallet=? AND connected=1',s.wallet);if(!a)fail(403,'Agent disconnected.');
 if(b.action==='state'){const epoch=await first(env,'SELECT * FROM reward_epochs ORDER BY id DESC LIMIT 1');const proof=epoch?await first(env,'SELECT amount,proof FROM reward_proofs WHERE wallet=? AND epoch=?',a.wallet,epoch.id):null;return json({nonce:nextNonce,agent:await snapshot(env,a),competition:await seasonSnapshot(env,a,now),nft:{intents:await nftIntents(env,a.wallet,now)},serverTime:now,rewards:epoch?{...epoch,proof:proof?{...proof,proof:JSON.parse(proof.proof)}:null}:null});}
 if(NFT_ACTIONS.includes(b.action)){const result=await nftAction(env,a,b.action,b.payload,now);return json({nonce:nextNonce,...result,serverTime:now});}
 if(NIB_MARKET_ACTIONS.includes(b.action)){const result=await nibMarketAction(env,a,b.action,b.payload,now);return json({nonce:nextNonce,...result,serverTime:now});}
 if(AIRDROP_ACTIONS.includes(b.action)){const result=await airdropAction(env,a,b.action,b.payload,now);return json({nonce:nextNonce,...result,serverTime:now});}
 if(SEASON_ACTIONS.includes(b.action)){const result=await seasonAction(env,a,b.action,b.payload,now);return json({nonce:nextNonce,...result,serverTime:now});}
 if(b.action==='command-create'){
 if(frozen?.value==='frozen')fail(409,'Season is frozen for token allocation.');const raw=b.payload.target??b.payload.taps;const target=raw===undefined?10000:Number(raw);if(!Number.isSafeInteger(target)||target<1||target>10000)fail(400,'Choose between 1 and 10,000 taps per command.');
 const command=await queueCommand(env,a,'Tap '+target+' times (agent)',now);return json({nonce:nextNonce,command,agent:await snapshot(env,await first(env,'SELECT * FROM agents WHERE wallet=?',s.wallet)),serverTime:now});}
 if(b.action==='mission-claim'){
 if(frozen?.value==='frozen')fail(409,'Season is frozen for token allocation.');const reward=await claimMission(env,a,b.payload.index,now);return json({nonce:nextNonce,claimed:Number(b.payload.index),reward:reward.toString(),agent:await snapshot(env,await first(env,'SELECT * FROM agents WHERE wallet=?',s.wallet)),serverTime:now});}
 if(b.action==='upgrade'){
 if(frozen?.value==='frozen')fail(409,'Season is frozen for token allocation.');const bought=await buyUpgrade(env,a,b.payload.index,now,true);return json({nonce:nextNonce,upgraded:bought,agent:await snapshot(env,await first(env,'SELECT * FROM agents WHERE wallet=?',s.wallet)),serverTime:now});}
 if(['start','tap'].includes(b.action))await requireGameAccess(env,a);
 const command=await first(env,'SELECT * FROM commands WHERE id=? AND wallet=?',String(b.payload.commandId),s.wallet);if(!command)fail(404,'Command not found.');
 if(frozen?.value==='frozen'&&['start','tap'].includes(b.action))fail(409,'Season is frozen for token allocation.');
 if(b.action==='start'){
 if(!['queued','paused'].includes(command.status))fail(409,'This command cannot be started.');const other=await active(env,a.wallet);if(other)fail(409,'Stop the running command first.');const energy=energyAt(a,now);if(energy<1)fail(409,'Energy is empty. Wait for recharge.');
 await cas(env,a,{energy,updated_at:now},'start',0,'Agent accepted command',[
 stmt(env,"UPDATE commands SET status='running',started_at=COALESCE(started_at,?),last_tick=? WHERE id=? AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)",now,now,command.id,...guard(a))]);
 }else if(b.action==='tap'){
 const exact=a._gameAccess?.required===true,multiplier=exact?BigInt(a._gameAccess.multiplier):undefined;
 const plan=tickPlan(a,command,b.payload.taps,now,multiplier),gain=exactPoints(plan.gain),complete=plan.complete||plan.energy===0,commandEarned=exactPoints(command.earned_exact??command.earned)+gain;
 await cas(env,a,{...pointFields(pointBalance(a)+gain,earnedBalance(a)+gain,exact),taps:a.taps+plan.taps,energy:plan.energy,updated_at:now,runs:a.runs+(plan.complete?1:0)},'tap',exact?gain:Number(gain),`${plan.taps} verified agent taps${exact?' · '+a._gameAccess.owned+' NFTs · '+displayPoints(a._gameAccess.multiplier)+'x · block '+a._gameAccess.block:''}`,[
 exact?stmt(env,'UPDATE commands SET done=done+?,earned=?,earned_exact=?,last_tick=?,status=?,finished_at=? WHERE id=? AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',plan.taps,legacyPoints(commandEarned),commandEarned.toString(),plan.lastTick,plan.complete?'completed':complete?'paused':'running',complete?now:null,command.id,...guard(a)):stmt(env,'UPDATE commands SET done=done+?,earned=earned+?,last_tick=?,status=?,finished_at=? WHERE id=? AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',plan.taps,Number(gain),plan.lastTick,plan.complete?'completed':complete?'paused':'running',complete?now:null,command.id,...guard(a)),
 ...seasonEnrollStatements(env,a,now,a._event),seasonTapStatement(env,a,plan.baseGain,plan.taps,now,a._event)]);
 if(plan.complete)await track(env,a.user_id,'run_completed',now).catch(()=>{});
 }else if(b.action==='stop'){
 if(command.status!=='running')fail(409,'Command is not running.');await cas(env,a,{updated_at:now},'pause',0,'Agent paused command',[
 stmt(env,"UPDATE commands SET status='paused',finished_at=? WHERE id=? AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)",now,command.id,...guard(a))]);}
 a=await first(env,'SELECT * FROM agents WHERE wallet=?',s.wallet);return json({nonce:nextNonce,agent:await snapshot(env,a),serverTime:now});
 }catch(e){const status=e instanceof HttpError||e instanceof SeasonError||e instanceof NftError||e instanceof AirdropError||e instanceof NibMarketError?e.status:409;return json({error:e instanceof Error?e.message:'Action failed',nonce:nextNonce},status);}
 }
 if(path==='/commands'&&request.method==='POST'){
 const a=await own(env,request),b=await body(request);return json(await queueCommand(env,a,b.prompt,now),201);
 }
 if(path==='/commands/cancel'&&request.method==='POST'){
 const a=await own(env,request),b=await body(request),c=await first(env,'SELECT * FROM commands WHERE id=? AND wallet=?',String(b.id),a.wallet);if(!c)fail(404,'Command not found.');if(!['queued','running','paused'].includes(c.status))fail(409,'Command is already finished.');
 await cas(env,a,{updated_at:now,energy:energyAt(a,now,!!await active(env,a.wallet))},'cancel',0,'Command cancelled by owner',[
 stmt(env,"UPDATE commands SET status='cancelled',finished_at=? WHERE id=? AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)",now,c.id,...guard(a))]);return json({ok:true});
 }
 if(path==='/upgrades'&&request.method==='POST'){
 const a=await own(env,request),b=await body(request);await buyUpgrade(env,a,b.index,now,false);return json({ok:true});
 }
 if(path==='/missions/claim'&&request.method==='POST'){
 const a=await own(env,request),b=await body(request);await claimMission(env,a,b.index,now);return json({ok:true});
 }
 if(path==='/disconnect'&&request.method==='POST'){
 const a=await own(env,request);await body(request);await cas(env,a,{connected:0,updated_at:now},'disconnect',0,'Agent sessions revoked',[
 stmt(env,'UPDATE sessions SET revoked=1 WHERE wallet=? AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',a.wallet,...guard(a)),
 stmt(env,"UPDATE nft_intents SET status='cancelled',finished_at=? WHERE wallet=? AND status IN ('queued','preparing','agent_preparing','awaiting_approval','approved') AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)",now,a.wallet,...guard(a)),
 stmt(env,"UPDATE agent_jobs SET status='cancelled',finished_at=? WHERE wallet=? AND status IN ('queued','running') AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)",now,a.wallet,...guard(a)),
 stmt(env,"UPDATE arena_matches SET status='cancelled',version=version+1 WHERE creator=? AND status='open' AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)",a.wallet,...guard(a)),
 stmt(env,"UPDATE commands SET status='cancelled',finished_at=? WHERE wallet=? AND status IN ('queued','running','paused') AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)",now,a.wallet,...guard(a))]);return json({ok:true});
 }
 fail(404,'Endpoint not found.');
 }catch(e){if(e instanceof HttpError||e instanceof SeasonError||e instanceof NftError||e instanceof AirdropError||e instanceof NibMarketError)return json({error:e.message},e.status);console.error('TapTap API error',errorSummary(e));return json({error:'The request could not be completed. Please retry.'},500);}
}
