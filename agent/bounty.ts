// Bug Bounty helpers for the connector: the pinned contract, call validation and the hunter's local commit/reveal records.
// Pure functions only (no network, no wallet): do.ts wires them into the `do bounty-*` commands.
import {decodeFunctionData,parseAbi,keccak256,toHex,encodeAbiParameters,parseAbiParameters} from 'viem';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';

/** NibBugBounty (deterministic CREATE2 address from scripts/nib-bug-bounty-deploy.ts `plan`). Pinned so a site can never point the connector at another contract.
 *  test/bug-bounty-chat.test.ts fails if this differs from the deploy plan: if you change the contract or its parameters, re-run `plan` and update this line. */
export const NIB_BUG_BOUNTY='0x9E2b99C67201e953d33613B53dB80442D27024fE';
export const NIB_TOKEN_PIN='0x1F11d9feAF354aD31861B4fa26759349e2860cFb';
export const MAX_REPORT_BYTES=49152,MAX_SCOPE_BYTES=16384;
/** Upper bound on any single NIB approval for the bounty contract (deposits are at least 10,000 NIB; this stops absurd amounts). */
export const MAX_BOUNTY_APPROVAL=10n**9n*10n**18n;
export const bountyCallAbi=parseAbi([
 'function createBounty(bytes32 scopeHash,uint256[] tiers,uint256 endsAt,uint256 panelSize,uint256 tapStake,uint256 deposit) returns (uint256)','function topUp(uint256 id,uint256 amount)','function extend(uint256 id,uint256 newEndsAt)','function requestCancel(uint256 id)','function withdraw(uint256 id)',
 'function commit(uint256 bountyId,bytes32 commitHash,uint256 tapStake,bytes32 lockId,uint256 deadline,bytes signature) returns (uint256)','function reveal(uint256 submissionId,uint8 severity,bytes32 reportHash,bytes32 salt)','function expireCommit(uint256 submissionId)',
 'function applyToReview(uint256 submissionId,uint256 tapStake,bytes32 lockId,uint256 deadline,bytes signature)','function startSelection(uint256 submissionId)','function selectPanel(uint256 submissionId)',
 'function commitVote(uint256 submissionId,bytes32 voteHash)','function revealVote(uint256 submissionId,uint8 verdict,uint256 duplicateOf,bytes32 salt)','function finalizeJudgment(uint256 submissionId)','function appeal(uint256 submissionId)','function resolveRejection(uint256 submissionId,uint8 severity)','function claimReward()']);
const approveAbi=parseAbi(['function approve(address,uint256) returns (bool)']);
const HEX=/^0x[0-9a-fA-F]*$/;const same=(a:any,b:any)=>String(a).toLowerCase()===String(b).toLowerCase();
export class BountyCheckError extends Error{}
const bad=(m:string):never=>{throw new BountyCheckError(m);};

/** What the connector expects a bounty transaction to be, computed from the user's own command (never from the server's answer). */
export type BountyExpect={kind:'bounty'|'bounty-approve';wallet:string;fn?:string;args?:(string|null)[];amountRaw?:bigint;/** [min,max] unix seconds for a time argument that depends on "now" */endsAtRange?:[number,number];endsAtIndex?:number};
const norm=(v:any):string=>Array.isArray(v)?'['+v.map(norm).join(',')+']':typeof v==='bigint'?v.toString():typeof v==='boolean'?String(v):String(v).toLowerCase();

export function validateBountyTx(tx:any,e:BountyExpect){
 if(!tx||tx.chainId!==56||!same(tx.from,e.wallet)||typeof tx.value!=='string'||!/^(0|[1-9][0-9]*)$/.test(tx.value)||typeof tx.data!=='string'||!HEX.test(tx.data))bad('The transaction does not match this wallet or chain. Refusing.');
 if(BigInt(tx.value)!==0n)bad('Bug Bounty calls never send BNB. Refusing.');
 if(e.kind==='bounty-approve'){
  if(!same(tx.to,NIB_TOKEN_PIN))bad('Approval must target the NIB token.');
  const d:any=decodeFunctionData({abi:approveAbi,data:tx.data as `0x${string}`});
  if(d.functionName!=='approve'||!same(d.args[0],NIB_BUG_BOUNTY))bad('Approval spender must be the Bug Bounty contract '+NIB_BUG_BOUNTY+' only.');
  const amount=BigInt(d.args[1]);if(amount<=0n||amount>MAX_BOUNTY_APPROVAL)bad('Approval must be an exact, bounded NIB amount (no unlimited approvals).');
  if(e.amountRaw===undefined||amount!==e.amountRaw)bad('Approval amount differs from the amount this action needs.');return {amount};
 }
 if(!same(tx.to,NIB_BUG_BOUNTY))bad('Bug Bounty calls must go to '+NIB_BUG_BOUNTY+'.');
 if(!e.fn||!e.args)bad('No expectation was recorded for this call. Refusing.');
 let d:any;try{d=decodeFunctionData({abi:bountyCallAbi,data:tx.data as `0x${string}`});}catch{bad('Unknown Bug Bounty function. Refusing.');}
 if(d.functionName!==e.fn)bad('Unexpected function: expected '+e.fn+', got '+d.functionName+'.');
 const args=d.args||[];if(args.length!==e.args!.length)bad('Unexpected number of arguments.');
 e.args!.forEach((want,i)=>{
  if(want===null){
   if(e.endsAtRange&&i===e.endsAtIndex){const t=Number(args[i]);if(!(t>=e.endsAtRange[0]&&t<=e.endsAtRange[1]))bad('The end time differs from what you asked for. Refusing.');}
   return;}
  if(norm(args[i])!==want.toLowerCase())bad('Argument '+(i+1)+' of '+e.fn+' differs from your request. Refusing.');
 });
 return {fn:d.functionName,args};
}

/** The commit hash the contract checks at reveal (hunter-bound, so nobody can copy someone else's commit). */
export function commitHashOf(contract:string,bountyId:bigint,hunter:string,severity:number,reportHash:string,salt:string){
 return keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,uint256,address,uint8,bytes32,bytes32'),[56n,contract as `0x${string}`,bountyId,hunter as `0x${string}`,severity,reportHash as `0x${string}`,salt as `0x${string}`]));
}
export const reportHashOf=(body:string)=>keccak256(toHex(body));
export const scopeHashOf=(text:string)=>keccak256(toHex(text));
const byteLen=(s:string)=>Buffer.byteLength(s,'utf8');

/** Hunter-side local record: the report text and the secret salt, saved BEFORE the commit is previewed, so a crash or a rerun can never lose or change them. */
export type CommitRecord={wallet:string;bountyId:string;severity:number;reportHash:string;salt:string;commitHash:string;body:string;createdAt:number;submissionId?:string};
const dirOf=(dir:string)=>path.join(dir,'bounty');
const fileFor=(dir:string,wallet:string,bountyId:string,severity:number,reportHash:string)=>path.join(dirOf(dir),[wallet.toLowerCase().slice(2,10),bountyId,severity,reportHash.slice(2,18)].join('-')+'.json');
/** Same wallet + bounty + severity + report text always reuses the same salt (the approval step and the commit step are separate runs). */
export function prepareCommit(dir:string,wallet:string,bountyId:string,severity:number,body:string):CommitRecord{
 if(!Number.isInteger(severity)||severity<1||severity>4)bad('--severity must be 1 to 4 (the tiers the project published).');
 if(!body.trim())bad('The report file is empty.');if(byteLen(body)>MAX_REPORT_BYTES)bad('The report is too large (48 KB maximum). Link to a private gist for attachments.');
 const reportHash=reportHashOf(body),file=fileFor(dir,wallet,bountyId,severity,reportHash);
 try{const old=JSON.parse(fs.readFileSync(file,'utf8')) as CommitRecord;if(old.reportHash===reportHash&&old.body===body)return old;}catch{}
 const salt=('0x'+crypto.randomBytes(32).toString('hex')) as string;
 const rec:CommitRecord={wallet:wallet.toLowerCase(),bountyId,severity,reportHash,salt,commitHash:commitHashOf(NIB_BUG_BOUNTY,BigInt(bountyId),wallet,severity,reportHash,salt),body,createdAt:Date.now()};
 fs.mkdirSync(dirOf(dir),{recursive:true,mode:0o700});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rec),{mode:0o600});fs.renameSync(tmp,file);return rec;
}
export function loadCommits(dir:string,wallet:string):CommitRecord[]{
 try{return fs.readdirSync(dirOf(dir)).filter(n=>n.endsWith('.json')).flatMap(n=>{try{if(n.startsWith('vote-'))return [];const r=JSON.parse(fs.readFileSync(path.join(dirOf(dir),n),'utf8')) as CommitRecord;return r.wallet===wallet.toLowerCase()?[r]:[];}catch{return [];}});}catch{return [];}
}
export function markSubmission(dir:string,rec:CommitRecord,submissionId:string){
 const file=fileFor(dir,rec.wallet,rec.bountyId,rec.severity,rec.reportHash);fs.writeFileSync(file,JSON.stringify({...rec,submissionId}),{mode:0o600});
}
export function readTextFile(file:string,max:number,what:string){
 let text:string;try{text=fs.readFileSync(file,'utf8');}catch{return bad('Cannot read '+what+' file: '+file);}
 if(!text.trim())bad('The '+what+' file is empty.');if(byteLen(text)>max)bad('The '+what+' is too large ('+Math.round(max/1024)+' KB maximum).');return text;
}

/** Least TAP a bounty with this lowest tier may demand per report (1% of the tier at 10 TAP per NIB, never below 500). Mirrors the contract and the site. */
export const minTapStake=(lowestTier:bigint)=>{const t=lowestTier/10n**19n;return t<500n?500n:t;};
export const VERDICT_DUPLICATE=255;
/** The sealed-vote hash the contract checks when a panelist opens their vote (reviewer-bound, so a vote cannot be copied). */
export function voteHashOf(contract:string,submissionId:bigint,reviewer:string,verdict:number,duplicateOf:bigint,salt:string){
 return keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,uint256,address,uint8,uint256,bytes32'),[56n,contract as `0x${string}`,submissionId,reviewer as `0x${string}`,verdict,duplicateOf,salt as `0x${string}`]));
}
/** Panelist-side local record: verdict and salt are saved BEFORE the sealed vote is previewed, so the vote can always be opened later. */
export type VoteRecord={wallet:string;submissionId:string;verdict:number;duplicateOf:string;salt:string;voteHash:string;createdAt:number};
const voteFile=(dir:string,wallet:string,submissionId:string)=>path.join(dirOf(dir),'vote-'+wallet.toLowerCase().slice(2,10)+'-'+submissionId+'.json');
export function prepareVote(dir:string,wallet:string,submissionId:string,verdict:number,duplicateOf:string):VoteRecord{
 if(!Number.isInteger(verdict)||!((verdict>=0&&verdict<=4)||verdict===VERDICT_DUPLICATE))bad('The verdict must be invalid, a severity 1 to 4, or duplicate.');
 if((verdict===VERDICT_DUPLICATE)!==(duplicateOf!=='0'))bad(verdict===VERDICT_DUPLICATE?'A duplicate verdict must name the earlier submission (--duplicate-of).':'--duplicate-of is only for a duplicate verdict.');
 const file=voteFile(dir,wallet,submissionId);
 try{const old=JSON.parse(fs.readFileSync(file,'utf8')) as VoteRecord;if(old.verdict===verdict&&old.duplicateOf===duplicateOf)return old;if(old.voteHash)bad('You already prepared a vote for submission #'+submissionId+' with a different verdict. Votes cannot be changed once sealed; open the one you sealed with: do bounty-open-vote '+submissionId);}catch(e){if(e instanceof BountyCheckError)throw e;}
 const salt='0x'+crypto.randomBytes(32).toString('hex'),rec:VoteRecord={wallet:wallet.toLowerCase(),submissionId,verdict,duplicateOf,salt,voteHash:voteHashOf(NIB_BUG_BOUNTY,BigInt(submissionId),wallet,verdict,BigInt(duplicateOf),salt),createdAt:Date.now()};
 fs.mkdirSync(dirOf(dir),{recursive:true,mode:0o700});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rec),{mode:0o600});fs.renameSync(tmp,file);return rec;
}
export function loadVote(dir:string,wallet:string,submissionId:string):VoteRecord|null{try{return JSON.parse(fs.readFileSync(voteFile(dir,wallet,submissionId),'utf8'));}catch{return null;}}
