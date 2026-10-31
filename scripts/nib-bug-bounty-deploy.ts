// Bug Bounty escrow (NibBugBounty) deployment via the Binance agentic wallet (baw). Never broadcasts without --approve-deployment.
// Usage: npx tsx scripts/nib-bug-bounty-deploy.ts plan|dryrun|preview|execute|verify [--approve-deployment]
//   plan     offline: constructor args, salt, deterministic address, calldata hash. No RPC, no wallet.
//   dryrun   read-only RPC: estimateGas / gas price / treasury balance / already-deployed checks. No wallet, no Binance preview, nothing sent.
//   preview  asks Binance for a contract-call preview of the exact deployment (does not broadcast).
//   execute  broadcasts the previewed deployment; requires --approve-deployment after explicit user approval of the preview.
//   verify   compares on-chain runtime bytecode and immutables to the reviewed artifact.
// One step: deploy NibBugBounty(nib, agentIdRegistry, signer, guardian, feeRecipient, feeBps, reviewerBps, minDeposit, minLowestTier, owner) through the Arachnid CREATE2 factory,
// so the address is known before any tx is sent. The contract has no pause and no upgrade path, and its immutable `owner` (the treasury) can only decide appealed rejections: nothing needs configuring afterwards
// except the website env vars (BUG_BOUNTY_CONTRACT, BUG_BOUNTY_REPORT_KEY, BUG_BOUNTY_SIGNER_PRIVATE_KEY).
// The economic parameters below are IMMUTABLE once deployed and are part of the CREATE2 address. Changing any of them changes the address:
// re-run `plan`, update NIB_BUG_BOUNTY in agent/bounty.ts, and test/bug-bounty-chat.test.ts will tell you if they disagree.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {createPublicClient,http,encodeDeployData,getCreate2Address,keccak256,toHex,formatEther,parseAbi} from 'viem';import {bsc} from 'viem/chains';
import {CREATE2_FACTORY,TREASURY,baw,wallet} from './nib-deploy';
import {AGENT_ID_REGISTRY} from '../lib/protocol';
export const NIB_TOKEN_ADDRESS='0x1F11d9feAF354aD31861B4fa26759349e2860cFb' as const;
/** NibVaultV2: where the platform fee goes (the V2 fee policy). */
export const NIB_VAULT_V2='0x65397BF634E817539024EFd32a0E2c5e51fB81bd' as const;
/** Reviewed parameters, all IMMUTABLE once deployed (except the ticket signer, which the guardian can rotate through a public 7-day delay). 1 NIB = 10^18. */
export const BOUNTY_PARAMS={
 /** Address of the key the TapTap server signs TAP-stake tickets with (BUG_BOUNTY_SIGNER_PRIVATE_KEY). It can never move NIB. A fresh, dedicated key: see docs/bug-bounty.md. */
 signer:'0x34B800cB13ef386Aa607E4dd24DC34D3796C92b2' as `0x${string}`,
 /** May ONLY rotate the ticket signer, and only through a public 7-day delay. Cannot touch escrow, outcomes or fees. */
 guardian:TREASURY as `0x${string}`,
 /** Decides appealed rejections ONLY (approve up to the claimed severity, or reject for good). Cannot touch escrow, fees, unappealed reports or the rules. */
 owner:TREASURY as `0x${string}`,
 /** Receives the platform fee. */
 feeRecipient:NIB_VAULT_V2 as `0x${string}`,
 /** Platform fee on a valid payout: 200 = 2%. Hard cap in the contract: 500 (5%). */
 feeBps:200n,
 /** Share of EACH payout split among that report's reviewers who voted with the outcome: 2000 = 20%. Hard cap in the contract: 3000 (30%). */
 reviewerBps:2000n,
 /** Minimum NIB a project must escrow when it creates a bounty. */
 minDeposit:10_000n*10n**18n,
 /** Minimum payout of a bounty's lowest severity tier: the minimum bounty size. */
 minLowestTier:10_000n*10n**18n,
};
const artifact=(n:string)=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json','utf8'));
export function bugBountyPlan(owner:`0x${string}`=TREASURY,p=BOUNTY_PARAMS){
 const a=artifact('NibBugBounty');if((a.deployedBytecode.length-2)/2>24576)throw Error('NibBugBounty exceeds the contract size limit.');
 const args=[NIB_TOKEN_ADDRESS,AGENT_ID_REGISTRY,p.signer,p.guardian,p.feeRecipient,p.feeBps,p.reviewerBps,p.minDeposit,p.minLowestTier,p.owner];
 const initCode=encodeDeployData({abi:a.abi,bytecode:a.bytecode,args});
 const salt=keccak256(toHex('taptap:nibbugbounty:v2:'+owner.toLowerCase()));
 const address=getCreate2Address({from:CREATE2_FACTORY,salt,bytecodeHash:keccak256(initCode)});
 // The Arachnid factory takes raw calldata: salt (32 bytes) followed by the init code.
 const data=(salt+initCode.slice(2)) as `0x${string}`;
 return {chainId:56 as const,owner,treasury:TREASURY,nib:NIB_TOKEN_ADDRESS,agentIdRegistry:AGENT_ID_REGISTRY,name:'NibBugBounty',constructorArgs:{nib_:NIB_TOKEN_ADDRESS,registry_:AGENT_ID_REGISTRY,signer_:p.signer,guardian_:p.guardian,feeRecipient_:p.feeRecipient,feeBps_:p.feeBps.toString(),reviewerBps_:p.reviewerBps.toString(),minDeposit_:p.minDeposit.toString(),minLowestTier_:p.minLowestTier.toString(),owner_:p.owner},address,salt,initCodeHash:keccak256(initCode),tx:{chainId:56 as const,from:owner,to:CREATE2_FACTORY as `0x${string}`,value:'0',data}};
}
async function run(){
 const mode=process.argv[2]||'plan',dir=path.join(os.homedir(),'.local','state','taptap'),stateFile=path.join(dir,'nib-bug-bounty-deploy.json');
 const plan=bugBountyPlan(),tx=plan.tx;
 const pub={owner:plan.owner,treasury:plan.treasury,contract:{name:plan.name,address:plan.address,salt:plan.salt,initCodeHash:plan.initCodeHash,constructorArgs:plan.constructorArgs}};
 if(mode==='plan'){console.log(JSON.stringify({...pub,tx:{to:tx.to,from:tx.from,value:'0',calldataKeccak:keccak256(tx.data),bytes:(tx.data.length-2)/2},next:'No transactions sent.'},null,2));return;}
 const c=createPublicClient({chain:bsc,transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:20000})});if(await c.getChainId()!==56)throw Error('RPC is on the wrong chain.');
 const code=async(a:`0x${string}`)=>{const x=await c.getCode({address:a});return !!x&&x!=='0x';};
 const norm=(x:string,a:any)=>{const b=Buffer.from(x.slice(2),'hex');for(const refs of Object.values(a.immutableReferences||{}) as any[])for(const r of refs)b.fill(0,r.start,r.start+r.length);return '0x'+b.toString('hex');};
 const getters=parseAbi(['function nib() view returns(address)','function agentIdRegistry() view returns(address)','function ticketSigner() view returns(address)','function guardian() view returns(address)','function feeRecipient() view returns(address)','function feeBps() view returns(uint256)','function reviewerBps() view returns(uint256)','function minDeposit() view returns(uint256)','function minLowestTier() view returns(uint256)','function owner() view returns(address)']);
 const guard=async()=>{
  if(await code(plan.address))throw Error('NibBugBounty is already deployed at '+plan.address);
  if(!await code(NIB_TOKEN_ADDRESS)||!await code(AGENT_ID_REGISTRY))throw Error('A required existing contract has no code on this chain.');
  if(!await code(CREATE2_FACTORY))throw Error('The CREATE2 factory is missing on this chain.');
 };
 const costs=async()=>{const [gas,gasPrice,balance]=await Promise.all([c.estimateGas({account:TREASURY,to:tx.to,data:tx.data,value:0n}),c.getGasPrice(),c.getBalance({address:TREASURY})]);return {estimatedGas:gas.toString(),gasPriceGwei:(Number(gasPrice)/1e9).toFixed(3),estimatedCostBnb:formatEther(gas*gasPrice),costAtTenXGasPriceBnb:formatEther(gas*gasPrice*10n),treasuryBalanceBnb:formatEther(balance)};};
 if(mode==='dryrun'){
  await guard();
  console.log(JSON.stringify({what:'DRY RUN: deploy NibBugBounty(nib, agentIdRegistry, signer, guardian, feeRecipient, feeBps, reviewerBps, minDeposit, minLowestTier, owner) via CREATE2 (nothing sent, no wallet touched)',from:TREASURY,to:tx.to,value:'0 BNB',...pub,calldataKeccak:keccak256(tx.data),calldataBytes:(tx.data.length-2)/2,runtimeBytes:(artifact('NibBugBounty').deployedBytecode.length-2)/2,...await costs(),next:'Run preview for a Binance contract-call preview, show it to the user, and execute only after explicit approval.'},null,2));return;
 }
 if(mode==='verify'){
  const a=artifact('NibBugBounty'),deployed=await c.getCode({address:plan.address});
  if(!deployed||deployed==='0x'||norm(deployed,a)!==a.deployedBytecode)throw Error('Runtime bytecode differs from reviewed source or not deployed.');
  const read=(fn:string)=>c.readContract({address:plan.address,abi:getters,functionName:fn} as any);
  const [nib,reg,sig,gua,fee,bps,rbps,dep,low,own]=await Promise.all(['nib','agentIdRegistry','ticketSigner','guardian','feeRecipient','feeBps','reviewerBps','minDeposit','minLowestTier','owner'].map(read));
  const eq=(x:any,y:any)=>String(x).toLowerCase()===String(y).toLowerCase();const p=BOUNTY_PARAMS;
  if(!eq(nib,NIB_TOKEN_ADDRESS)||!eq(reg,AGENT_ID_REGISTRY)||!eq(sig,p.signer)||!eq(gua,p.guardian)||!eq(own,p.owner)||!eq(fee,p.feeRecipient)||BigInt(bps as any)!==p.feeBps||BigInt(rbps as any)!==p.reviewerBps||BigInt(dep as any)!==p.minDeposit||BigInt(low as any)!==p.minLowestTier)throw Error('Immutables differ from the approved deployment.');
  console.log(JSON.stringify({verified:true,...pub,next:'Set BUG_BOUNTY_CONTRACT to the address, BUG_BOUNTY_REPORT_KEY (64 hex chars) and BUG_BOUNTY_SIGNER_PRIVATE_KEY (the key of the signer address above) in Vercel (production) and redeploy, pin the address in the connector, verify the source on BscScan/Sourcify with artifacts/NibBugBounty-standard-input.json, then merge the branch.'},null,2));return;
 }
 if(mode==='execute'){
  if(!process.argv.includes('--approve-deployment'))throw Error('Review the exact preview and get explicit user approval, then pass --approve-deployment.');
  const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  if(saved.execution)throw Error('Execution was already attempted. Verify the receipt before doing anything else.');
  if(saved.preview.expiresAt<Date.now())throw Error('Preview expired. Run a fresh preview.');
  if(wallet().toLowerCase()!==TREASURY.toLowerCase()||saved.tx.from.toLowerCase()!==TREASURY.toLowerCase())throw Error('Connected wallet differs from the treasury.');
  if(keccak256(tx.data)!==saved.calldataKeccak||tx.to.toLowerCase()!==saved.tx.to.toLowerCase())throw Error('Source changed since the preview. Run a fresh preview.');
  await guard();
  saved.execution={startedAt:Date.now()};fs.writeFileSync(stateFile,JSON.stringify(saved),{mode:0o600});
  const result=baw(['contract-call','execute','--requestId',saved.preview.requestId]);saved.execution.result=result;fs.writeFileSync(stateFile,JSON.stringify(saved),{mode:0o600});
  console.log(JSON.stringify({status:result.status,transactionHash:result.txHash||result.transactionHash,contract:plan.address,next:'Confirm the receipt on BscScan, then run verify. Never execute an uncertain deployment twice.'},null,2));return;
 }
 if(mode!=='preview')throw Error('Unknown mode '+mode);
 const w=wallet();if(w.toLowerCase()!==TREASURY.toLowerCase())throw Error('Connected wallet '+w+' is not the treasury.');
 await guard();
 const cost=await costs();
 const p=baw(['contract-call','preview','--binanceChainId','56','--from',TREASURY,'--to',tx.to,'--value','0','--inputData',tx.data]);if(!p.requestId)throw Error('Binance did not return a usable preview.');
 const n=Number(p.expiresAt);p.expiresAt=Number.isFinite(n)?(n<1e12?n*1000:n):Date.now()+180000;
 const summary={what:'Deploy NibBugBounty(nib, agentIdRegistry, signer, guardian, feeRecipient, feeBps, reviewerBps, minDeposit, minLowestTier, owner) via CREATE2',to:tx.to,value:'0 BNB',calldataKeccak:keccak256(tx.data),calldataBytes:(tx.data.length-2)/2,resultAddress:plan.address,constructorArgs:plan.constructorArgs,...cost};
 fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(stateFile,JSON.stringify({tx:{...tx},calldataKeccak:keccak256(tx.data),summary,preview:p}),{mode:0o600});
 console.log(JSON.stringify({summary,preview:{requestId:p.requestId,expiresAt:new Date(p.expiresAt).toISOString(),risks:p.risks,authorityChanges:p.authorityChanges,requireConfirmation:p.requireConfirmation},next:'Show the user this preview. Execute only after explicit approval: npx tsx scripts/nib-bug-bounty-deploy.ts execute --approve-deployment (within the preview window).'},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
