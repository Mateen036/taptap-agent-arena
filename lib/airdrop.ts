import {createPublicClient,http,fallback,parseAbi,encodeFunctionData,isAddress,keccak256,toHex} from 'viem';
import {bsc} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';
import {requireGameAccess,gameAccessSnapshot,utilityPolicy,type UtilityEnv} from './utility';
import {resolveNftEnv} from './nft-protocol';
import {pointBalance,earnedBalance,pointFields,exactPoints,legacyPoints} from './points';
// NIB airdrop conversion. TAP points are deducted when a voucher is issued, then settled or refunded from the contract's on-chain convertedPoints.
export class AirdropError extends Error{constructor(public status:number,message:string){super(message);}}
function fail(status:number,message:string):never{throw new AirdropError(status,message);}
export type AirdropEnv=UtilityEnv&{NFT_RPC_URL?:string;BSC_RPC_URL?:string;NIB_SIGNER_PRIVATE_KEY?:string;NIB_AIRDROP?:string;NIB_TOKEN?:string};
export const NIB_AIRDROP='0x3F5C83b4a24f0D12A278E995F21c0DEb9a8524d5' as const;
export const NIB_TOKEN='0x1F11d9feAF354aD31861B4fa26759349e2860cFb' as const;
export const VOUCHER_TTL_SECONDS=900;
const RELEASE_MARGIN_SECONDS=60;
export const AIRDROP_ACTIONS=['airdrop-state','airdrop-voucher','airdrop-nft-bonus'];
/** One-time NFT holder bonus: per token id forever, convertible TAP only (never earned), funded from the season 1 pool. */
export const NIB_COLLECTION='0x7374f0379F5b2689B906D47Da708B394F1910B23' as const;
export const NFT_BONUS_POINTS=100_000n;// 10,000 NIB per NFT at 10 TAP = 1 NIB
export const NFT_BONUS_CAP_POINTS=2_000_000_000n;// 200M NIB across all claims
const NFT_ENUM_LIMIT=200;
const nftEnumAbi=parseAbi(['function balanceOf(address) view returns (uint256)','function tokenOfOwnerByIndex(address,uint256) view returns (uint256)','function ownerOf(uint256) view returns (address)']);
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
const client=(e:AirdropEnv,url:string|undefined=e.BSC_RPC_URL)=>createPublicClient({chain:bsc,transport:url?http(url,{timeout:8000,retryCount:1}):fallback([http('https://bsc-dataseed.bnbchain.org',{timeout:8000,retryCount:0}),http('https://bsc-dataseed-public.bnbchain.org',{timeout:8000,retryCount:0})])});
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
type Row={id:string;wallet:string;season:number;delta_points:string;bonus_points?:string;cumulative_points:string;base_converted:string;deadline:number;status:string;paid_points:string|null;refund_points:string|null;signature:string;created_at:number;settled_at:number|null};
const exactOn=async(e:AirdropEnv)=>(await utilityPolicy(e)).active;
/** Atomic agent balance change. All statements are guarded by the agent's new last_event, so they apply together or not at all. */
const bonusBalance=(a:any)=>{try{return BigInt(a?.bonus_points??'0');}catch{return 0n;}};
/** Bonus points live in their own column: never spendable in-game, never earned. bonusDelta moves only that bucket. */
async function applyPoints(e:AirdropEnv,a:any,exact:boolean,delta:bigint,kind:string,detail:string,extra:any[],now:number,guard?:{sql:string;args:any[]},bonusDelta:bigint=0n){
 const next=pointBalance(a)+delta,nextBonus=bonusBalance(a)+bonusDelta;if(next<0n||nextBonus<0n)fail(409,'Not enough TAP points.');
 const fields:Record<string,any>={...pointFields(next,earnedBalance(a),exact),bonus_points:nextBonus.toString()},entries=Object.entries(fields),event=crypto.randomUUID();
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
/** Bonus part of a refund. Proportional to how much of the voucher came from the bonus bucket; a full release returns it exactly. */
export function refundBonus(row:Pick<Row,'delta_points'|'bonus_points'>,refund:bigint){const delta=BigInt(row.delta_points),bonus=BigInt(row.bonus_points??'0');return delta===0n||bonus===0n?0n:refund>=delta?bonus:refund*bonus/delta;}
async function settleRow(e:AirdropEnv,row:Row,res:NonNullable<Resolution>,now:number){
 const mark=(event?:string)=>q(e,"UPDATE airdrop_conversions SET status=?,paid_points=?,refund_points=?,settled_at=? WHERE id=? AND status='pending'"+(event?' AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)':''),...[res.status,res.paid.toString(),res.refund.toString(),now,row.id,...(event?[row.wallet,event]:[])]);
 if(res.refund===0n){await mark().run();return;}
 for(let attempt=0;attempt<3;attempt++){
  const a=await first(e,'SELECT * FROM agents WHERE wallet=?',row.wallet);
  if(!a){await mark().run();return;}
  try{
   // Return points to the bucket they came from: bonus share pro rata (exact on a full release), the rest to ordinary points.
   const bonusRefund=refundBonus(row,res.refund);
   await applyPoints(e,a,await exactOn(e),res.refund-bonusRefund,'convert-refund',(res.status==='released'?'NIB conversion expired unclaimed · points returned':'NIB conversion partly filled · unpaid points returned')+(bonusRefund>0n?` (${bonusRefund} NFT bonus)`:''),[(event:string)=>mark(event)],now,{sql:"EXISTS(SELECT 1 FROM airdrop_conversions WHERE id=? AND status='pending')",args:[row.id]},bonusRefund);
   return;
  }catch(err){if(attempt===2||!(err instanceof AirdropError)||err.status!==409)throw err;}
 }
}
/** Re-read on-chain convertedPoints and settle or refund any pending vouchers (all wallets when wallet is omitted, bounded). */
export async function reconcile(e:AirdropEnv,now:number,wallet?:string,season?:number){
 const c=client(e),{airdrop}=addresses(e);
 // Read chain time first: any claim mined before it is visible to the convertedPoints reads that follow.
 let chainTime:number;try{chainTime=Number((await c.getBlock()).timestamp);}catch{return 0;}// unreadable chain: change nothing
 const pending=wallet?await rows(e,"SELECT * FROM airdrop_conversions WHERE wallet=? AND status='pending'",wallet):season?await rows(e,"SELECT * FROM airdrop_conversions WHERE status='pending' AND season=? ORDER BY created_at ASC LIMIT 50",season):await rows(e,"SELECT * FROM airdrop_conversions WHERE status='pending' AND deadline<? ORDER BY created_at ASC LIMIT 20",chainTime);
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
 return {id:row.id,status:row.status,season:row.season,points:row.delta_points,bonusPoints:row.bonus_points??'0',normalPoints:(BigInt(row.delta_points)-BigInt(row.bonus_points??'0')).toString(),voucher:message,signature:row.signature,deadline:row.deadline,expiresAt:row.deadline*1000,transaction:{chainId:56,from:row.wallet,to:airdrop,value:'0',data},
  baw:`baw contract-call preview --binanceChainId 56 --from ${row.wallet} --to ${airdrop} --value 0 --inputData ${data} --json`};
};
const toRowView=(r:Row)=>({id:r.id,season:r.season,points:r.delta_points,bonusPoints:r.bonus_points??'0',status:r.status,paidPoints:r.paid_points,refundPoints:r.refund_points,createdAt:r.created_at,settledAt:r.settled_at,deadline:r.deadline});
const num=(v:bigint)=>v.toString();
const seasonView=(s:ChainSeason)=>({season:s.season,status:s.status,allocation:num(s.allocation),pool:num(s.pool),paid:num(s.paid),remaining:num(s.remaining),pointsPerNib:num(s.pointsPerNib)});
/** GET status. The user section appears only for a connected agent. */
export async function airdropStatus(e:AirdropEnv,a:any|null,now:number){
 if(a?.connected)await reconcile(e,now,a.wallet).catch(()=>{});
 else await reconcile(e,now).catch(()=>{});
 const chain=await chainSnapshot(e,now),addr=addresses(e),open=chain.open;
 const out:any={chainId:56,airdrop:addr.airdrop,token:addr.token,tokenSymbol:'NIB',pointsPerNibDefault:10,paused:chain.paused,currentSeason:chain.currentSeason,open:!!open&&!chain.paused,season:open?seasonView(open):null,seasons:chain.seasons.map(seasonView),
  message:chain.paused?'Conversions are paused.':open?`Season ${open.season} is open, ${open.pointsPerNib.toString()} TAP = 1 NIB, first come first served.`:chain.currentSeason===0?'No airdrop season is open yet.':`Season ${chain.currentSeason} has ended. The next season has not opened yet.`};
 try{
  const s1=chain.seasons.find((s:ChainSeason)=>s.season===1),l=await bonusLiability(e),v=reserveView(s1,l),r=s1?.pointsPerNib||10n;
  out.reservedForBonus={appliesToSeason:1,active:v.active,enforced:v.enforced,points:v.reserved.toString(),nib:(v.reserved*E18/r).toString(),bonusBalancesPoints:l.balances.toString(),pendingBonusPoints:l.pendingBonus.toString(),pendingNormalPoints:l.pendingNormal.toString(),normalCapacityPoints:v.capacity.toString(),normalCapacityNib:(v.capacity*E18/r).toString(),message:v.active?'While season 1 is open, normal conversions cannot push the remaining pool below the NFT bonus that holders have been credited but not yet converted. Bonus conversions can use the reserve.':'No reserve applies: season 1 is not open.'};
 }catch{out.reservedForBonus=null;}
 if(a?.connected){
  const access=await gameAccessSnapshot(e,a.wallet),balance=pointBalance(a),pending=await first(e,"SELECT * FROM airdrop_conversions WHERE wallet=? AND status='pending'",a.wallet),history=await rows(e,'SELECT * FROM airdrop_conversions WHERE wallet=? ORDER BY created_at DESC LIMIT 10',a.wallet);
  const rate=open?.pointsPerNib,bonus=bonusBalance(a),inS1=open?.season===1,canUse=!!open&&access.canPlay===true&&!chain.paused;
  const bonusConvertible=canUse&&inS1?bonus:0n,normalConvertible=canUse?(inS1&&out.reservedForBonus?.enforced&&BigInt(out.reservedForBonus.normalCapacityPoints)<balance?BigInt(out.reservedForBonus.normalCapacityPoints):balance):0n,convertible=normalConvertible+bonusConvertible;
  out.user={wallet:a.wallet,balance:balance.toString(),bonusBalance:bonus.toString(),bonusConvertible:bonusConvertible.toString(),bonusForfeited:bonus>0n&&!inS1&&(chain.currentSeason>1||chain.seasons[0]?.status==='ended'),bonusNote:'NFT bonus TAP is a separate balance. It converts to NIB in airdrop season 1 only and is ignored (forfeited) for seasons 2 and later.',canConvert:canUse,access:{status:access.status,canPlay:access.canPlay},normalConvertible:normalConvertible.toString(),convertible:convertible.toString(),estimatedNib:rate?(convertible*E18/rate).toString():'0',minPoints:rate?rate.toString():null,pending:pending?voucherView(e,pending as Row):null,history:history.map(r=>toRowView(r as Row))};
 }
 try{out.nftBonus=await nftBonusStatus(e,a,chain);}catch(err){out.nftBonus={available:false,error:err instanceof AirdropError?err.message:'The NFT bonus could not be read right now.'};}
 return out;
}

/** With NFT_COLLECTION_V2 set the bonus reads ONLY V2 holdings. Claims are keyed by token id, so ids already claimed through the original collection stay claimed. */
const collectionAddress=(e0:AirdropEnv)=>{const e=resolveNftEnv(e0);return (e.NFT_COLLECTION&&isAddress(e.NFT_COLLECTION)?e.NFT_COLLECTION:NIB_COLLECTION) as `0x${string}`;};
const bigSum=(v:any)=>BigInt(String(v??0).split('.')[0]||'0');
const claimedTotal=async(e:AirdropEnv)=>bigSum((await first(e,'SELECT COALESCE(SUM(amount),0) AS total FROM nft_bonus_claims'))?.total);
/** Token ids this wallet holds right now: enumerate, then confirm each with ownerOf so a mid-read transfer can't slip through. */
async function ownedTokens(e:AirdropEnv,wallet:string):Promise<{tokens:number[];truncated:boolean}>{
 const c=client(e,e.NFT_RPC_URL||e.BSC_RPC_URL),address=collectionAddress(e);
 try{
  const balance=Number(await c.readContract({address,abi:nftEnumAbi,functionName:'balanceOf',args:[wallet as `0x${string}`]}));
  const count=Math.min(balance,NFT_ENUM_LIMIT),ids=await Promise.all(Array.from({length:count},(_,i)=>c.readContract({address,abi:nftEnumAbi,functionName:'tokenOfOwnerByIndex',args:[wallet as `0x${string}`,BigInt(i)]})));
  const owners=await Promise.all(ids.map(id=>c.readContract({address,abi:nftEnumAbi,functionName:'ownerOf',args:[id]})));
  const tokens=[...new Set(ids.filter((_,i)=>String(owners[i]).toLowerCase()===wallet.toLowerCase()).map(Number))].sort((x,y)=>x-y);
  return {tokens,truncated:balance>NFT_ENUM_LIMIT};
 }catch{return fail(503,'The Nib NFT collection could not be read. Nothing was changed.');}
}
const bonusClaimsFor=async(e:AirdropEnv,tokens:number[])=>tokens.length?new Set((await rows(e,`SELECT token_id FROM nft_bonus_claims WHERE token_id IN (${tokens.map(()=>'?').join(',')})`,...tokens)).map((r:any)=>Number(r.token_id))):new Set<number>();
/** Bonus pool numbers, plus per-NFT claimed state for a connected wallet. */
export async function nftBonusStatus(e:AirdropEnv,a:any|null,chain:Awaited<ReturnType<typeof chainSnapshot>>){
 const credited=await claimedTotal(e),remaining=NFT_BONUS_CAP_POINTS>credited?NFT_BONUS_CAP_POINTS-credited:0n,rate=chain.seasons[0]?.pointsPerNib||10n;
 const open=chain.currentSeason===1&&chain.seasons[0]?.status==='open'&&!chain.paused;
 const out:any={available:open&&remaining>=NFT_BONUS_POINTS,seasonOpen:open,collection:collectionAddress(e),pointsPerNft:NFT_BONUS_POINTS.toString(),nibPerNft:(NFT_BONUS_POINTS*E18/rate).toString(),capPoints:NFT_BONUS_CAP_POINTS.toString(),capNib:(NFT_BONUS_CAP_POINTS*E18/rate).toString(),creditedPoints:credited.toString(),remainingPoints:remaining.toString(),remainingNib:(remaining*E18/rate).toString(),
  message:open?'NFT holders get a one-time bonus per NFT (token id), once ever. It goes to a separate bonus balance that converts to NIB in airdrop season 1 only and is forfeited afterwards. It is not spendable in-game and does not count toward rankings.':'The NFT bonus can only be claimed while airdrop season 1 is open.',bucket:'bonus_points',convertsInSeasons:[1],forfeitedAfterSeason:1};
 if(a?.connected){
  const {tokens,truncated}=await ownedTokens(e,a.wallet),claimed=await bonusClaimsFor(e,tokens),unclaimed=tokens.filter(t=>!claimed.has(t));
  const mine=await first(e,'SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM nft_bonus_claims WHERE wallet=?',a.wallet);
  const claimable=open?Math.min(unclaimed.length,Number(remaining/NFT_BONUS_POINTS)):0;
  out.user={bonusBalance:bonusBalance(a).toString(),owned:tokens.map(t=>({tokenId:t,claimed:claimed.has(t)})),unclaimedCount:unclaimed.length,claimableNow:claimable,claimablePoints:(NFT_BONUS_POINTS*BigInt(claimable)).toString(),truncated,claimedByWalletPoints:bigSum(mine?.total).toString(),claimedByWalletCount:Number(mine?.n||0)};
 }
 return out;
}
/** Claim the bonus for every unclaimed NFT the wallet holds right now. Atomic: points, ledger and per-token rows commit together or not at all. */
export async function claimNftBonus(e:AirdropEnv,a:any,now:number){
 if(!a||!a.connected)fail(409,'Pair a verified agent first.');
 const access=await requireGameAccess(e,a);
 const chain=await chainSnapshot(e,now,true);
 if(chain.paused)fail(409,'NIB conversions are paused.');
 if(!(chain.currentSeason===1&&chain.seasons[0]?.status==='open'))fail(409,'The NFT bonus can only be claimed while airdrop season 1 is open.');
 const {tokens,truncated}=await ownedTokens(e,a.wallet);
 if(!tokens.length)fail(403,'This wallet does not currently hold a Nib NFT.');
 const exact=access.required===true;
 for(let attempt=0;attempt<3;attempt++){
  const claimed=await bonusClaimsFor(e,tokens),fresh=tokens.filter(t=>!claimed.has(t));
  if(!fresh.length)fail(409,'Every NFT in this wallet has already claimed its one-time bonus.');
  const credited=await claimedTotal(e),room=NFT_BONUS_CAP_POINTS>credited?(NFT_BONUS_CAP_POINTS-credited)/NFT_BONUS_POINTS:0n;
  if(room<=0n)fail(409,'The NFT bonus pool is exhausted.');
  const take=fresh.slice(0,Number(room<BigInt(fresh.length)?room:BigInt(fresh.length))),total=NFT_BONUS_POINTS*BigInt(take.length);
  const current=await first(e,'SELECT * FROM agents WHERE wallet=?',a.wallet);if(!current)fail(409,'Pair a verified agent first.');
  try{
   await applyPoints(e,current,exact,0n,'nft-bonus',`NFT bonus +${total} bonus TAP (season 1 conversion only) · token${take.length>1?'s':''} #${take.join(', #')}`,take.map(t=>(event:string)=>q(e,'INSERT INTO nft_bonus_claims(token_id,wallet,agent,amount,claimed_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',t,a.wallet,current.name,Number(NFT_BONUS_POINTS),now,a.wallet,event)),now,
    {sql:`(SELECT COALESCE(SUM(amount),0) FROM nft_bonus_claims)+? <= ? AND NOT EXISTS(SELECT 1 FROM nft_bonus_claims WHERE token_id IN (${take.map(()=>'?').join(',')}))`,args:[Number(total),Number(NFT_BONUS_CAP_POINTS),...take]},total);
  }catch(err){
   // A concurrent claim of the same token or the last of the pool: the whole batch rolled back or never applied. Re-read and retry, then give up cleanly.
   if(attempt<2)continue;
   if(err instanceof AirdropError&&err.status!==409)throw err;
   fail(409,'These NFT bonuses were just claimed or the bonus pool filled up. Refresh and check your status.');
  }
  const after=await first(e,'SELECT * FROM agents WHERE wallet=?',a.wallet),rate=chain.seasons[0].pointsPerNib;
  return {claimed:take.map(t=>({tokenId:t,points:NFT_BONUS_POINTS.toString()})),pointsCredited:total.toString(),estimatedNib:(total*E18/rate).toString(),balance:pointBalance(after).toString(),bonusBalance:bonusBalance(after).toString(),truncated,message:`Credited ${total} bonus TAP for ${take.length} NFT${take.length>1?'s':''} to your separate bonus balance. It converts to NIB in airdrop season 1 only (alongside your normal TAP) and is forfeited if season 1 ends first. It is not spendable in-game and does not count toward rankings.`};
 }
 return fail(409,'Could not record the NFT bonus. Retry.');
}
/** Season 1 NFT-bonus liability, in points: bonus balances not yet converted plus the bonus share of vouchers still pending. */
type Liability={balances:bigint;pendingBonus:bigint;pendingNormal:bigint};
async function bonusLiability(e:AirdropEnv):Promise<Liability>{
 const l=await first(e,"SELECT COALESCE(SUM(CAST(bonus_points AS bigint)),0) AS t FROM agents WHERE bonus_points<>'0'");
 const p=await first(e,"SELECT COALESCE(SUM(CAST(bonus_points AS bigint)),0) AS b, COALESCE(SUM(CAST(delta_points AS bigint)-CAST(bonus_points AS bigint)),0) AS n FROM airdrop_conversions WHERE season=1 AND status='pending'");
 return {balances:bigSum(l?.t),pendingBonus:bigSum(p?.b),pendingNormal:bigSum(p?.n)};
}
/** Off-chain reservation: while season 1 is open, normal vouchers may not push the on-chain remainder below the bonus liability. Bonus conversions may use the reserve. */
function reserveView(s1:ChainSeason|undefined,l:Liability){
 const active=!!s1&&s1.status==='open',remaining=active?s1!.remaining*s1!.pointsPerNib/E18:0n,liability=active?l.balances+l.pendingBonus:0n;
 const reserved=liability<remaining?liability:remaining,used=active?l.pendingNormal+liability:0n;
 return {active,enforced:active&&liability>0n,remainingPoints:remaining,liability,reserved,capacity:remaining>used?remaining-used:0n};
}
// Same rule, re-evaluated inside the agent UPDATE so concurrent issuers cannot jointly exceed it.
const PENDING_BONUS="(SELECT COALESCE(SUM(CAST(bonus_points AS bigint)),0) FROM airdrop_conversions WHERE season=1 AND status='pending')",BONUS_BALANCES="(SELECT COALESCE(SUM(CAST(bonus_points AS bigint)),0) FROM agents WHERE bonus_points<>'0')";
// No bonus outstanding: no reserve, so over-asking stays allowed (the chain partly fills it and the rest is refunded).
const RESERVE_GUARD=`(${PENDING_BONUS}+${BONUS_BALANCES}=0 OR CAST(? AS bigint)-(SELECT COALESCE(SUM(CAST(delta_points AS bigint)),0) FROM airdrop_conversions WHERE season=1 AND status='pending')-${BONUS_BALANCES}-CAST(? AS bigint)>=0)`;
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
 const source=payload?.source;if(source!==undefined&&source!==null&&source!=='bonus'&&source!=='normal'&&source!=='all')fail(400,'source must be "bonus", "normal" or "all".');
 const bonusOnly=source==='bonus';
 if(bonusOnly&&want!==1)fail(409,'NFT bonus TAP converts in airdrop season 1 only.');
 if(bonusOnly&&bonusBalance(a)<=0n)fail(409,'You have no NFT bonus TAP to convert.');
 const normalBal=bonusOnly?0n:pointBalance(a),rate=season.pointsPerNib;
 // NFT bonus TAP is a separate balance: usable in season 1 only (and only if the holder leaves it on), ignored and forfeited for seasons 2+.
 const bonusAvail=want===1&&payload?.useBonus!==false&&source!=='normal'?bonusBalance(a):0n,balance=normalBal+bonusAvail,all=payload?.points===undefined||payload?.points===null||payload.points==='all';
 let points:bigint;
 if(all)points=balance;
 else{try{points=exactPoints(typeof payload.points==='string'?payload.points:Number(payload.points));}catch{return fail(400,'Enter a whole number of TAP points.');}}
 if(points<=0n)fail(400,'Enter a positive number of TAP points.');
 if(points>balance)fail(409,bonusOnly?'You do not have that many NFT bonus TAP.':want===1?'You do not have that many TAP points (normal plus NFT bonus).':'You do not have that many TAP points. NFT bonus TAP cannot be converted after season 1.');
 if(points<rate)fail(400,`Convert at least ${rate} TAP (1 NIB).`);
 // Draw the bonus bucket first, then normal points.
 const bonusPart=points<bonusAvail?points:bonusAvail;let normalPart=points-bonusPart;
 const reserveMsg=(cap:bigint)=>`Season 1 capacity is reserved for NFT bonus holders. At most ${cap} normal TAP can convert right now; NFT bonus TAP can still convert.`;
 if(want===1&&normalPart>0n){
  await reconcile(e,now,undefined,1).catch(()=>{});// settle claimed/expired season 1 vouchers so the reserve is measured against settled state
  const view=reserveView(season,await bonusLiability(e));
  if(view.enforced&&normalPart>view.capacity){
   if(!all||bonusPart+view.capacity<rate)fail(409,reserveMsg(view.capacity));
   normalPart=view.capacity;points=bonusPart+normalPart;
  }
 }
 const signer=signerAccount(e),c=client(e);
 let onchainSigner:string,base:bigint;
 try{[onchainSigner,base]=await Promise.all([c.readContract({address:addresses(e).airdrop,abi:airdropAbi,functionName:'signer'}),c.readContract({address:addresses(e).airdrop,abi:airdropAbi,functionName:'convertedPoints',args:[BigInt(want),a.wallet as `0x${string}`]})]);}
 catch{return fail(503,'The NIB airdrop contract could not be read. No points were deducted.');}
 if(onchainSigner.toLowerCase()!==signer.address.toLowerCase())fail(503,'The configured NIB signer does not match the contract. No points were deducted.');
 const id=keccak256(toHex(crypto.getRandomValues(new Uint8Array(32)))) as `0x${string}`,deadline=Math.floor(now/1000)+VOUCHER_TTL_SECONDS,cumulative=base+points;
 const signature=await signer.signTypedData({domain:{name:'NibAirdrop',version:'1',chainId:56,verifyingContract:addresses(e).airdrop},types:voucherTypes,primaryType:'Voucher',message:{wallet:a.wallet as `0x${string}`,season:BigInt(want),cumulativePoints:cumulative,deadline:BigInt(deadline),voucherId:id}});
 const exact=access.required===true;
 try{
  const guarded=want===1&&normalPart>0n;
  await applyPoints(e,a,exact,-normalPart,'convert',`Converted ${points} TAP to NIB · airdrop season ${want}`+(bonusPart>0n?` (${bonusPart} NFT bonus + ${normalPart} normal)`:''),[(event:string)=>q(e,'INSERT INTO airdrop_conversions(id,wallet,season,delta_points,bonus_points,cumulative_points,base_converted,deadline,status,signature,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',id,a.wallet,want,points.toString(),bonusPart.toString(),cumulative.toString(),base.toString(),deadline,'pending',signature,now,a.wallet,event)],now,
   guarded?{sql:RESERVE_GUARD,args:[Number(reserveView(season,{balances:0n,pendingBonus:0n,pendingNormal:0n}).remainingPoints),Number(normalPart)]}:undefined,-bonusPart);
 }catch(err){
  if(want===1&&normalPart>0n){// a concurrent issuer may have taken the last reserve-free capacity
   const view=reserveView(season,await bonusLiability(e));if(view.enforced&&normalPart>view.capacity)fail(409,reserveMsg(view.capacity));
  }
  if(err instanceof AirdropError)throw err;fail(409,'Another conversion is already pending for this wallet and season.');
 }
 const row=await first(e,'SELECT * FROM airdrop_conversions WHERE id=?',id);if(!row)fail(409,'Your agent changed during this request. No conversion was recorded; refresh and retry.');
 return {reused:false,conversion:voucherView(e,row as Row),estimatedNib:(points*E18/rate).toString()};
}
export async function airdropRoute(request:Request,e:AirdropEnv,a:any|null,readBody:()=>Promise<any>,now:number):Promise<Response|null>{
 const path=new URL(request.url).pathname.replace(/^\/api/,'');
 const respond=(data:any,status=200)=>new Response(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(path==='/airdrop'&&request.method==='GET')return respond(await airdropStatus(e,a,now));
 if(path==='/airdrop/nft-bonus'&&request.method==='POST'){if(!request.headers.get('oai-authenticated-user-id'))fail(401,'Sign in to manage your agent.');return respond(await claimNftBonus(e,a,now),200);}
 if(path==='/airdrop/voucher'&&request.method==='POST'){if(!request.headers.get('oai-authenticated-user-id'))fail(401,'Sign in to manage your agent.');const b=await readBody();return respond(await issueVoucher(e,a,b,now),200);}
 return null;
}
/** Signed agent actions mirror the browser endpoints for agents using baw. */
export async function airdropAction(e:AirdropEnv,a:any,action:string,payload:any,now:number){
 if(action==='airdrop-state')return {airdrop:await airdropStatus(e,a,now)};
 if(action==='airdrop-nft-bonus')return {airdrop:await claimNftBonus(e,a,now)};
 if(action==='airdrop-voucher')return {airdrop:await issueVoucher(e,a,payload,now)};
 return fail(400,'Unknown airdrop action.');
}
