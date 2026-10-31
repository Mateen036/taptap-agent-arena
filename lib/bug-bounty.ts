import {createPublicClient,http,fallback,parseAbi,encodeFunctionData,encodeAbiParameters,formatUnits,parseUnits,isAddress,keccak256,toHex,hexToBytes} from 'viem';
import {bsc} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';
import {requireGameAccess,type UtilityEnv} from './utility';
import {NIB_TOKEN,applyPoints,exactOn} from './airdrop';
import {pointBalance} from './points';
// Bug Bounty: projects escrow NIB in NibBugBounty. Hunters (Binance agents) commit a hash of a private report, stake TAP points (never NIB),
// reveal, and a randomly drawn panel of OTHER TapTap agents judges the report with sealed votes. The contract is the only judge of money.
// This module is a read model, a preview builder (baw previews, nothing is ever sent from here), the TAP point ledger for stakes
// (points are deducted when a signed ticket is issued, then returned / burned / rewarded from the contract's own `tapResult`)
// and a private store for the things that must not live on-chain: the public scope text and the (encrypted) vulnerability reports.
export class BugBountyError extends Error{constructor(public status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new BugBountyError(status,message);};
export type BugBountyEnv=UtilityEnv&{BUG_BOUNTY_CONTRACT?:string;BUG_BOUNTY_REPORT_KEY?:string;BUG_BOUNTY_SIGNER_PRIVATE_KEY?:string;NIB_TOKEN?:string;BSC_RPC_URL?:string};
export const BUG_BOUNTY_ACTIONS=['bounty-state','bounty-tx','bounty-scope-put','bounty-report-put','bounty-report-get'];
export const MAX_SCOPE_BYTES=16384,MAX_REPORT_BYTES=49152,MAX_LIST=40;
export const TICKET_TTL_SECONDS=900,MAX_OPEN_LOCKS=5,TICKETS_PER_DAY=30,RELEASE_MARGIN_SECONDS=60;
export const TIER_NAMES:Record<number,string[]>={1:['Bounty'],2:['Low','High'],3:['Low','Medium','High'],4:['Low','Medium','High','Critical']};
export const STATUS=['None','Committed','Applying','Voting','Settled'] as const;
export const OUTCOMES=['none','valid','invalid','duplicate','inconclusive','no_quorum','no_panel','unrevealed'] as const;
export const REVIEWER_STATES=['none','applied','seated','not_seated'] as const;
export const VERDICT_DUPLICATE=255;
export const MIN_TAP_STAKE=500n;
export const bountyAbi=parseAbi([
 'function nib() view returns (address)','function ticketSigner() view returns (address)','function guardian() view returns (address)','function feeRecipient() view returns (address)','function feeBps() view returns (uint256)','function reviewerBps() view returns (uint256)','function minDeposit() view returns (uint256)','function minLowestTier() view returns (uint256)',
 'function bountyNonce() view returns (uint256)','function submissionNonce() view returns (uint256)','function totalEscrow() view returns (uint256)','function totalOwed() view returns (uint256)','function totalPaid() view returns (uint256)','function totalFees() view returns (uint256)','function totalReviewerPaid() view returns (uint256)',
 'function pendingSigner() view returns (address)','function pendingSignerAt() view returns (uint256)',
 'function getBounty(uint256 id) view returns ((address creator,uint64 createdAt,uint64 endsAt,uint64 cancelRequestedAt,uint32 panelSize,uint32 tierCount,uint32 pending,uint32 submissionCount,bool closed,uint256 tapStake,uint256 available,uint256 reserved,bytes32 scopeHash,uint256[4] tiers))',
 'function getSubmission(uint256 id) view returns ((uint256 bountyId,address hunter,uint8 status,uint8 outcome,uint8 claimed,uint8 awarded,bool extended,bytes32 commitHash,bytes32 reportHash,uint64 committedAt,uint64 revealedAt,uint64 deadline,uint64 revealDeadline,uint64 seedBlock,uint32 applicants,uint32 commits,uint32 reveals,uint32 aligned,uint256 duplicateOf,uint256 tapStake,bytes32 hunterLock))',
 'function getReviewer(uint256 id,address who) view returns ((uint8 state,bool committed,bool revealed,bool aligned,uint8 verdict,bytes32 lockId,bytes32 voteHash,uint256 tap))',
 'function locks(bytes32) view returns (address wallet,uint8 role,uint256 submissionId,uint256 tap)',
 'function tapResult(bytes32 lockId) view returns (bool final_,uint256 returned,uint256 reward,uint256 burned)',
 'function submissionsOf(uint256 bountyId) view returns (uint256[])','function hunterSubmissions(address hunter) view returns (uint256[])','function reviewerSubmissions(address who) view returns (uint256[])','function applicantsOf(uint256 id) view returns (address[])','function panelOf(uint256 id) view returns (address[])',
 'function closesAt(uint256 id) view returns (uint256)','function isOpen(uint256 id) view returns (bool)','function freeSlots(uint256 id) view returns (uint256)','function quorum(uint256 panelSize) pure returns (uint256)','function minTapStake(uint256 lowestTier) pure returns (uint256)',
 'function hunterActive(uint256,address) view returns (uint256)','function hunterInBounty(uint256,address) view returns (bool)','function hunterActiveTotal(address) view returns (uint256)','function reviewerActive(address) view returns (uint256)','function strikes(address) view returns (uint256)','function cooldownUntil(address) view returns (uint256)','function rewardOf(address) view returns (uint256)','function commitUsed(uint256,bytes32) view returns (bool)',
 'function commitHashFor(uint256 bountyId,address hunter,uint8 severity,bytes32 reportHash,bytes32 salt) view returns (bytes32)','function voteHashFor(uint256 submissionId,address reviewer,uint8 verdict,uint256 duplicateOf,bytes32 salt) view returns (bytes32)',
 'function createBounty(bytes32 scopeHash,uint256[] tiers,uint256 endsAt,uint256 panelSize,uint256 tapStake,uint256 deposit) returns (uint256)','function topUp(uint256 id,uint256 amount)','function extend(uint256 id,uint256 newEndsAt)','function requestCancel(uint256 id)','function withdraw(uint256 id)',
 'function commit(uint256 bountyId,bytes32 commitHash,uint256 tapStake,bytes32 lockId,uint256 deadline,bytes signature) returns (uint256)','function reveal(uint256 submissionId,uint8 severity,bytes32 reportHash,bytes32 salt)','function expireCommit(uint256 submissionId)',
 'function applyToReview(uint256 submissionId,uint256 tapStake,bytes32 lockId,uint256 deadline,bytes signature)','function startSelection(uint256 submissionId)','function selectPanel(uint256 submissionId)',
 'function commitVote(uint256 submissionId,bytes32 voteHash)','function revealVote(uint256 submissionId,uint8 verdict,uint256 duplicateOf,bytes32 salt)','function finalizeJudgment(uint256 submissionId)','function claimReward()'
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
const iso=(sec:number|bigint)=>new Date(Number(sec)*1000).toISOString();

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
/** Least TAP a bounty with this lowest tier may demand per report: 1% of the tier at 10 TAP per NIB, never below 500 TAP. Mirrors the contract. */
export function minTapStake(lowestTier:bigint){const t=lowestTier/(10n**19n);return t<MIN_TAP_STAKE?MIN_TAP_STAKE:t;}
/** Votes needed for a verdict to count: two thirds of the panel, rounded up. Mirrors the contract. */
export const quorum=(panel:number)=>Math.floor((2*panel+2)/3);
/** A bounty's lifecycle label for the UI. */
export function bountyPhase(b:{closed:boolean;endsAt:number;closesAt:number;cancelRequestedAt:number},nowSec:number){
 if(b.closed)return 'withdrawn';if(nowSec>=b.closesAt)return 'ended';if(b.cancelRequestedAt>0)return 'closing';return 'open';
}
/** What happens to NIB on a valid report of a given tier payout. Pure; mirrors the contract's integer math. */
export function splitPayout(pay:bigint,feeBps:number,reviewerBps:number,aligned:number){
 const fee=pay*BigInt(feeBps)/10000n,pool=pay*BigInt(reviewerBps)/10000n,per=aligned>0?pool/BigInt(aligned):0n,reviewers=per*BigInt(aligned);
 return {fee,reviewers,perReviewer:per,hunter:pay-fee-reviewers};
}
/** The next permissionless step for a submission (anyone may take it), for the UI and the connector. */
export function nextStep(s:{status:number;deadline:number;revealDeadline:number;seedBlock:number;reveals:number;commits:number},panelSize:number,nowSec:number,block?:number):{step:string|null;at:number|null}{
 if(s.status===1)return nowSec>s.deadline?{step:'expire',at:null}:{step:'reveal',at:s.deadline};
 if(s.status===2){if(s.seedBlock>0){if(block!==undefined&&block>s.seedBlock+200)return {step:'start-selection',at:null};return {step:'select',at:null};}return nowSec>s.deadline?{step:'start-selection',at:null}:{step:'apply',at:s.deadline};}
 if(s.status===3){if(s.reveals===panelSize||nowSec>s.revealDeadline)return {step:'finalize',at:null};return nowSec<=s.deadline&&s.commits<panelSize?{step:'vote',at:s.deadline}:{step:'open-vote',at:s.revealDeadline};}
 return {step:null,at:null};
}
/** Terms a project must accept before the preview is built (mirrors the contract so errors are friendly; the contract still enforces). */
export function createTerms(p:any,params:{minDeposit:bigint;minLowestTier:bigint},nowSec:number){
 const tiers:bigint[]=Array.isArray(p?.tiers)?p.tiers.map((t:any,i:number)=>nibAmount(t,`tier ${i+1}`)):fail(400,'Give 1 to 4 payout tiers, lowest first, for example ["10000","25000","50000","100000"].');
 if(tiers.length<1||tiers.length>4)fail(400,'Give 1 to 4 payout tiers.');
 for(let i=1;i<tiers.length;i++)if(tiers[i]<=tiers[i-1])fail(400,'Payout tiers must be strictly increasing, lowest first.');
 if(tiers[0]<params.minLowestTier)fail(400,`The lowest tier must pay at least ${nibText(params.minLowestTier)} NIB (the minimum bounty size).`);
 const top=tiers[tiers.length-1],deposit=nibAmount(p?.deposit,'deposit');
 if(deposit<params.minDeposit)fail(400,`The escrow must be at least ${nibText(params.minDeposit)} NIB.`);
 if(deposit<top)fail(400,'The escrow must cover at least one payout of the top tier.');
 const days=Number(p?.days);if(!Number.isFinite(days)||days<14||days>365)fail(400,'The bounty must run for 14 to 365 days.');
 const panel=Number(p?.panelSize??3);if(!Number.isInteger(panel)||panel<3||panel>9||panel%2===0)fail(400,'The review panel must have 3, 5, 7 or 9 AI agents.');
 const floor=minTapStake(tiers[0]);let tapStake=floor;
 if(p?.tapStake!==undefined&&p.tapStake!==null&&p.tapStake!==''){
  if(!/^\d{1,12}$/.test(String(p.tapStake)))fail(400,'tapStake must be a whole number of TAP points.');tapStake=BigInt(String(p.tapStake));
 }
 if(tapStake<floor||tapStake>floor*10n)fail(400,`The TAP stake per report must be between ${floor} and ${floor*10n} TAP for this bounty size (it scales with the lowest tier).`);
 const text=typeof p?.scope==='string'?p.scope:fail(400,'Describe the scope: what is in scope, what is not, and how to report.');
 if(text.trim().length<40)fail(400,'The scope text is too short to be a fair rule set (at least 40 characters).');
 if(byteLength(text)>MAX_SCOPE_BYTES)fail(400,'The scope text is too large (16 KB maximum).');
 return {tiers,deposit,tapStake,panelSize:BigInt(panel),endsAt:BigInt(nowSec+Math.round(days*86400)),scope:text,scopeHash:scopeHash(text),days};
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
 const [signer,guardian,feeRecipient,feeBps,reviewerBps,minDeposit,minLowestTier,nib]=await Promise.all(['ticketSigner','guardian','feeRecipient','feeBps','reviewerBps','minDeposit','minLowestTier','nib'].map(fn=>rd(c,a,fn)));
 return {signer:lc(signer),guardian:lc(guardian),feeRecipient:lc(feeRecipient),feeBps:Number(feeBps),reviewerBps:Number(reviewerBps),minDeposit:minDeposit as bigint,minLowestTier:minLowestTier as bigint,nib:lc(nib)};
}
const bountyView=(id:bigint,b:any,closesAt:bigint,freeSlots:bigint,nowSec:number)=>{
 const tiers=(b.tiers as bigint[]).slice(0,b.tierCount).map((t,i)=>({severity:i+1,label:tierLabel(b.tierCount,i+1),nib:nibText(t),raw:t.toString()}));
 const cl=Number(closesAt);
 return {id:id.toString(),creator:lc(b.creator),createdAt:Number(b.createdAt),endsAt:Number(b.endsAt),closesAt:cl,cancelRequestedAt:Number(b.cancelRequestedAt),phase:bountyPhase({closed:b.closed,endsAt:Number(b.endsAt),closesAt:cl,cancelRequestedAt:Number(b.cancelRequestedAt)},nowSec),
  panelSize:b.panelSize,quorum:quorum(b.panelSize),pending:Number(b.pending),submissions:Number(b.submissionCount),closed:b.closed,tapStake:b.tapStake.toString(),available:nibText(b.available),reserved:nibText(b.reserved),scopeHash:b.scopeHash,tiers,freeSlots:Number(freeSlots)};
};
const submissionView=(id:bigint,s:any,tierCount:number|undefined,panelSize:number,nowSec:number)=>({id:id.toString(),bountyId:s.bountyId.toString(),hunter:lc(s.hunter),status:STATUS[s.status]||'Unknown',outcome:OUTCOMES[s.outcome]||'none',claimed:s.claimed||null,claimedLabel:s.claimed&&tierCount?tierLabel(tierCount,s.claimed):null,awarded:s.awarded||null,awardedLabel:s.awarded&&tierCount?tierLabel(tierCount,s.awarded):null,
 commitHash:s.commitHash,reportHash:s.status>=2?s.reportHash:null,committedAt:Number(s.committedAt),revealedAt:Number(s.revealedAt)||null,deadline:Number(s.deadline),revealDeadline:Number(s.revealDeadline)||null,applicants:Number(s.applicants),votesSealed:Number(s.commits),votesOpened:Number(s.reveals),alignedReviewers:Number(s.aligned),
 duplicateOf:s.duplicateOf>0n?s.duplicateOf.toString():null,tapStake:s.tapStake.toString(),next:nextStep({status:s.status,deadline:Number(s.deadline),revealDeadline:Number(s.revealDeadline),seedBlock:Number(s.seedBlock),reveals:Number(s.reveals),commits:Number(s.commits)},panelSize,nowSec)});

/* ---------- TAP point stakes: lock ledger, signed tickets, settlement from the chain ---------- */
const q=(e:BugBountyEnv,sql:string,...args:any[])=>e.DB.prepare(sql).bind(...args);
const first=(e:BugBountyEnv,sql:string,...args:any[])=>q(e,sql,...args).first<any>();
const allRows=async(e:BugBountyEnv,sql:string,...args:any[])=>(await q(e,sql,...args).all<any>()).results as any[];
const signerAccount=(e:BugBountyEnv)=>{const k=e.BUG_BOUNTY_SIGNER_PRIVATE_KEY;if(!k||!/^0x[0-9a-fA-F]{64}$/.test(k.trim()))return fail(503,'The Bug Bounty ticket signer is not configured. No TAP was deducted.');return privateKeyToAccount(k.trim() as `0x${string}`);};
const ticketAbi=[{type:'string'},{type:'uint256'},{type:'address'},{type:'uint8'},{type:'address'},{type:'uint256'},{type:'uint256'},{type:'bytes32'},{type:'uint256'}] as const;
/** Exactly what the contract's `ticketDigest` hashes; the signature is EIP-191 over this digest. */
export const ticketDigest=(contract:string,kind:1|2,wallet:string,scopeId:bigint,tap:bigint,lockId:string,deadline:bigint)=>keccak256(encodeAbiParameters(ticketAbi as any,['TAPTAP_BUG_BOUNTY_TICKET_V1',56n,contract as any,kind,wallet as any,scopeId,tap,lockId as any,deadline]));
const signTicket=async(e:BugBountyEnv,contract:string,kind:1|2,wallet:string,scopeId:bigint,tap:bigint,lockId:string,deadline:number)=>
 signerAccount(e).signMessage({message:{raw:ticketDigest(contract,kind,wallet,scopeId,tap,lockId,BigInt(deadline)) as `0x${string}`}});
const ticketView=(contract:string,kind:1|2,row:any,signature:string)=>({kind,lockId:row.lock_id,tap:row.amount,deadline:Number(row.deadline),expiresAt:Number(row.deadline)*1000,signature,scopeId:row.scope_id});
/** Locks TAP (an atomic points deduction + lock row) and returns the signed ticket. A live, still unused ticket for the same scope is re-signed instead of locking twice. */
async function issueTicket(e:BugBountyEnv,c:any,address:`0x${string}`,a:any,kind:1|2,scopeId:bigint,tap:bigint,now:number){
 const w=lc(a.wallet);
 if(lc(signerAccount(e).address)!==lc(await rd(c,address,'ticketSigner')))fail(503,'The configured ticket signer does not match the contract. No TAP was deducted.');
 const nowSec=Math.floor(now/1000);
 const live=await first(e,"SELECT * FROM bounty_tap_locks WHERE wallet=? AND kind=? AND scope_id=? AND status='open' AND deadline>? ORDER BY created_at DESC LIMIT 1",w,kind===1?'hunter':'reviewer',scopeId.toString(),nowSec+30);
 if(live&&BigInt(live.amount)>=tap&&(await rd(c,address,'locks',[live.lock_id]))[1]===0){return ticketView(address,kind,live,await signTicket(e,address,kind,w,scopeId,BigInt(live.amount),live.lock_id,Number(live.deadline)));}
 const open=await first(e,"SELECT COUNT(*) AS n FROM bounty_tap_locks WHERE wallet=? AND status='open'",w);if((open?.n||0)>=MAX_OPEN_LOCKS)fail(429,`You already have ${MAX_OPEN_LOCKS} TAP stakes in flight. Wait for them to settle (or for unused tickets to expire in 15 minutes).`);
 const day=await first(e,'SELECT COUNT(*) AS n FROM bounty_tap_locks WHERE wallet=? AND created_at>?',w,now-86400000);if((day?.n||0)>=TICKETS_PER_DAY)fail(429,'Daily limit of TAP stake tickets reached. Try again tomorrow.');
 const fresh=await first(e,'SELECT * FROM agents WHERE wallet=?',w);if(!fresh)fail(409,'Pair a verified agent first.');
 if(pointBalance(fresh)<tap)fail(409,`You need ${tap} TAP available to stake (you have ${pointBalance(fresh)}). NFT bonus TAP cannot be staked.`);
 const lockId=keccak256(toHex(crypto.getRandomValues(new Uint8Array(32)))),deadline=nowSec+TICKET_TTL_SECONDS,exact=a._gameAccess?.required===true||await exactOn(e);
 const signature=await signTicket(e,address,kind,w,scopeId,tap,lockId,deadline);
 try{
  await applyPoints(e,fresh,exact,-tap,'bounty-stake',`${kind===1?'Bug bounty report stake':'Bug bounty review stake'} · ${tap} TAP locked (${kind===1?'bounty':'submission'} #${scopeId})`,[(event:string)=>q(e,'INSERT INTO bounty_tap_locks(lock_id,wallet,kind,scope_id,amount,deadline,status,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)',lockId,w,kind===1?'hunter':'reviewer',scopeId.toString(),tap.toString(),deadline,'open',now,w,event)],now);
 }catch(err:any){if(err instanceof BugBountyError)throw err;if(err?.status)fail(err.status,err.message);throw err;}
 const row=await first(e,'SELECT * FROM bounty_tap_locks WHERE lock_id=?',lockId);if(!row)return fail(409,'Your agent changed during this request. Nothing was locked; refresh and retry.');
 return ticketView(address,kind,row,signature);
}
/** Settles every open lock of a wallet (or a bounded global sweep) from what the contract says. Idempotent: each lock settles once. */
export async function reconcileTap(e:BugBountyEnv,now:number,wallet?:string){
 const addr=bountyAddress(e);if(!addr)return 0;const c=client(e);
 let chainTime:number;try{chainTime=Number((await c.getBlock()).timestamp);}catch{return 0;}
 const rowsOpen=wallet?await allRows(e,"SELECT * FROM bounty_tap_locks WHERE wallet=? AND status='open' ORDER BY created_at ASC LIMIT 50",lc(wallet)):await allRows(e,"SELECT * FROM bounty_tap_locks WHERE status='open' ORDER BY created_at ASC LIMIT 20");
 let n=0;
 for(const row of rowsOpen){
  try{
   const l=await rd(c,addr,'locks',[row.lock_id]);let res:{status:string;returned:bigint;reward:bigint;burned:bigint}|null=null;
   if(l[1]===0){if(chainTime>Number(row.deadline)+RELEASE_MARGIN_SECONDS)res={status:'unused',returned:BigInt(row.amount),reward:0n,burned:0n};}
   else{const r=await rd(c,addr,'tapResult',[row.lock_id]);if(r[0])res={status:'settled',returned:r[1],reward:r[2],burned:r[3]};}
   if(!res)continue;
   await settleLock(e,row,res,now);n++;
  }catch(err){if(err instanceof BugBountyError&&err.status===503)continue;if((err as any)?.status===409)continue;throw err;}
 }
 return n;
}
async function settleLock(e:BugBountyEnv,row:any,res:{status:string;returned:bigint;reward:bigint;burned:bigint},now:number){
 const credit=res.returned+res.reward;
 const mark=(event?:string)=>q(e,"UPDATE bounty_tap_locks SET status=?,returned=?,reward=?,burned=?,settled_at=? WHERE lock_id=? AND status='open'"+(event?' AND EXISTS(SELECT 1 FROM agents WHERE wallet=? AND last_event=?)':''),...[res.status,res.returned.toString(),res.reward.toString(),res.burned.toString(),now,row.lock_id,...(event?[row.wallet,event]:[])]);
 if(credit===0n){await mark().run();return;}
 for(let attempt=0;attempt<3;attempt++){
  const a=await first(e,'SELECT * FROM agents WHERE wallet=?',row.wallet);
  if(!a){await mark().run();return;}
  try{
   const text=res.status==='unused'?'Bug bounty stake returned (ticket expired unused)':res.burned>0n?`Bug bounty stake settled · ${res.returned} returned, ${res.burned} burned`:res.reward>0n?`Bug bounty review settled · ${res.returned} returned + ${res.reward} reward`:'Bug bounty stake returned';
   await applyPoints(e,a,await exactOn(e),credit,'bounty-settle',text,[(event:string)=>mark(event)],now,{sql:"EXISTS(SELECT 1 FROM bounty_tap_locks WHERE lock_id=? AND status='open')",args:[row.lock_id]});
   return;
  }catch(err:any){if(attempt===2||err?.status!==409)throw err;}
 }
}
const lockView=(r:any)=>({lockId:r.lock_id,role:r.kind,scopeId:r.scope_id,tap:r.amount,status:r.status,returned:r.returned,reward:r.reward,burned:r.burned,deadline:Number(r.deadline),createdAt:Number(r.created_at),settledAt:r.settled_at?Number(r.settled_at):null});

/** Public snapshot. When the contract address is not configured this is just {enabled:false}: no RPC, no hint of what is coming. */
export async function bugBountyState(e:BugBountyEnv,wallet:string|null,now:number){
 if(!bountyEnabled(e))return {enabled:false};
 const {address,c}=await requireContract(e).catch((err:any)=>{if(err instanceof BugBountyError&&err.status===404)throw err;return {address:null as any,c:null as any,error:err};}) as any;
 if(!address)return {enabled:true,live:false,message:'Bug Bounty is configured but the contract cannot be read right now.',bounties:[]};
 const nowSec=Math.floor(now/1000);
 try{
  const [p,nonce,escrow,owed,paid,fees,revPaid,ps,psAt]=await Promise.all([params(c,address),...['bountyNonce','totalEscrow','totalOwed','totalPaid','totalFees','totalReviewerPaid','pendingSigner','pendingSignerAt'].map(fn=>rd(c,address,fn))]);
  const first_=nonce>BigInt(MAX_LIST)?nonce-BigInt(MAX_LIST)+1n:1n,ids:bigint[]=[];for(let i=nonce;i>=first_&&i>0n;i--)ids.push(i);
  const raw=ids.length?await many(c,address,ids.flatMap(id=>[{functionName:'getBounty',args:[id]},{functionName:'closesAt',args:[id]},{functionName:'freeSlots',args:[id]}])):[];
  const scopes=ids.length?await e.DB.prepare(`SELECT bounty_id,text FROM bounty_scopes WHERE bounty_id IN (${ids.map(()=> '?').join(',')})`).bind(...ids.map(i=>i.toString())).all<any>():{results:[]};
  const text=new Map<string,string>(scopes.results.map((r:any)=>[String(r.bounty_id),r.text]));
  const bounties=ids.map((id,i)=>{const b=raw[i*3],v:any=bountyView(id,b,raw[i*3+1],raw[i*3+2],nowSec),t=text.get(id.toString());
   // The scope text is only shown when it matches the hash the project committed on-chain.
   return {...v,scope:t&&scopeHash(t)===b.scopeHash?{text:t,verified:true}:{text:null,verified:false}};});
  const out:any={enabled:true,live:true,chainId:56,contract:address,token:tokenAddress(e),params:{ticketSigner:p.signer,guardian:p.guardian,feeBps:p.feeBps,reviewerBps:p.reviewerBps,feeRecipient:p.feeRecipient,minDeposit:nibText(p.minDeposit),minLowestTier:nibText(p.minLowestTier),
   tapStakeRule:'1% of the lowest tier at 10 TAP per NIB, at least 500 TAP, up to 10x that (set by the project). TAP only, never NIB.',panelSizes:[3,5,7,9],minDurationDays:14,maxDurationDays:365,revealWindowHours:24,applyWindowHours:48,voteWindowHours:72,voteRevealWindowHours:48,cancelCooldownDays:7,
   maxOpenSubmissionsPerBounty:20,maxActivePerHunterPerBounty:3,maxActivePerHunter:5,maxActiveReviewsPerAgent:5,
   signerChange:ps!==ZERO?{proposed:lc(ps),effectiveAt:Number(psAt)}:null},
   totals:{escrow:nibText(escrow),owedToReviewers:nibText(owed),paidToHunters:nibText(paid),fees:nibText(fees),paidToReviewers:nibText(revPaid),bounties:Number(nonce)},bounties,reportsEnabled:/^[0-9a-fA-F]{64}$/.test(e.BUG_BOUNTY_REPORT_KEY||''),ticketsEnabled:/^0x[0-9a-fA-F]{64}$/.test((e.BUG_BOUNTY_SIGNER_PRIVATE_KEY||'').trim())};
  if(wallet){
   const w=wallet as `0x${string}`;await reconcileTap(e,now,wallet).catch(()=>{});
   const [hIds,rIds,reward,strikes,cool]=await Promise.all([rd(c,address,'hunterSubmissions',[w]),rd(c,address,'reviewerSubmissions',[w]),rd(c,address,'rewardOf',[w]),rd(c,address,'strikes',[w]),rd(c,address,'cooldownUntil',[w])]);
   const mineIds=(hIds as bigint[]).slice(-MAX_LIST).reverse(),revIds=(rIds as bigint[]).slice(-MAX_LIST).reverse();
   const [hs,rs,rv]=await Promise.all([mineIds.length?many(c,address,mineIds.map(id=>({functionName:'getSubmission',args:[id]}))):[],revIds.length?many(c,address,revIds.map(id=>({functionName:'getSubmission',args:[id]}))):[],revIds.length?many(c,address,revIds.map(id=>({functionName:'getReviewer',args:[id,w]}))):[]]);
   const panelOf=async(bid:bigint)=>{const b=bounties.find(x=>x.id===bid.toString());if(b)return b;const raw=await rd(c,address,'getBounty',[bid]);return {id:bid.toString(),panelSize:raw.panelSize,tiers:(raw.tiers as bigint[]).slice(0,raw.tierCount)};};
   const view=async(id:bigint,s:any)=>{const b:any=await panelOf(s.bountyId);return submissionView(id,s,b.tiers.length,b.panelSize,nowSec);};
   const locks=(await allRows(e,'SELECT * FROM bounty_tap_locks WHERE wallet=? ORDER BY created_at DESC LIMIT 30',lc(wallet))).map(lockView);
   const fresh=await first(e,'SELECT * FROM agents WHERE wallet=?',lc(wallet));
   out.you={wallet:lc(wallet),tap:{available:fresh?pointBalance(fresh).toString():'0',locked:locks.filter((l:any)=>l.status==='open').reduce((s:bigint,l:any)=>s+BigInt(l.tap),0n).toString(),locks},
    reputation:{strikes:Number(strikes),cooldownUntil:Number(cool)>nowSec?Number(cool):null},rewardNib:nibText(reward),
    myBounties:bounties.filter(b=>b.creator===lc(wallet)).map(b=>b.id),
    mySubmissions:await Promise.all(mineIds.map((id,i)=>view(id,hs[i]))),
    myReviews:await Promise.all(revIds.map(async(id,i)=>({...await view(id,rs[i]),reviewer:{state:REVIEWER_STATES[rv[i].state],sealed:rv[i].committed,opened:rv[i].revealed,aligned:rv[i].state===2&&rs[i].status===4?rv[i].aligned:null,lockId:rv[i].lockId}})))};
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
 const nowSec=Math.floor(now/1000);
 return {bountyId:bid.toString(),creator:lc(b.creator),panelSize:b.panelSize,submissions:ids.map((i,k)=>submissionView(i,subs[k],b.tierCount,b.panelSize,nowSec))};
}

/* ---------- signed agent actions: baw previews, never sent from here ---------- */
const tx=(from:string,to:string,abi:any,functionName:string,args:any[],value=0n)=>({chainId:56,from,to,value:value.toString(),data:encodeFunctionData({abi,functionName,args} as any)});
const baw=(t:{from:string;to:string;value:string;data:string})=>`baw contract-call preview --binanceChainId 56 --from ${t.from} --to ${t.to} --value ${t.value} --inputData ${t.data} --json`;
const PREVIEW_NOTE='Run the baw preview, show the user the parsed call, gas and risks, and execute only after explicit approval. Previews expire in about 5 minutes. Never re-execute an uncertain transaction: check the hash first.';
const id256=(v:any,label='id')=>{try{const n=BigInt(String(v??''));if(n<=0n||n>=2n**64n)throw 0;return n;}catch{return fail(400,`Give a numeric ${label}.`);}};
const sev=(v:any,max=4)=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>max)fail(400,`severity must be a whole number from 1 to ${max}.`);return n;};
const hex32=(v:any,label:string)=>typeof v==='string'&&/^0x[0-9a-fA-F]{64}$/.test(v)?v as `0x${string}`:fail(400,`${label} must be a 32-byte hex value.`);
export const BOUNTY_FUNCTIONS=['create','topup','extend','cancel','withdraw','commit','reveal','expire','apply','start-selection','select','vote','open-vote','finalize','claim'] as const;
/** Builds one previewable step, or two when an exact-amount NIB approval is needed first. `commit` and `apply` also lock the TAP stake and return the signed ticket. */
export async function bountyTxAction(e:BugBountyEnv,a:any,payload:any,now:number){
 const {address,c}=await requireContract(e);await requireGameAccess(e,a);
 const fn=String(payload?.fn||'');if(!(BOUNTY_FUNCTIONS as readonly string[]).includes(fn))fail(400,'Unknown bounty step. Use one of: '+BOUNTY_FUNCTIONS.join(', ')+'.');
 const wallet=a.wallet as `0x${string}`,w=lc(wallet),nowSec=Math.floor(now/1000),token=tokenAddress(e);
 const p=await params(c,address);
 await reconcileTap(e,now,w).catch(()=>{});
 let need=0n,call:{name:string;args:any[]},summary:any={},warnings:string[]=[];
 const bountyOf=async(id:bigint)=>{const b=await rd(c,address,'getBounty',[id]);if(b.creator===ZERO)fail(404,'That bounty does not exist.');return b;};
 const subOf=async(id:bigint)=>{const s=await rd(c,address,'getSubmission',[id]);if(s.hunter===ZERO)fail(404,'That submission does not exist.');return s;};
 const creatorOnly=(b:any)=>{if(lc(b.creator)!==w)fail(403,'Only the project that created this bounty can do that.');};
 const stateIs=(s:any,want:number[],msg:string)=>{if(!want.includes(s.status))fail(409,msg+' (it is '+STATUS[s.status]+').');};
 const roleHolder=()=>{if(w===p.guardian||w===p.signer)fail(403,'The guardian and the ticket signer cannot take part in bounties.');};
 const cooldown=async()=>{const cd=Number(await rd(c,address,'cooldownUntil',[wallet]));if(nowSec<cd)fail(409,'You are cooling down after a penalty until '+iso(cd)+'.');};
 const tapNeed=(have:bigint,need:bigint)=>{if(have<need)fail(409,`You need ${need} TAP available to stake.`);};
 if(fn==='create'){
  const t=createTerms(payload,p,nowSec);roleHolder();
  need=t.deposit;call={name:'createBounty',args:[t.scopeHash,t.tiers,t.endsAt,t.panelSize,t.tapStake,t.deposit]};
  summary={fn,escrowedNib:nibText(t.deposit),tiers:t.tiers.map((x:bigint,i:number)=>({label:tierLabel(t.tiers.length,i+1),nib:nibText(x),hunterGetsNibApprox:nibText(splitPayout(x,p.feeBps,p.reviewerBps,Number(t.panelSize)).hunter)})),endsAt:iso(t.endsAt),days:t.days,panelSize:Number(t.panelSize),quorum:quorum(Number(t.panelSize)),tapStakePerReport:t.tapStake.toString(),scopeHash:t.scopeHash,
   rules:['The NIB is escrowed now and cannot be withdrawn before the end date, nor while any submission is pending, nor during the 7-day cancel cooldown.','You do not judge reports and cannot overrule the panel: a random panel of '+Number(t.panelSize)+' other TapTap AI agents does, by sealed vote. You pay only for reports the panel judges valid.',
    'On a valid report the payout is split: '+(p.feeBps/100)+'% platform fee to the vault, '+(p.reviewerBps/100)+'% shared by the reviewers who voted with the outcome, the rest to the hunter. You fund the bounty in NIB only; hunters and reviewers stake TAP points, never NIB.','Next: publish the scope text with `do bounty-scope <id> --file scope.md` once this confirms.']};
 }else if(fn==='topup'){
  const id=id256(payload.id),b=await bountyOf(id);creatorOnly(b);const amount=nibAmount(payload.amount,'amount');need=amount;call={name:'topUp',args:[id,amount]};summary={fn,bountyId:id.toString(),addNib:nibText(amount)};
 }else if(fn==='extend'){
  const id=id256(payload.id),b=await bountyOf(id);creatorOnly(b);const days=Number(payload.days);if(!Number.isFinite(days)||days<=0||days>365)fail(400,'days must be above 0 and at most 365 (from now).');
  const endsAt=BigInt(nowSec+Math.round(days*86400));if(endsAt<=b.endsAt)fail(409,'A bounty can only be extended, never shortened.');call={name:'extend',args:[id,endsAt]};summary={fn,bountyId:id.toString(),newEnd:iso(endsAt)};
 }else if(fn==='cancel'){
  const id=id256(payload.id),b=await bountyOf(id);creatorOnly(b);if(b.cancelRequestedAt>0n)fail(409,'This bounty is already closing.');call={name:'requestCancel',args:[id]};
  summary={fn,bountyId:id.toString(),effect:'Starts a 7-day cancel cooldown. Hunters can still submit during it. You can withdraw the unspent escrow only after it ends and every submission is resolved.'};
 }else if(fn==='withdraw'){
  const id=id256(payload.id),b=await bountyOf(id);creatorOnly(b);if(b.closed)fail(409,'Already withdrawn.');const cl=await rd(c,address,'closesAt',[id]);
  if(BigInt(nowSec)<cl)fail(409,'The bounty is still open until '+iso(cl)+'. Escrow cannot be withdrawn before then.');if(b.pending>0)fail(409,'Submissions are still pending. Escrow stays locked until every one is resolved.');
  call={name:'withdraw',args:[id]};summary={fn,bountyId:id.toString(),refundNib:nibText(b.available)};
 }else if(fn==='commit'){
  const id=id256(payload.bountyId,'bounty id'),b=await bountyOf(id),ch=hex32(payload.commitHash,'commitHash');roleHolder();
  if(lc(b.creator)===w)fail(403,'A project cannot submit to its own bounty.');
  if(!await rd(c,address,'isOpen',[id]))fail(409,'This bounty is not open for new submissions.');if(await rd(c,address,'freeSlots',[id])===0n||b.pending>=20)fail(409,'This bounty has no free submission slots right now (escrow is fully reserved or the open-submission limit is reached).');
  if(await rd(c,address,'commitUsed',[id,ch]))fail(409,'That commit hash was already used on this bounty.');
  if(await rd(c,address,'hunterActive',[id,wallet])>=3n)fail(409,'You already have 3 open submissions on this bounty.');if(await rd(c,address,'hunterActiveTotal',[wallet])>=5n)fail(409,'You already have 5 open submissions overall.');await cooldown();
  const stake=payload.stake===undefined||payload.stake===null||payload.stake===''?b.tapStake:BigInt(String(payload.stake).match(/^\d{1,12}$/)?payload.stake:fail(400,'stake must be a whole number of TAP points.'));if(stake<b.tapStake)fail(400,`This bounty requires at least ${b.tapStake} TAP staked per report.`);
  const ticket=await issueTicket(e,c,address,a,1,id,stake,now);
  call={name:'commit',args:[id,ch,stake,ticket.lockId,BigInt(ticket.deadline),ticket.signature]};
  summary={fn,bountyId:id.toString(),tapStakeLocked:stake.toString(),ticket:{lockId:ticket.lockId,expiresAt:iso(ticket.deadline)},stakeNote:'Your TAP points are locked now (not NIB). They come back when your report is judged valid, or is a good-faith duplicate, or the panel fails to reach a verdict. They are forfeited (burned, and shared with the reviewers who judged it invalid) if the panel judges the report invalid, or you do not reveal within 24 hours. If you do not send the transaction within 15 minutes the TAP is returned automatically.',
   mustRevealWithin:'24 hours after this confirms, or the TAP stake is forfeited.'};
  warnings.push('Do not lose the salt and report file the connector saved locally: they are needed to reveal. Reveal inside the 24-hour window.');
 }else if(fn==='reveal'){
  const id=id256(payload.id,'submission id'),s=await subOf(id);if(lc(s.hunter)!==w)fail(403,'Only the hunter who committed can reveal.');stateIs(s,[1],'Only a committed submission can be revealed');
  const sv=sev(payload.severity),rh=hex32(payload.reportHash,'reportHash'),salt=hex32(payload.salt,'salt');
  const expected=await rd(c,address,'commitHashFor',[s.bountyId,wallet,sv,rh,salt]);if(lc(expected)!==lc(s.commitHash))fail(409,'That severity, report hash and salt do not match what you committed. Nothing was prepared.');
  call={name:'reveal',args:[id,sv,rh,salt]};summary={fn,submissionId:id.toString(),severity:sv,reportHash:rh,effect:'Opens 48 hours for other TapTap agents to apply to review your report. Store the report text first (`do bounty-report-put`): the seated panel can read it.'};
 }else if(fn==='expire'){
  const id=id256(payload.id,'submission id'),s=await subOf(id);stateIs(s,[1],'Only a committed submission can expire');if(nowSec<=Number(s.deadline))fail(409,'The reveal window is still open until '+iso(s.deadline)+'.');
  call={name:'expireCommit',args:[id]};summary={fn,submissionId:id.toString(),effect:'Closes a commit that was never revealed. The hunter\'s TAP stake is forfeited and the escrow reservation is released.'};
 }else if(fn==='apply'){
  const id=id256(payload.submissionId??payload.id,'submission id'),s=await subOf(id),b=await bountyOf(s.bountyId);roleHolder();
  stateIs(s,[2],'Only a revealed submission can be reviewed');if(Number(s.seedBlock)>0||nowSec>Number(s.deadline))fail(409,'Applications closed '+iso(s.deadline)+'.');
  if(lc(b.creator)===w||lc(s.hunter)===w)fail(403,'You cannot review a report you wrote or a bounty you created.');
  if(await rd(c,address,'hunterInBounty',[s.bountyId,wallet]))fail(403,'Hunters of this bounty cannot review its reports.');
  if((await rd(c,address,'getReviewer',[id,wallet])).state!==0)fail(409,'You already applied to review this report.');
  if(await rd(c,address,'reviewerActive',[wallet])>=5n)fail(409,'You already have 5 open reviews.');await cooldown();
  if(Number(s.applicants)>=40)fail(409,'The applicant list is full.');
  const stake=payload.stake===undefined||payload.stake===null||payload.stake===''?b.tapStake:BigInt(String(payload.stake).match(/^\d{1,12}$/)?payload.stake:fail(400,'stake must be a whole number of TAP points.'));if(stake<b.tapStake)fail(400,`This bounty requires at least ${b.tapStake} TAP staked per review.`);
  const ticket=await issueTicket(e,c,address,a,2,id,stake,now);
  call={name:'applyToReview',args:[id,stake,ticket.lockId,BigInt(ticket.deadline),ticket.signature]};
  summary={fn,submissionId:id.toString(),bountyId:s.bountyId.toString(),tapStakeLocked:stake.toString(),ticket:{lockId:ticket.lockId,expiresAt:iso(ticket.deadline)},claimedSeverity:s.claimed,panel:b.panelSize,
   stakeNote:'Your TAP is locked now. Not drawn: returned in full. Drawn and you vote with the final outcome: returned (plus a share of the NIB reviewer pool on a valid report, or of the forfeited hunter stake on an invalid one). Drawn and you vote against the outcome, or never open your vote: your TAP is burned and you get a strike with a cooldown.'};
  warnings.push('If you are drawn you must seal a vote within 72 hours and open it within the next 48 hours. Reports are only readable once you are drawn onto the panel.');
 }else if(fn==='start-selection'||fn==='select'){
  const id=id256(payload.submissionId??payload.id,'submission id'),s=await subOf(id);stateIs(s,[2],'Only a submission collecting reviewer applications can be drawn');
  if(fn==='start-selection'){if(nowSec<=Number(s.deadline))fail(409,'Applications are open until '+iso(s.deadline)+'.');call={name:'startSelection',args:[id]};summary={fn,submissionId:id.toString(),applicants:Number(s.applicants),effect:'Fixes the block whose hash will seed the random draw. Then call `select` a block or two later (within 200 blocks).'};}
  else{if(Number(s.seedBlock)===0)fail(409,'Start the selection first.');const blk=Number(await c.getBlockNumber());if(blk<=Number(s.seedBlock))fail(409,'Wait for the seed block to be mined, then try again.');if(blk>Number(s.seedBlock)+200)fail(409,'The seed block is too old: start the selection again.');call={name:'selectPanel',args:[id]};summary={fn,submissionId:id.toString(),effect:'Draws the panel at random from the applicants using the seed block hash. Anyone may call it.'};}
 }else if(fn==='vote'){
  const id=id256(payload.submissionId??payload.id,'submission id'),s=await subOf(id);stateIs(s,[3],'Only a submission under judgment can be voted on');const vh=hex32(payload.voteHash,'voteHash');
  const r=await rd(c,address,'getReviewer',[id,wallet]);if(r.state!==2)fail(403,'You are not on the panel for this report.');if(r.committed)fail(409,'You already sealed your vote.');if(nowSec>Number(s.deadline))fail(409,'Voting closed '+iso(s.deadline)+'.');
  call={name:'commitVote',args:[id,vh]};summary={fn,submissionId:id.toString(),effect:'Seals your vote on-chain (nobody can see it). You open it in the reveal window after voting ends, or after every panelist has sealed.',opensBy:iso(s.revealDeadline)};
 }else if(fn==='open-vote'){
  const id=id256(payload.submissionId??payload.id,'submission id'),s=await subOf(id);stateIs(s,[3],'Only a submission under judgment can have votes opened');
  const r=await rd(c,address,'getReviewer',[id,wallet]);if(r.state!==2||!r.committed)fail(403,'You have no sealed vote on this report.');if(r.revealed)fail(409,'You already opened your vote.');
  const pb=await bountyOf(s.bountyId);if(nowSec<=Number(s.deadline)&&Number(s.commits)<Number(pb.panelSize))fail(409,'Votes open at '+iso(s.deadline)+' or once every panelist has sealed.');if(nowSec>Number(s.revealDeadline))fail(409,'The reveal window closed '+iso(s.revealDeadline)+'.');
  const verdict=Number(payload.verdict);if(!Number.isInteger(verdict)||verdict<0||verdict>255)fail(400,'verdict must be 0 (not valid), a severity 1..4, or 255 (duplicate).');
  const dup=verdict===VERDICT_DUPLICATE?id256(payload.duplicateOf,'duplicateOf'):0n,salt=hex32(payload.salt,'salt');
  const expected=await rd(c,address,'voteHashFor',[id,wallet,verdict,dup,salt]);if(lc(expected)!==lc(r.voteHash))fail(409,'That verdict, duplicateOf and salt do not match your sealed vote. Nothing was prepared.');
  call={name:'revealVote',args:[id,verdict,dup,salt]};summary={fn,submissionId:id.toString(),verdict,duplicateOf:dup>0n?dup.toString():null,warning:'Voting against the final outcome, or not opening your vote, burns your TAP stake.'};
 }else if(fn==='finalize'){
  const id=id256(payload.submissionId??payload.id,'submission id'),s=await subOf(id),b=await bountyOf(s.bountyId);stateIs(s,[3],'Only a submission under judgment can be finalised');
  if(Number(s.reveals)!==Number(b.panelSize)&&nowSec<=Number(s.revealDeadline))fail(409,'Votes are still open until '+iso(s.revealDeadline)+'.');
  call={name:'finalizeJudgment',args:[id]};summary={fn,submissionId:id.toString(),effect:'Counts the opened votes, pays out (or not), settles every TAP stake and slashes absent or dissenting reviewers. Anyone may call it.'};
 }else{
  const owed=await rd(c,address,'rewardOf',[wallet]);if(owed===0n)fail(409,'You have no NIB reviewer reward to claim.');
  call={name:'claimReward',args:[]};summary={fn,claimNib:nibText(owed)};
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
 return {bugBounty:{action:'report-put',submissionId:sid.toString(),stored:true,note:'Stored encrypted. Only you, the project (after you reveal on-chain) and the review panel drawn for it can read it. Reveal within 24 hours of your commit.'}};
}
/** Who may read a report: the hunter always; the project once the hunter revealed on-chain; a panelist once seated (while voting and after). Applicants who were not drawn never can. */
export async function reportGetAction(e:BugBountyEnv,a:any,payload:any,now:number){
 const {address,c}=await requireContract(e);await reportKey(e);const sid=id256(payload?.submissionId,'submission id');
 const s=await rd(c,address,'getSubmission',[sid]);if(s.hunter===ZERO)fail(404,'That submission does not exist.');
 const row=await q(e,'SELECT * FROM bounty_reports WHERE submission_id=?',sid.toString()).first<any>();
 const w=lc(a.wallet),b=await rd(c,address,'getBounty',[s.bountyId]);
 const isHunter=lc(s.hunter)===w,isCreator=lc(b.creator)===w;
 let allowed=isHunter,role=isHunter?'hunter':'';
 if(!allowed&&isCreator&&s.status>=2){allowed=true;role='creator';}
 if(!allowed&&s.status>=3){const r=await rd(c,address,'getReviewer',[sid,a.wallet]);if(r.state===2){allowed=true;role='panelist';}}
 if(!allowed)fail(403,isCreator?'The report is readable by the project only after the hunter reveals it on-chain.':'Only the hunter, the project (after reveal) and the drawn review panel can read this report.');
 if(!row)fail(404,'No report is stored for this submission.');
 if(!isHunter&&lc(row.report_hash)!==lc(s.reportHash))fail(409,'The stored report does not match the hash revealed on-chain. Treat it as invalid.');
 const body=await openReport(e,sid.toString(),row.report_hash,row);
 return {bugBounty:{action:'report-get',role,submissionId:sid.toString(),bountyId:s.bountyId.toString(),hunter:lc(s.hunter),status:STATUS[s.status],claimedSeverity:s.claimed||null,reportHash:row.report_hash,hashMatchesOnChain:lc(row.report_hash)===lc(s.reportHash),body}};
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
