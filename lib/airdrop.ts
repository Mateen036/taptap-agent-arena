import {createPublicClient,http,fallback,parseAbi,encodeFunctionData,isAddress,keccak256,toHex} from 'viem';
import {bsc} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';
import {requireGameAccess,gameAccessSnapshot,utilityPolicy,type UtilityEnv} from './utility';
import {pointBalance,earnedBalance,pointFields,exactPoints,legacyPoints} from './points';
// NIB airdrop conversion. TAP points are deducted when a voucher is issued, then settled or refunded from the contract's on-chain convertedPoints.
export class AirdropError extends Error{constructor(public status:number,message:string){super(message);}}
function fail(status:number,message:string):never{throw new AirdropError(status,message);}
export type AirdropEnv=UtilityEnv&{BSC_RPC_URL?:string;NIB_SIGNER_PRIVATE_KEY?:string;NIB_AIRDROP?:string;NIB_TOKEN?:string};
export const NIB_AIRDROP='0x3F5C83b4a24f0D12A278E995F21c0DEb9a8524d5' as const;
export const NIB_TOKEN='0x1F11d9feAF354aD31861B4fa26759349e2860cFb' as const;
export const VOUCHER_TTL_SECONDS=900;
const RELEASE_MARGIN_SECONDS=60;
export const AIRDROP_ACTIONS=['airdrop-state','airdrop-voucher'];
const E18=10n**18n;
export const airdropAbi=parseAbi([
 'function currentSeason() view returns (uint256)',
 'function paused() view returns (bool)',
 'function signer() view returns (address)',
 'function seasons(uint256) view returns (uint256 allocation,uint256 rolledIn,uint256 rolledOut,uint256 paid,uint256 pointsPerNib,uint8 status)',
 'function pool(uint256) view returns (uint256)',
 'function remaining(uint256) view returns (uint256)',
 'function convertedPoints(uint256,address) view returns (uint256)',
 'function claim((address wallet,uint256 season,uint256 cumulativePoints,uint256 deadline,bytes32 voucherId) v,bytes signature) returns (uint256 points,uint256 nib)'
]);
const voucherTypes={Voucher:[{name:'wallet',type:'address'},{name:'season',type:'uint256'},{name:'cumulativePoints',type:'uint256'},{name:'deadline',type:'uint256'},{name:'voucherId',type:'bytes32'}]} as const;
const addresses=(e:AirdropEnv)=>({airdrop:(e.NIB_AIRDROP&&isAddress(e.NIB_AIRDROP)?e.NIB_AIRDROP:NIB_AIRDROP) as `0x${string}`,token:(e.NIB_TOKEN&&isAddress(e.NIB_TOKEN)?e.NIB_TOKEN:NIB_TOKEN) as `0x${string}`});
const client=(e:AirdropEnv)=>createPublicClient({chain:bsc,transport:e.BSC_RPC_URL?http(e.BSC_RPC_URL,{timeout:8000,retryCount:1}):fallback([http('https://bsc-dataseed.bnbchain.org',{timeout:8000,retryCount:0}),http('https://bsc-dataseed-public.bnbchain.org',{timeout:8000,retryCount:0})])});
const q=(e:AirdropEnv,sql:string,...args:any[])=>e.DB.prepare(sql).bind(...args);
const first=(e:AirdropEnv,sql:string,...args:any[])=>q(e,sql,...args).first<any>();
const rows=async(e:AirdropEnv,sql:string,...args:any[])=>(await q(e,sql,...args).all<any>()).results;
const STATUS=['unopened','open','ended'] as const;
export type ChainSeason={season:number;allocation:bigint;rolledIn:bigint;rolledOut:bigint;paid:bigint;pointsPerNib:bigint;status:'unopened'|'open'|'ended';pool:bigint;remaining:bigint};
async function readSeason(e:AirdropEnv,n:number):Promise<ChainSeason>{
 const c=client(e),{airdrop}=addresses(e);
 let s:any,remaining:bigint=0n,pool:bigint=0n;
 try{[s,remaining,pool]=await Promise.all([c.readContract({address:airdrop,abi:airdropAbi,functionName:'seasons',args:[BigInt(n)]}),c.readContract({address:airdrop,abi:airdropAbi,functionName:'remaining',args:[BigInt(n)]}),c.readContract({address:airdrop,abi:airdropAbi,functionName:'pool',args:[BigInt(n)]})]);}
 catch{fail(503,'The NIB airdrop contract could not be read. Nothing was changed.');}
 return {season:n,allocation:s[0],rolledIn:s[1],rolledOut:s[2],paid:s[3],pointsPerNib:s[4],status:STATUS[Number(s[5])]??'unopened',pool,remaining};
}
const cache=new Map<string,{at:number;value:any}>();
export const clearAirdropCache=()=>cache.clear();
/** Public on-chain snapshot, cached for a few seconds so status polling stays cheap. */
export async function chainSnapshot(e:AirdropEnv,now:number,fresh=false){
 const key=[e.BSC_RPC_URL,addresses(e).airdrop].join(':'),hit=cache.get(key);if(!fresh&&hit&&now-hit.at<4000&&now>=hit.at)return hit.value;
 const c=client(e),{airdrop}=addresses(e);
 let current:bigint=0n,paused:boolean=false;
 try{[current,paused]=await Promise.all([c.readContract({address:airdrop,abi:airdropAbi,functionName:'currentSeason'}),c.readContract({address:airdrop,abi:airdropAbi,functionName:'paused'})]);}
 catch{fail(503,'The NIB airdrop contract could not be read. Nothing was changed.');}
 const seasons=await Promise.all([1,2,3,4,5].map(n=>readSeason(e,n)));
 const value={currentSeason:Number(current),paused,seasons,open:seasons.find((s:ChainSeason)=>s.season===Number(current)&&s.status==='open')||null};
 cache.set(key,{at:now,value});return value;
}
type Row={id:string;wallet:string;season:number;delta_points:string;cumulative_points:string;base_converted:string;deadline:number;status:string;paid_points:string|null;refund_points:string|null;signature:string;created_at:number;settled_at:number|null};
const exactOn=async(e:AirdropEnv)=>(await utilityPolicy(e)).active;
/** Atomic agent balance change. All statements are guarded by the agent's new last_event, so they apply together or not at all. */
async function applyPoints(e:AirdropEnv,a:any,exact:boolean,delta:bigint,kind:string,detail:string,extra:any[],now:number,guard?:{sql:string;args:any[]}){
 const next=pointBalance(a)+delta;if(next<0n)fail(409,'Not enough TAP points.');
 const fields=pointFields(next,earnedBalance(a),exact),entries=Object.entries(fields),event=crypto.randomUUID();
 const res=await e.DB.batch([
  q(e,`UPDATE agents SET ${entries.map(([k])=>`${k}=?`).join(',')},version=version+1,last_event=? WHERE wallet=? AND version=?${guard?' AND '+guard.sql:''}`,...entries.map(([,v])=>v),event,a.wallet,a.version,...(guard?.args||[])),
  exact?q(e,'INSERT INTO ledger(id,wallet,kind,delta,delta_exact,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',event,a.wallet,kind,legacyPoints(delta),delta.toString(),detail,now,a.wallet,event):q(e,'INSERT INTO ledger(id,wallet,kind,delta,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',event,a.wallet,kind,Number(delta),detail,now,a.wallet,event),
  ...extra.map(f=>f(event))
 ]);
 if(!res[0].meta.changes)fail(409,guard?'This conversion was already settled or your agent changed. Retry.':'Your agent changed during this request. Refresh and retry.');
}
type Resolution={status:'settled'|'released';paid:bigint;refund:bigint}|null;
/** Decide what a pending voucher became. Pure; chainTime must be read before converted so a claim mined before it is always visible. */
export function resolve(row:Pick<Row,'delta_points'|'base_converted'|'deadline'>,converted:bigint,seasonStatus:string,chainTime:number):Resolution{
 const delta=BigInt(row.delta_points),base=BigInt(row.base_converted);
 let paid=converted>base?converted-base:0n;if(paid>delta)paid=delta;
 if(paid>=delta)return {status:'settled',paid,refund:0n};
 const closed=seasonStatus==='ended'||chainTime>row.deadline+RELEASE_MARGIN_SECONDS;
 if(!closed)return null;
 return {status:paid>0n?'settled':'released',paid,refund:delta-paid};
}
async function settleRow(e:AirdropEnv,row:Row,res:NonNullable<Resolution>,now:number){
 const mark=(event?:string)=>q(e,"UPDATE airdrop_conversions SET status=?,paid_points=?,refund_points=?,settled_at=? WHERE id=? AND status='pending'"+(event?' AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)':''),...[res.status,res.paid.toString(),res.refund.toString(),now,row.id,...(event?[row.wallet,event]:[])]);
 if(res.refund===0n){await mark().run();return;}
 for(let attempt=0;attempt<3;attempt++){
  const a=await first(e,'SELECT * FROM agents WHERE wallet=?',row.wallet);
  if(!a){await mark().run();return;}
  try{
   await applyPoints(e,a,await exactOn(e),res.refund,'convert-refund',res.status==='released'?'NIB conversion expired unclaimed · points returned':'NIB conversion partly filled · unpaid points returned',[(event:string)=>mark(event)],now,{sql:"EXISTS(SELECT 1 FROM airdrop_conversions WHERE id=? AND status='pending')",args:[row.id]});
   return;
  }catch(err){if(attempt===2||!(err instanceof AirdropError)||err.status!==409)throw err;}
 }
}
/** Re-read on-chain convertedPoints and settle or refund any pending vouchers (all wallets when wallet is omitted, bounded). */
export async function reconcile(e:AirdropEnv,now:number,wallet?:string){
 const c=client(e),{airdrop}=addresses(e);
 // Read chain time first: any claim mined before it is visible to the convertedPoints reads that follow.
 let chainTime:number;try{chainTime=Number((await c.getBlock()).timestamp);}catch{return 0;}// unreadable chain: change nothing
 const pending=wallet?await rows(e,"SELECT * FROM airdrop_conversions WHERE wallet=? AND status='pending'",wallet):await rows(e,"SELECT * FROM airdrop_conversions WHERE status='pending' AND deadline<? ORDER BY created_at ASC LIMIT 20",chainTime);
 let settled=0;
 for(const row of pending as Row[]){
  try{
   const [converted,s]=await Promise.all([c.readContract({address:airdrop,abi:airdropAbi,functionName:'convertedPoints',args:[BigInt(row.season),row.wallet as `0x${string}`]}),readSeason(e,row.season)]);
   const res=resolve(row,converted,s.status,chainTime);if(!res)continue;
   await settleRow(e,row,res,now);settled++;
  }catch(err){if(err instanceof AirdropError&&err.status===503)continue;throw err;}
 }
 return settled;
}
const signerAccount=(e:AirdropEnv)=>{const k=e.NIB_SIGNER_PRIVATE_KEY;if(!k||!/^0x[0-9a-fA-F]{64}$/.test(k.trim()))fail(503,'The NIB airdrop signer is not configured. No points were deducted.');return privateKeyToAccount(k!.trim() as `0x${string}`);};
const voucherView=(e:AirdropEnv,row:Row)=>{
 const {airdrop}=addresses(e),message={wallet:row.wallet,season:String(row.season),cumulativePoints:row.cumulative_points,deadline:String(row.deadline),voucherId:row.id};
 const data=encodeFunctionData({abi:airdropAbi,functionName:'claim',args:[{wallet:row.wallet as `0x${string}`,season:BigInt(row.season),cumulativePoints:BigInt(row.cumulative_points),deadline:BigInt(row.deadline),voucherId:row.id as `0x${string}`},row.signature as `0x${string}`]});
 return {id:row.id,status:row.status,season:row.season,points:row.delta_points,voucher:message,signature:row.signature,deadline:row.deadline,expiresAt:row.deadline*1000,transaction:{chainId:56,from:row.wallet,to:airdrop,value:'0',data},
  baw:`baw contract-call preview --binanceChainId 56 --from ${row.wallet} --to ${airdrop} --value 0 --inputData ${data} --json`};
};
const toRowView=(r:Row)=>({id:r.id,season:r.season,points:r.delta_points,status:r.status,paidPoints:r.paid_points,refundPoints:r.refund_points,createdAt:r.created_at,settledAt:r.settled_at,deadline:r.deadline});
const num=(v:bigint)=>v.toString();
const seasonView=(s:ChainSeason)=>({season:s.season,status:s.status,allocation:num(s.allocation),pool:num(s.pool),paid:num(s.paid),remaining:num(s.remaining),pointsPerNib:num(s.pointsPerNib)});
/** GET status. The user section appears only for a connected agent. */
export async function airdropStatus(e:AirdropEnv,a:any|null,now:number){
 if(a?.connected)await reconcile(e,now,a.wallet).catch(()=>{});
 else await reconcile(e,now).catch(()=>{});
 const chain=await chainSnapshot(e,now),addr=addresses(e),open=chain.open;
 const out:any={chainId:56,airdrop:addr.airdrop,token:addr.token,tokenSymbol:'NIB',pointsPerNibDefault:10,paused:chain.paused,currentSeason:chain.currentSeason,open:!!open&&!chain.paused,season:open?seasonView(open):null,seasons:chain.seasons.map(seasonView),
  message:chain.paused?'Conversions are paused.':open?`Season ${open.season} is open, ${open.pointsPerNib.toString()} TAP = 1 NIB, first come first served.`:chain.currentSeason===0?'No airdrop season is open yet.':`Season ${chain.currentSeason} has ended. The next season has not opened yet.`};
 if(a?.connected){
  const access=await gameAccessSnapshot(e,a.wallet),balance=pointBalance(a),pending=await first(e,"SELECT * FROM airdrop_conversions WHERE wallet=? AND status='pending'",a.wallet),history=await rows(e,'SELECT * FROM airdrop_conversions WHERE wallet=? ORDER BY created_at DESC LIMIT 10',a.wallet);
  const rate=open?.pointsPerNib;
  out.user={wallet:a.wallet,balance:balance.toString(),canConvert:access.canPlay===true&&!!open&&!chain.paused,access:{status:access.status,canPlay:access.canPlay},convertible:open&&access.canPlay?balance.toString():'0',estimatedNib:open&&rate?(balance*E18/rate).toString():'0',minPoints:rate?rate.toString():null,pending:pending?voucherView(e,pending as Row):null,history:history.map(r=>toRowView(r as Row))};
 }
 return out;
}
/** Issue a voucher. Deducts the points and records the pending conversion in one atomic batch, then returns the signed voucher. */
export async function issueVoucher(e:AirdropEnv,a:any,payload:any,now:number){
 if(!a||!a.connected)fail(409,'Pair a verified agent first.');
 const access=await requireGameAccess(e,a);// Agent ID + NFT at issuance
 await reconcile(e,now,a.wallet);
 a=await first(e,'SELECT * FROM agents WHERE wallet=?',a.wallet);a._gameAccess=access;
 const chain=await chainSnapshot(e,now,true);// fresh read for a money-moving action
 if(chain.paused)fail(409,'NIB conversions are paused.');
 const want=payload?.season===undefined||payload?.season===null?(chain.currentSeason||1):Number(payload.season);
 if(!Number.isInteger(want)||want<1||want>5)fail(400,'Choose an airdrop season from 1 to 5.');
 const season=chain.seasons.find((s:ChainSeason)=>s.season===want)!;
 if(season.status!=='open')fail(409,season.status==='ended'?`Airdrop season ${want} has ended.`:`Airdrop season ${want} is not open yet.`);
 const remainingNib:bigint=season.remaining,perNib:bigint=season.pointsPerNib;if(remainingNib===0n||remainingNib*perNib/E18===0n)fail(409,`Airdrop season ${want} pool is empty.`);
 const pending=await first(e,"SELECT * FROM airdrop_conversions WHERE wallet=? AND season=? AND status='pending'",a.wallet,want);
 if(pending)return {reused:true,conversion:voucherView(e,pending as Row)};
 const balance=pointBalance(a),rate=season.pointsPerNib;
 let points:bigint;
 if(payload?.points===undefined||payload?.points===null||payload.points==='all')points=balance;
 else{try{points=exactPoints(typeof payload.points==='string'?payload.points:Number(payload.points));}catch{return fail(400,'Enter a whole number of TAP points.');}}
 if(points<=0n)fail(400,'Enter a positive number of TAP points.');
 if(points>balance)fail(409,'You do not have that many TAP points.');
 if(points<rate)fail(400,`Convert at least ${rate} TAP (1 NIB).`);
 const signer=signerAccount(e),c=client(e);
 let onchainSigner:string,base:bigint;
 try{[onchainSigner,base]=await Promise.all([c.readContract({address:addresses(e).airdrop,abi:airdropAbi,functionName:'signer'}),c.readContract({address:addresses(e).airdrop,abi:airdropAbi,functionName:'convertedPoints',args:[BigInt(want),a.wallet as `0x${string}`]})]);}
 catch{return fail(503,'The NIB airdrop contract could not be read. No points were deducted.');}
 if(onchainSigner.toLowerCase()!==signer.address.toLowerCase())fail(503,'The configured NIB signer does not match the contract. No points were deducted.');
 const id=keccak256(toHex(crypto.getRandomValues(new Uint8Array(32)))) as `0x${string}`,deadline=Math.floor(now/1000)+VOUCHER_TTL_SECONDS,cumulative=base+points;
 const signature=await signer.signTypedData({domain:{name:'NibAirdrop',version:'1',chainId:56,verifyingContract:addresses(e).airdrop},types:voucherTypes,primaryType:'Voucher',message:{wallet:a.wallet as `0x${string}`,season:BigInt(want),cumulativePoints:cumulative,deadline:BigInt(deadline),voucherId:id}});
 const exact=access.required===true;
 try{
  await applyPoints(e,a,exact,-points,'convert',`Converted ${points} TAP to NIB · airdrop season ${want}`,[(event:string)=>q(e,'INSERT INTO airdrop_conversions(id,wallet,season,delta_points,cumulative_points,base_converted,deadline,status,signature,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',id,a.wallet,want,points.toString(),cumulative.toString(),base.toString(),deadline,'pending',signature,now,a.wallet,event)],now);
 }catch(err){if(err instanceof AirdropError)throw err;fail(409,'Another conversion is already pending for this wallet and season.');}
 const row=await first(e,'SELECT * FROM airdrop_conversions WHERE id=?',id);if(!row)fail(409,'Your agent changed during this request. No conversion was recorded; refresh and retry.');
 return {reused:false,conversion:voucherView(e,row as Row),estimatedNib:(points*E18/rate).toString()};
}
export async function airdropRoute(request:Request,e:AirdropEnv,a:any|null,readBody:()=>Promise<any>,now:number):Promise<Response|null>{
 const path=new URL(request.url).pathname.replace(/^\/api/,'');
 const respond=(data:any,status=200)=>new Response(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(path==='/airdrop'&&request.method==='GET')return respond(await airdropStatus(e,a,now));
 if(path==='/airdrop/voucher'&&request.method==='POST'){if(!request.headers.get('oai-authenticated-user-id'))fail(401,'Sign in to manage your agent.');const b=await readBody();return respond(await issueVoucher(e,a,b,now),200);}
 return null;
}
/** Signed agent actions mirror the browser endpoints for agents using baw. */
export async function airdropAction(e:AirdropEnv,a:any,action:string,payload:any,now:number){
 if(action==='airdrop-state')return {airdrop:await airdropStatus(e,a,now)};
 if(action==='airdrop-voucher')return {airdrop:await issueVoucher(e,a,payload,now)};
 return fail(400,'Unknown airdrop action.');
}
