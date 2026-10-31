import {createPublicClient,http,fallback,parseAbi,encodeFunctionData,formatUnits,parseUnits,isAddress,keccak256,toHex,hexToBytes} from 'viem';
import {bsc} from 'viem/chains';
import {requireGameAccess,type UtilityEnv} from './utility';
import {NIB_TOKEN} from './airdrop';
// Bug Bounty: projects escrow NIB in NibBugBounty, hunters (Binance agents) commit a hash of a private report, reveal it, and are paid by tier.
// The contract is the only judge of money. This module is a read model, a preview builder (baw previews, nothing is ever sent from here)
// and a private store for the two things that must not live on-chain: the public scope text and the (encrypted) vulnerability reports.
export class BugBountyError extends Error{constructor(public status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new BugBountyError(status,message);};
export type BugBountyEnv=UtilityEnv&{BUG_BOUNTY_CONTRACT?:string;BUG_BOUNTY_REPORT_KEY?:string;NIB_TOKEN?:string;BSC_RPC_URL?:string};
export const BUG_BOUNTY_ACTIONS=['bounty-state','bounty-tx','bounty-scope-put','bounty-report-put','bounty-report-get'];
export const MAX_SCOPE_BYTES=16384,MAX_REPORT_BYTES=49152,MAX_LIST=40;
export const TIER_NAMES:Record<number,string[]>={1:['Bounty'],2:['Low','High'],3:['Low','Medium','High'],4:['Low','Medium','High','Critical']};
export const STATUS=['None','Committed','Revealed','Decided','Disputed','Settled','Expired'] as const;
export const REASONS=['none','duplicate','not_a_vulnerability','out_of_scope','not_reproducible'] as const;
export const bountyAbi=parseAbi([
 'function nib() view returns (address)','function arbiter() view returns (address)','function feeRecipient() view returns (address)','function feeBps() view returns (uint256)','function minDeposit() view returns (uint256)','function minLowestTier() view returns (uint256)',
 'function bountyNonce() view returns (uint256)','function submissionNonce() view returns (uint256)','function totalEscrow() view returns (uint256)','function totalStakes() view returns (uint256)','function totalPaid() view returns (uint256)','function totalBurned() view returns (uint256)','function totalFees() view returns (uint256)',
 'function pendingArbiter() view returns (address)','function pendingArbiterAt() view returns (uint256)',
 'function getBounty(uint256 id) view returns ((address creator,uint64 createdAt,uint64 endsAt,uint64 cancelRequestedAt,uint32 reviewWindow,uint32 tierCount,uint32 pending,uint32 submissionCount,bool closed,uint256 stake,uint256 available,uint256 reserved,bytes32 scopeHash,uint256[4] tiers))',
 'function getSubmission(uint256 id) view returns ((uint256 bountyId,address hunter,uint8 status,uint8 claimed,uint8 awarded,uint8 reason,bool escalated,bytes32 commitHash,bytes32 reportHash,uint64 committedAt,uint64 revealedAt,uint64 deadline,uint256 duplicateOf,uint256 stake,uint256 bond))',
 'function submissionsOf(uint256 bountyId) view returns (uint256[])','function hunterSubmissions(address hunter) view returns (uint256[])',
 'function closesAt(uint256 id) view returns (uint256)','function isOpen(uint256 id) view returns (bool)','function freeSlots(uint256 id) view returns (uint256)',
 'function creatorStats(address) view returns (uint32 bounties,uint32 paid,uint32 rejected,uint32 overturned,uint32 silent,uint256 paidTotal)','function hunterStats(address) view returns (uint32 paid,uint32 rejected,uint256 earned)',
 'function commitHashFor(uint256 bountyId,address hunter,uint8 severity,bytes32 reportHash,bytes32 salt) view returns (bytes32)',
 'function createBounty(bytes32 scopeHash,uint256[] tiers,uint256 endsAt,uint256 reviewWindow,uint256 stake,uint256 deposit) returns (uint256)','function topUp(uint256 id,uint256 amount)','function extend(uint256 id,uint256 newEndsAt)','function requestCancel(uint256 id)','function withdraw(uint256 id)',
 'function commit(uint256 bountyId,bytes32 commitHash) returns (uint256)','function reveal(uint256 submissionId,uint8 severity,bytes32 reportHash,bytes32 salt)',
 'function accept(uint256 submissionId,uint8 severity)','function reject(uint256 submissionId,uint8 reason,uint256 duplicateOf)','function acceptDecision(uint256 submissionId)','function dispute(uint256 submissionId)','function escalate(uint256 submissionId)',
 'function expireCommit(uint256 submissionId)','function finalize(uint256 submissionId)','function claimArbiterTimeout(uint256 submissionId)','function resolveDispute(uint256 submissionId,uint8 severity,bool returnStake)'
]);
const erc20Abi=parseAbi(['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)']);
const client=(e:BugBountyEnv)=>createPublicClient({chain:bsc,transport:e.BSC_RPC_URL?http(e.BSC_RPC_URL,{timeout:8000,retryCount:1,batch:true}):fallback([http('https://bsc-dataseed.bnbchain.org',{timeout:8000,retryCount:0,batch:true}),http('https://bsc-dataseed-public.bnbchain.org',{timeout:8000,retryCount:0,batch:true})])}) as any;
/** The feature is invisible until BUG_BOUNTY_CONTRACT holds a valid address. */
export const bountyAddress=(e:BugBountyEnv)=>e.BUG_BOUNTY_CONTRACT&&isAddress(e.BUG_BOUNTY_CONTRACT)?e.BUG_BOUNTY_CONTRACT as `0x${string}`:null;
export const bountyEnabled=(e:BugBountyEnv)=>bountyAddress(e)!==null;
const tokenAddress=(e:BugBountyEnv)=>(e.NIB_TOKEN&&isAddress(e.NIB_TOKEN)?e.NIB_TOKEN:NIB_TOKEN) as `0x${string}`;
const lc=(s:string)=>s.toLowerCase();
const ZERO='0x0000000000000000000000000000000000000000';
const E18=10n**18n;
const nibText=(v:bigint)=>formatUnits(v,18);

/* ---------- pure helpers (unit-tested) ---------- */
/** Plain decimal NIB amount to wei. Rejects anything that is not a plain decimal. */
export function nibAmount(v:any,label:string,max=10n**9n*E18):bigint{
 if(typeof v==='number')v=String(v);
 if(typeof v!=='string'||!/^\d{1,12}(\.\d{1,18})?$/.test(v.trim()))fail(400,`${label} must be a plain decimal NIB amount.`);
 const n=parseUnits(v.trim(),18);if(n<=0n||n>max)fail(400,`${label} is out of range.`);return n;
}
export const scopeHash=(text:string)=>keccak256(toHex(text));
export const reportHashOf=(body:string)=>keccak256(toHex(body));
const byteLength=(s:string)=>new TextEncoder().encode(s).length;
export function tierLabel(count:number,severity:number){return (TIER_NAMES[count]||[])[severity-1]||'Tier '+severity;}
/** A bounty's lifecycle label for the UI. */
export function bountyPhase(b:{closed:boolean;endsAt:number;closesAt:number;cancelRequestedAt:number},nowSec:number){
 if(b.closed)return 'withdrawn';if(nowSec>=b.closesAt)return 'ended';if(b.cancelRequestedAt>0)return 'closing';return 'open';
}
/** Terms a project must accept before the preview is built (mirrors the contract so errors are friendly; the contract still enforces). */
export function createTerms(p:any,params:{minDeposit:bigint;minLowestTier:bigint},nowSec:number){
 const tiers:bigint[]=Array.isArray(p?.tiers)?p.tiers.map((t:any,i:number)=>nibAmount(t,`tier ${i+1}`)):fail(400,'Give 1 to 4 payout tiers, lowest first, for example ["10000","25000","50000","100000"].');
 if(tiers.length<1||tiers.length>4)fail(400,'Give 1 to 4 payout tiers.');
 for(let i=1;i<tiers.length;i++)if(tiers[i]<=tiers[i-1])fail(400,'Payout tiers must be strictly increasing, lowest first.');
 if(tiers[0]<params.minLowestTier)fail(400,`The lowest tier must pay at least ${nibText(params.minLowestTier)} NIB.`);
 const top=tiers[tiers.length-1],deposit=nibAmount(p?.deposit,'deposit');
 if(deposit<params.minDeposit)fail(400,`The escrow must be at least ${nibText(params.minDeposit)} NIB.`);
 if(deposit<top)fail(400,'The escrow must cover at least one payout of the top tier.');
 const days=Number(p?.days);if(!Number.isFinite(days)||days<14||days>365)fail(400,'The bounty must run for 14 to 365 days.');
 const reviewDays=Number(p?.reviewDays??7);if(!Number.isFinite(reviewDays)||reviewDays<3||reviewDays>30)fail(400,'The project review window must be 3 to 30 days.');
 const lowest=tiers[0],stake=p?.stake===undefined||p.stake===null||p.stake===''?lowest/50n:nibAmount(p.stake,'stake');
 if(stake*100n<lowest||stake*10n>lowest)fail(400,`The hunter stake must be between 1% (${nibText(lowest/100n)} NIB) and 10% (${nibText(lowest/10n)} NIB) of the lowest tier.`);
 const text=typeof p?.scope==='string'?p.scope:fail(400,'Describe the scope: what is in scope, what is not, and how to report.');
 if(text.trim().length<40)fail(400,'The scope text is too short to be a fair rule set (at least 40 characters).');
 if(byteLength(text)>MAX_SCOPE_BYTES)fail(400,'The scope text is too large (16 KB maximum).');
 return {tiers,deposit,stake,endsAt:BigInt(nowSec+Math.round(days*86400)),reviewWindow:BigInt(Math.round(reviewDays*86400)),scope:text,scopeHash:scopeHash(text),days,reviewDays};
}

/* ---------- encryption at rest for reports (AES-256-GCM) ---------- */
const b64=(u:Uint8Array)=>{let s='';for(const b of u)s+=String.fromCharCode(b);return btoa(s);};
const unb64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function reportKey(e:BugBountyEnv){
 const k=e.BUG_BOUNTY_REPORT_KEY;if(!k||!/^[0-9a-fA-F]{64}$/.test(k))return fail(503,'Private report storage is not configured, so reports cannot be submitted yet.');
 return crypto.subtle.importKey('raw',new Uint8Array(hexToBytes(('0x'+k) as `0x${string}`)),'AES-GCM',false,['encrypt','decrypt']);
}
const aad=(submissionId:string,reportHash:string)=>new TextEncoder().encode('taptap-bug-bounty:'+submissionId+':'+reportHash.toLowerCase());
export async function sealReport(e:BugBountyEnv,submissionId:string,reportHash:string,body:string){
 const key=await reportKey(e),iv=crypto.getRandomValues(new Uint8Array(12));
 const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(submissionId,reportHash)},key,new TextEncoder().encode(body)));
 return {iv:b64(iv),ciphertext:b64(ct)};
}
export async function openReport(e:BugBountyEnv,submissionId:string,reportHash:string,row:{iv:string;ciphertext:string}){
 const key=await reportKey(e);
 try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(row.iv),additionalData:aad(submissionId,reportHash)},key,unb64(row.ciphertext)));}
 catch{return fail(500,'The stored report could not be decrypted (wrong key or tampered record).');}
}

/* ---------- chain reads ---------- */
async function requireContract(e:BugBountyEnv){
 const address=bountyAddress(e);if(!address)return fail(404,'Bug Bounty is not available.');
 const c=client(e);let code:string|undefined;try{code=await c.getCode({address});}catch{return fail(503,'The Bug Bounty contract could not be read. Nothing was changed.');}
 if(!code||code==='0x')return fail(503,'The Bug Bounty contract is not deployed at the configured address. Ignoring it.');
 return {address,c};
}
const rd=(c:any,address:`0x${string}`,functionName:string,args:any[]=[])=>c.readContract({address,abi:bountyAbi,functionName,args});
/** Many reads in one JSON-RPC batch (the transport batches same-tick requests). Works on any node: no Multicall3 dependency. */
const many=(c:any,address:`0x${string}`,calls:{functionName:string;args:any[]}[]):Promise<any[]>=>Promise.all(calls.map(x=>rd(c,address,x.functionName,x.args)));
async function params(c:any,a:`0x${string}`){
 const [arbiter,feeRecipient,feeBps,minDeposit,minLowestTier,nib]=await Promise.all(['arbiter','feeRecipient','feeBps','minDeposit','minLowestTier','nib'].map(fn=>rd(c,a,fn)));
 return {arbiter:lc(arbiter),feeRecipient:lc(feeRecipient),feeBps:Number(feeBps),minDeposit:minDeposit as bigint,minLowestTier:minLowestTier as bigint,nib:lc(nib)};
}
const bountyView=(id:bigint,b:any,closesAt:bigint,freeSlots:bigint,nowSec:number)=>{
 const tiers=(b.tiers as bigint[]).slice(0,b.tierCount).map((t,i)=>({severity:i+1,label:tierLabel(b.tierCount,i+1),nib:nibText(t),raw:t.toString()}));
 const cl=Number(closesAt);
 return {id:id.toString(),creator:lc(b.creator),createdAt:Number(b.createdAt),endsAt:Number(b.endsAt),closesAt:cl,cancelRequestedAt:Number(b.cancelRequestedAt),phase:bountyPhase({closed:b.closed,endsAt:Number(b.endsAt),closesAt:cl,cancelRequestedAt:Number(b.cancelRequestedAt)},nowSec),
  reviewWindowDays:Number(b.reviewWindow)/86400,pending:Number(b.pending),submissions:Number(b.submissionCount),closed:b.closed,stake:nibText(b.stake),stakeRaw:b.stake.toString(),available:nibText(b.available),reserved:nibText(b.reserved),scopeHash:b.scopeHash,tiers,freeSlots:Number(freeSlots)};
};
const submissionView=(id:bigint,s:any,tierCount?:number)=>({id:id.toString(),bountyId:s.bountyId.toString(),hunter:lc(s.hunter),status:STATUS[s.status]||'Unknown',claimed:s.claimed||null,claimedLabel:s.claimed&&tierCount?tierLabel(tierCount,s.claimed):null,awarded:s.awarded||null,awardedLabel:s.awarded&&tierCount?tierLabel(tierCount,s.awarded):null,
 reason:REASONS[s.reason]||'none',escalated:s.escalated,commitHash:s.commitHash,reportHash:s.status>=2?s.reportHash:null,committedAt:Number(s.committedAt),revealedAt:Number(s.revealedAt)||null,deadline:Number(s.deadline),duplicateOf:s.duplicateOf>0n?s.duplicateOf.toString():null,stake:nibText(s.stake),bond:nibText(s.bond)});

/** Public snapshot. When the contract address is not configured this is just {enabled:false}: no RPC, no hint of what is coming. */
export async function bugBountyState(e:BugBountyEnv,wallet:string|null,now:number){
 if(!bountyEnabled(e))return {enabled:false};
 const {address,c}=await requireContract(e).catch((err:any)=>{if(err instanceof BugBountyError&&err.status===404)throw err;return {address:null as any,c:null as any,error:err};}) as any;
 if(!address)return {enabled:true,live:false,message:'Bug Bounty is configured but the contract cannot be read right now.',bounties:[]};
 const nowSec=Math.floor(now/1000);
 try{
  const [p,nonce,escrow,stakes,paid,burned,fees,pa,paAt]=await Promise.all([params(c,address),...['bountyNonce','totalEscrow','totalStakes','totalPaid','totalBurned','totalFees','pendingArbiter','pendingArbiterAt'].map(fn=>rd(c,address,fn))]);
  const first=nonce>BigInt(MAX_LIST)?nonce-BigInt(MAX_LIST)+1n:1n,ids:bigint[]=[];for(let i=nonce;i>=first&&i>0n;i--)ids.push(i);
  const raw=ids.length?await many(c,address,ids.flatMap(id=>[{functionName:'getBounty',args:[id]},{functionName:'closesAt',args:[id]},{functionName:'freeSlots',args:[id]}])):[];
  const scopes=ids.length?await e.DB.prepare(`SELECT bounty_id,text FROM bounty_scopes WHERE bounty_id IN (${ids.map(()=> '?').join(',')})`).bind(...ids.map(i=>i.toString())).all<any>():{results:[]};
  const text=new Map<string,string>(scopes.results.map((r:any)=>[String(r.bounty_id),r.text]));
  const bounties=ids.map((id,i)=>{const b=raw[i*3],v:any=bountyView(id,b,raw[i*3+1],raw[i*3+2],nowSec),t=text.get(id.toString());
   // The scope text is only shown when it matches the hash the project committed on-chain.
   return {...v,scope:t&&scopeHash(t)===b.scopeHash?{text:t,verified:true}:{text:null,verified:false}};});
  const out:any={enabled:true,live:true,chainId:56,contract:address,token:tokenAddress(e),params:{arbiter:p.arbiter,feeBps:p.feeBps,feeRecipient:p.feeRecipient,minDeposit:nibText(p.minDeposit),minLowestTier:nibText(p.minLowestTier),
   stakeRule:'1% to 10% of the lowest tier, set by the project',reviewWindowDays:'3 to 30 (set by the project)',minDurationDays:14,maxDurationDays:365,revealWindowHours:24,disputeWindowDays:3,arbiterTimeoutDays:14,cancelCooldownDays:7,maxOpenSubmissionsPerBounty:20,maxActivePerHunterPerBounty:3,
   arbiterChange:pa!==ZERO?{proposed:lc(pa),effectiveAt:Number(paAt)}:null},
   totals:{escrow:nibText(escrow),stakes:nibText(stakes),paid:nibText(paid),burned:nibText(burned),fees:nibText(fees),bounties:Number(nonce)},bounties,reportsEnabled:/^[0-9a-fA-F]{64}$/.test(e.BUG_BOUNTY_REPORT_KEY||'')};
  if(wallet){
   const w=wallet as `0x${string}`;
   const [hs,cs,ids2]=await Promise.all([rd(c,address,'hunterStats',[w]),rd(c,address,'creatorStats',[w]),rd(c,address,'hunterSubmissions',[w])]);
   const mineIds=(ids2 as bigint[]).slice(-MAX_LIST).reverse();
   const subs=mineIds.length?await many(c,address,mineIds.map(id=>({functionName:'getSubmission',args:[id]}))):[];
   out.you={wallet:lc(wallet),isArbiter:lc(wallet)===p.arbiter,hunter:{paid:Number(hs[0]),rejected:Number(hs[1]),earnedNib:nibText(hs[2])},creator:{bounties:Number(cs[0]),paid:Number(cs[1]),rejected:Number(cs[2]),overturned:Number(cs[3]),silent:Number(cs[4]),paidNib:nibText(cs[5])},
    myBounties:bounties.filter(b=>b.creator===lc(wallet)).map(b=>b.id),mySubmissions:mineIds.map((id,i)=>{const s=subs[i];const b=bounties.find(x=>x.id===s.bountyId.toString());return submissionView(id,s,b?.tiers.length);})};
  }
  return out;
 }catch(err){if(err instanceof BugBountyError)throw err;return fail(503,'The Bug Bounty contract could not be read. Nothing was changed.');}
}
/** Submissions of one bounty (public on-chain facts only; never any report text). */
export async function bountySubmissions(e:BugBountyEnv,id:string,now:number){
 const {address,c}=await requireContract(e);let bid:bigint;try{bid=BigInt(id);}catch{return fail(400,'Give a numeric bounty id.');}
 const b=await rd(c,address,'getBounty',[bid]);if(b.creator===ZERO)fail(404,'That bounty does not exist.');
 const ids=(await rd(c,address,'submissionsOf',[bid]) as bigint[]).slice(-100);
 const subs=ids.length?await many(c,address,ids.map(i=>({functionName:'getSubmission',args:[i]}))):[];
 return {bountyId:bid.toString(),creator:lc(b.creator),submissions:ids.map((i,k)=>submissionView(i,subs[k],b.tierCount))};
}

/* ---------- signed agent actions: baw previews, never sent from here ---------- */
const tx=(from:string,to:string,abi:any,functionName:string,args:any[],value=0n)=>({chainId:56,from,to,value:value.toString(),data:encodeFunctionData({abi,functionName,args} as any)});
const baw=(t:{from:string;to:string;value:string;data:string})=>`baw contract-call preview --binanceChainId 56 --from ${t.from} --to ${t.to} --value ${t.value} --inputData ${t.data} --json`;
const PREVIEW_NOTE='Run the baw preview, show the user the parsed call, gas and risks, and execute only after explicit approval. Previews expire in about 5 minutes. Never re-execute an uncertain transaction: check the hash first.';
const id256=(v:any,label='id')=>{try{const n=BigInt(String(v??''));if(n<=0n||n>=2n**64n)throw 0;return n;}catch{return fail(400,`Give a numeric ${label}.`);}};
const sev=(v:any,max=4)=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>max)fail(400,`severity must be a whole number from 1 to ${max}.`);return n;};
const hex32=(v:any,label:string)=>typeof v==='string'&&/^0x[0-9a-fA-F]{64}$/.test(v)?v as `0x${string}`:fail(400,`${label} must be a 32-byte hex value.`);
export const BOUNTY_FUNCTIONS=['create','topup','extend','cancel','withdraw','commit','reveal','accept','reject','accept-decision','dispute','escalate','expire','finalize','arbiter-timeout','resolve'] as const;
/** Builds one previewable step, or two when an exact-amount NIB approval is needed first. */
export async function bountyTxAction(e:BugBountyEnv,a:any,payload:any,now:number){
 const {address,c}=await requireContract(e);await requireGameAccess(e,a);
 const fn=String(payload?.fn||'');if(!(BOUNTY_FUNCTIONS as readonly string[]).includes(fn))fail(400,'Unknown bounty step. Use one of: '+BOUNTY_FUNCTIONS.join(', ')+'.');
 const wallet=a.wallet as `0x${string}`,w=lc(wallet),nowSec=Math.floor(now/1000),token=tokenAddress(e);
 const p=await params(c,address);
 let need=0n,call:{name:string;args:any[]},summary:any={},warnings:string[]=[];
 const bountyOf=async(id:bigint)=>{const b=await rd(c,address,'getBounty',[id]);if(b.creator===ZERO)fail(404,'That bounty does not exist.');return b;};
 const subOf=async(id:bigint)=>{const s=await rd(c,address,'getSubmission',[id]);if(s.hunter===ZERO)fail(404,'That submission does not exist.');return s;};
 const creatorOnly=(b:any)=>{if(lc(b.creator)!==w)fail(403,'Only the project that created this bounty can do that.');};
 const stateIs=(s:any,want:number[],msg:string)=>{if(!want.includes(s.status))fail(409,msg+' (it is '+STATUS[s.status]+').');};
 if(fn==='create'){
  const t=createTerms(payload,p,nowSec);
  if(w===p.arbiter)fail(403,'The arbiter cannot create bounties.');
  need=t.deposit;call={name:'createBounty',args:[t.scopeHash,t.tiers,t.endsAt,t.reviewWindow,t.stake,t.deposit]};
  summary={fn,escrowedNib:nibText(t.deposit),tiers:t.tiers.map((x:bigint,i:number)=>({label:tierLabel(t.tiers.length,i+1),nib:nibText(x)})),endsAt:new Date(Number(t.endsAt)*1000).toISOString(),days:t.days,reviewWindowDays:t.reviewDays,hunterStakeNib:nibText(t.stake),scopeHash:t.scopeHash,
   rules:['The NIB is escrowed now and cannot be withdrawn before the end date, nor while any submission is pending, nor during the 7-day cancel cooldown.','You must accept or reject each report inside the review window, or the hunter can send it to the neutral arbiter.','Payouts are the fixed tiers above. A valid finding is paid in full minus a '+(p.feeBps/100)+'% protocol fee taken from the hunter.','Next: publish the scope text with `do bounty-scope <id> --file scope.md` once this confirms.']};
 }else if(fn==='topup'){
  const id=id256(payload.id),b=await bountyOf(id);creatorOnly(b);const amount=nibAmount(payload.amount,'amount');need=amount;call={name:'topUp',args:[id,amount]};summary={fn,bountyId:id.toString(),addNib:nibText(amount)};
 }else if(fn==='extend'){
  const id=id256(payload.id),b=await bountyOf(id);creatorOnly(b);const days=Number(payload.days);if(!Number.isFinite(days)||days<=0||days>365)fail(400,'days must be above 0 and at most 365 (from now).');
  const endsAt=BigInt(nowSec+Math.round(days*86400));if(endsAt<=b.endsAt)fail(409,'A bounty can only be extended, never shortened.');call={name:'extend',args:[id,endsAt]};summary={fn,bountyId:id.toString(),newEnd:new Date(Number(endsAt)*1000).toISOString()};
 }else if(fn==='cancel'){
  const id=id256(payload.id),b=await bountyOf(id);creatorOnly(b);if(b.cancelRequestedAt>0n)fail(409,'This bounty is already closing.');call={name:'requestCancel',args:[id]};
  summary={fn,bountyId:id.toString(),effect:'Starts a 7-day cancel cooldown. Hunters can still submit during it. You can withdraw the unspent escrow only after it ends and every submission is resolved.'};
 }else if(fn==='withdraw'){
  const id=id256(payload.id),b=await bountyOf(id);creatorOnly(b);if(b.closed)fail(409,'Already withdrawn.');const cl=await rd(c,address,'closesAt',[id]);
  if(BigInt(nowSec)<cl)fail(409,'The bounty is still open until '+new Date(Number(cl)*1000).toISOString()+'. Escrow cannot be withdrawn before then.');if(b.pending>0)fail(409,'Submissions are still pending. Escrow stays locked until every one is resolved.');
  call={name:'withdraw',args:[id]};summary={fn,bountyId:id.toString(),refundNib:nibText(b.available)};
 }else if(fn==='commit'){
  const id=id256(payload.bountyId,'bounty id'),b=await bountyOf(id),ch=hex32(payload.commitHash,'commitHash');
  if(lc(b.creator)===w)fail(403,'A project cannot submit to its own bounty.');if(w===p.arbiter)fail(403,'The arbiter cannot submit to bounties.');
  const open=await rd(c,address,'isOpen',[id]);if(!open)fail(409,'This bounty is not open for new submissions.');const slots=await rd(c,address,'freeSlots',[id]);if(slots===0n)fail(409,'This bounty has no free submission slots right now (escrow is fully reserved or the open-submission limit is reached).');
  need=b.stake;call={name:'commit',args:[id,ch]};summary={fn,bountyId:id.toString(),stakeNib:nibText(b.stake),stakeNote:'Refunded when your report is accepted, or is a duplicate that stands. Burned if it is rejected and the rejection stands. Your finding stays private: only a hash goes on-chain now.',
   mustRevealWithin:'24 hours after this confirms, or the stake goes to the project.'};
  warnings.push('Do not lose the salt and report file the connector saved locally: they are needed to reveal. Reveal inside the 24-hour window.');
 }else if(fn==='reveal'){
  const id=id256(payload.id,'submission id'),s=await subOf(id);if(lc(s.hunter)!==w)fail(403,'Only the hunter who committed can reveal.');stateIs(s,[1],'Only a committed submission can be revealed');
  const sv=sev(payload.severity),rh=hex32(payload.reportHash,'reportHash'),salt=hex32(payload.salt,'salt');
  const expected=await rd(c,address,'commitHashFor',[s.bountyId,wallet,sv,rh,salt]);if(lc(expected)!==lc(s.commitHash))fail(409,'That severity, report hash and salt do not match what you committed. Nothing was prepared.');
  call={name:'reveal',args:[id,sv,rh,salt]};summary={fn,submissionId:id.toString(),severity:sv,reportHash:rh};
 }else if(fn==='accept'){
  const id=id256(payload.id,'submission id'),s=await subOf(id),b=await bountyOf(s.bountyId);creatorOnly(b);stateIs(s,[2],'Only a revealed submission awaiting review can be accepted');const sv=sev(payload.severity,s.claimed);
  call={name:'accept',args:[id,sv]};const gross=b.tiers[sv-1];summary={fn,submissionId:id.toString(),severity:sv,label:tierLabel(b.tierCount,sv),claimed:s.claimed,paysNib:nibText(gross),feePct:p.feeBps/100,hunterReceivesNib:nibText(gross-gross*BigInt(p.feeBps)/10000n),
   effect:sv===s.claimed?'Paid in full immediately.':'A lower severity than claimed: the hunter may accept it or dispute it to the arbiter within 3 days.'};
 }else if(fn==='reject'){
  const id=id256(payload.id,'submission id'),s=await subOf(id),b=await bountyOf(s.bountyId);creatorOnly(b);stateIs(s,[2],'Only a revealed submission awaiting review can be rejected');
  const reason=REASONS.indexOf(String(payload.reason) as any),r=reason>0?reason:fail(400,'reason must be one of: '+REASONS.slice(1).join(', ')+'.');
  const dup=payload.duplicateOf===undefined||payload.duplicateOf===null||payload.duplicateOf===''?0n:id256(payload.duplicateOf,'duplicateOf');
  if((r===1)!==(dup>0n))fail(400,r===1?'A duplicate rejection must name the earlier submission it duplicates (duplicateOf).':'duplicateOf is only for the duplicate reason.');
  call={name:'reject',args:[id,r,dup]};summary={fn,submissionId:id.toString(),reason:REASONS[r],duplicateOf:dup>0n?dup.toString():null,effect:'The hunter has 3 days to dispute. If they do not, the rejection stands'+(r===1?' and their stake is returned.':' and their stake is burned.')};
  warnings.push('Rejections are public on-chain and count toward your project\'s record. A rejection the arbiter overturns is also recorded.');
 }else if(fn==='dispute'){
  const id=id256(payload.id,'submission id'),s=await subOf(id);if(lc(s.hunter)!==w)fail(403,'Only the hunter can dispute.');stateIs(s,[3],'Only a decided submission can be disputed');
  need=s.stake;call={name:'dispute',args:[id]};summary={fn,submissionId:id.toString(),bondNib:nibText(s.stake),note:'Posts a bond equal to your stake. You get it back if the arbiter sides with you beyond what the project offered; otherwise it is burned.'};
 }else{
  const id=id256(payload.id,'submission id'),s=await subOf(id),b=await bountyOf(s.bountyId);
  const map:Record<string,{name:string;from:number[];who?:'hunter'|'arbiter';msg:string}>={
   'accept-decision':{name:'acceptDecision',from:[3],who:'hunter',msg:'Only a decided submission can be accepted'},escalate:{name:'escalate',from:[2],who:'hunter',msg:'Only a revealed submission can be escalated'},
   expire:{name:'expireCommit',from:[1],msg:'Only a committed submission can expire'},finalize:{name:'finalize',from:[3],msg:'Only a decided submission can be finalised'},'arbiter-timeout':{name:'claimArbiterTimeout',from:[4],msg:'Only a disputed submission can time out'},resolve:{name:'resolveDispute',from:[4],who:'arbiter',msg:'Only a disputed submission can be resolved'}};
  const m=map[fn];if(!m)return fail(400,'Unknown bounty step.');stateIs(s,m.from,m.msg);
  if(m.who==='hunter'&&lc(s.hunter)!==w)fail(403,'Only the hunter of this submission can do that.');if(m.who==='arbiter'&&w!==p.arbiter)fail(403,'Only the arbiter can do that.');
  const t=nowSec,dl=Number(s.deadline);
  if(fn==='expire'&&t<=dl)fail(409,'The reveal window is still open until '+new Date(dl*1000).toISOString()+'.');if(fn==='finalize'&&t<=dl)fail(409,'The dispute window is still open until '+new Date(dl*1000).toISOString()+'.');
  if(fn==='escalate'&&t<=dl)fail(409,'The project\'s review window is open until '+new Date(dl*1000).toISOString()+'.');if(fn==='arbiter-timeout'&&t<=dl)fail(409,'The arbiter has until '+new Date(dl*1000).toISOString()+'.');
  if(fn==='resolve'){const rs=Number(payload.severity),sv=Number.isInteger(rs)&&rs>=0&&rs<=4?rs:fail(400,'severity must be 0 (reject) to 4.');call={name:m.name,args:[id,sv,payload.returnStake===true]};summary={fn,submissionId:id.toString(),ruling:sv?tierLabel(b.tierCount,sv):'reject',returnStake:payload.returnStake===true};}
  else{call={name:m.name,args:[id]};summary={fn,submissionId:id.toString(),effect:fn==='accept-decision'?'Takes the lower severity the project offered and gets paid now.':fn==='escalate'?'Sends your report to the arbiter because the project did not answer in time. No bond is needed.':fn==='expire'?'Closes an unrevealed commit. The stake goes to the project.':fn==='finalize'?'Makes the project\'s decision final and pays out whatever it implies.':'The arbiter missed its deadline: the hunter gets the lowest tier (or the project\'s own award if higher) and the stake back.'};}
 }
 const steps:any[]=[];
 if(need>0n){
  const [balance,allowance]=await Promise.all([c.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[wallet]}),c.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[wallet,address]})]);
  if(balance<need)fail(409,`Your wallet holds ${nibText(balance)} NIB, but this step needs ${nibText(need)} NIB.`);
  if(allowance<need){const ap=tx(wallet,token,erc20Abi,'approve',[address,need]);steps.push({step:1,name:'approve exactly '+nibText(need)+' NIB for the Bug Bounty contract',transaction:ap,baw:baw(ap)});}
 }
 const main=tx(wallet,address,bountyAbi,call.name as any,call.args);
 steps.push({step:steps.length+1,name:call.name,transaction:main,baw:baw(main),dependsOn:steps.length?'Execute only after the approval transaction has confirmed.':null});
 return {bugBounty:{action:fn,summary,warnings,steps,note:PREVIEW_NOTE}};
}

/* ---------- private storage: scope text (public) and reports (encrypted, access-controlled) ---------- */
const q=(e:BugBountyEnv,sql:string,...args:any[])=>e.DB.prepare(sql).bind(...args);
async function daily(e:BugBountyEnv,table:string,col:string,wallet:string,now:number,limit:number){
 const n=await q(e,`SELECT COUNT(*) AS n FROM ${table} WHERE ${col}=? AND created_at>?`,wallet,now-86400000).first<any>();if((n?.n||0)>=limit)fail(429,'Daily limit reached. Try again tomorrow.');
}
export async function scopePutAction(e:BugBountyEnv,a:any,payload:any,now:number){
 const {address,c}=await requireContract(e);const id=id256(payload?.bountyId,'bounty id'),text=typeof payload?.text==='string'?payload.text:fail(400,'Give the scope text.');
 if(byteLength(text)>MAX_SCOPE_BYTES)fail(400,'The scope text is too large (16 KB maximum).');
 const b=await rd(c,address,'getBounty',[id]);if(b.creator===ZERO)fail(404,'That bounty does not exist.');if(lc(b.creator)!==lc(a.wallet))fail(403,'Only the project that created this bounty can publish its scope.');
 if(scopeHash(text)!==b.scopeHash)fail(409,'This text does not match the scope hash committed on-chain, so it cannot be published for this bounty.');
 if(await q(e,'SELECT bounty_id FROM bounty_scopes WHERE bounty_id=?',id.toString()).first())fail(409,'The scope for this bounty is already published. It is immutable: it was fixed by the on-chain hash.');
 await daily(e,'bounty_scopes','creator',lc(a.wallet),now,10);
 await q(e,'INSERT INTO bounty_scopes(bounty_id,creator,scope_hash,text,created_at) VALUES(?,?,?,?,?)',id.toString(),lc(a.wallet),b.scopeHash,text,now).run();
 return {bugBounty:{action:'scope-put',bountyId:id.toString(),published:true}};
}
export async function reportPutAction(e:BugBountyEnv,a:any,payload:any,now:number){
 const {address,c}=await requireContract(e);await requireGameAccess(e,a);await reportKey(e);
 const sid=id256(payload?.submissionId,'submission id'),body=typeof payload?.body==='string'?payload.body:fail(400,'Give the report body.');
 if(!body.length)fail(400,'The report is empty.');if(byteLength(body)>MAX_REPORT_BYTES)fail(400,'The report is too large (48 KB maximum). Link to a private gist for attachments.');
 const rh=hex32(payload?.reportHash,'reportHash');if(reportHashOf(body)!==lc(rh)&&reportHashOf(body)!==rh)fail(400,'reportHash is not the keccak256 of the report text.');
 const s=await rd(c,address,'getSubmission',[sid]);if(s.hunter===ZERO)fail(404,'That submission does not exist.');if(lc(s.hunter)!==lc(a.wallet))fail(403,'Only the hunter who committed this submission can store its report.');
 if(![1,2].includes(s.status))fail(409,'A report can only be stored while the submission is committed or awaiting review.');
 if(s.status===2&&lc(s.reportHash)!==lc(rh))fail(409,'This report does not match the report hash you revealed on-chain.');
 const sealed=await sealReport(e,sid.toString(),rh,body);
 await daily(e,'bounty_reports','hunter',lc(a.wallet),now,20);
 const exists=await q(e,'SELECT report_hash FROM bounty_reports WHERE submission_id=?',sid.toString()).first<any>();
 if(exists){if(s.status!==1)fail(409,'A report is already stored for this submission and it cannot be replaced after reveal.');await q(e,'UPDATE bounty_reports SET report_hash=?,iv=?,ciphertext=?,created_at=? WHERE submission_id=?',rh,sealed.iv,sealed.ciphertext,now,sid.toString()).run();}
 else await q(e,'INSERT INTO bounty_reports(submission_id,bounty_id,hunter,report_hash,iv,ciphertext,created_at) VALUES(?,?,?,?,?,?,?)',sid.toString(),s.bountyId.toString(),lc(a.wallet),rh,sealed.iv,sealed.ciphertext,now).run();
 return {bugBounty:{action:'report-put',submissionId:sid.toString(),stored:true,note:'Stored encrypted. Only you, and the project after you reveal on-chain, can read it (the arbiter only if it is disputed). Reveal within 24 hours of your commit.'}};
}
/** Who may read a report: the hunter always; the project only after the hunter revealed on-chain and the hash matches; the arbiter only while a dispute is open. */
export async function reportGetAction(e:BugBountyEnv,a:any,payload:any,now:number){
 const {address,c}=await requireContract(e);await reportKey(e);const sid=id256(payload?.submissionId,'submission id');
 const s=await rd(c,address,'getSubmission',[sid]);if(s.hunter===ZERO)fail(404,'That submission does not exist.');
 const row=await q(e,'SELECT * FROM bounty_reports WHERE submission_id=?',sid.toString()).first<any>();
 const w=lc(a.wallet),b=await rd(c,address,'getBounty',[s.bountyId]),p=await params(c,address);
 const isHunter=lc(s.hunter)===w,isCreator=lc(b.creator)===w,isArbiter=p.arbiter===w;
 let allowed=isHunter;
 if(!allowed&&isCreator&&[2,3,4,5].includes(s.status))allowed=true;
 if(!allowed&&isArbiter&&s.status===4)allowed=true;
 if(!allowed)fail(403,isCreator?'The report is readable by the project only after the hunter reveals it on-chain.':'You are not allowed to read this report.');
 if(!row)fail(404,'No report is stored for this submission.');
 if(!isHunter&&lc(row.report_hash)!==lc(s.reportHash))fail(409,'The stored report does not match the hash revealed on-chain. Treat it as invalid.');
 const body=await openReport(e,sid.toString(),row.report_hash,row);
 return {bugBounty:{action:'report-get',submissionId:sid.toString(),bountyId:s.bountyId.toString(),hunter:lc(s.hunter),status:STATUS[s.status],claimedSeverity:s.claimed||null,reportHash:row.report_hash,hashMatchesOnChain:lc(row.report_hash)===lc(s.reportHash),body}};
}
export async function bugBountyAction(e:BugBountyEnv,a:any,action:string,payload:any,now:number){
 if(!bountyEnabled(e))return fail(404,'Bug Bounty is not available.');
 if(action==='bounty-state')return {bugBounty:await bugBountyState(e,a?.wallet||null,now)};
 if(action==='bounty-tx')return bountyTxAction(e,a,payload,now);
 if(action==='bounty-scope-put')return scopePutAction(e,a,payload,now);
 if(action==='bounty-report-put')return reportPutAction(e,a,payload,now);
 if(action==='bounty-report-get')return reportGetAction(e,a,payload,now);
 return fail(400,'Unknown Bug Bounty action.');
}
const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function bugBountyRoute(request:Request,e:BugBountyEnv,a:any|null,now:number):Promise<Response|null>{
 const path=new URL(request.url).pathname.replace(/^\/api/,'');
 if(request.method!=='GET')return null;
 if(path==='/bug-bounty')return json(await bugBountyState(e,a?.connected?a.wallet:null,now));
 const m=path.match(/^\/bug-bounty\/(\d{1,18})\/submissions$/);if(m){if(!bountyEnabled(e))return json({error:'Bug Bounty is not available.'},404);return json(await bountySubmissions(e,m[1],now));}
 return null;
}
