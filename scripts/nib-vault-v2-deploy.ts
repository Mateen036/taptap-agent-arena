// NibVaultV2 deployment via the Binance agentic wallet (baw). Never broadcasts without --approve-deployment.
// Usage: npx tsx scripts/nib-vault-v2-deploy.ts plan|dryrun|preview|execute|verify [--approve-deployment]
//   plan     offline: constructor args, salt, deterministic address, calldata hash. No RPC, no wallet.
//   dryrun   read-only RPC: estimateGas / gas price / treasury balance / already-deployed checks. No wallet, no Binance preview, nothing sent.
//   preview  asks Binance for a contract-call preview of the exact deployment (does not broadcast).
//   execute  broadcasts the previewed deployment; requires --approve-deployment after explicit user approval of the preview.
//   verify   compares on-chain runtime bytecode and immutables to the reviewed artifact.
// One step: deploy NibVaultV2(nib, usdt, router, treasury) through the Arachnid CREATE2 factory, so the address is known before any tx is sent.
// The vault is OWNED BY THE TREASURY and its liquidity is NOT locked: the treasury can withdraw everything. NIB is immutable. No delay, no setup step after deployment.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {createPublicClient,http,encodeDeployData,getCreate2Address,keccak256,toHex,formatEther,parseAbi} from 'viem';import {bsc} from 'viem/chains';
import {CREATE2_FACTORY,TREASURY,baw,wallet} from './nib-deploy';
import {NIB_TOKEN} from '../lib/airdrop';
import {NFT_PAYMENT,NFT_ROUTER,NFT_WBNB} from '../lib/nft-protocol';
export const VAULT_V2_NIB=NIB_TOKEN;export const VAULT_V2_USDT=NFT_PAYMENT;export const VAULT_V2_ROUTER=NFT_ROUTER;
const artifact=(n:string)=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json','utf8'));
export function vaultV2Plan(owner:`0x${string}`=TREASURY){
 const a=artifact('NibVaultV2');if((a.deployedBytecode.length-2)/2>24576)throw Error('NibVaultV2 exceeds the contract size limit.');
 const args=[VAULT_V2_NIB,VAULT_V2_USDT,VAULT_V2_ROUTER,owner];
 const initCode=encodeDeployData({abi:a.abi,bytecode:a.bytecode,args});
 const salt=keccak256(toHex('taptap:nibvaultv2:v1:'+owner.toLowerCase()));
 const address=getCreate2Address({from:CREATE2_FACTORY,salt,bytecodeHash:keccak256(initCode)});
 // The Arachnid factory takes raw calldata: salt (32 bytes) followed by the init code.
 const data=(salt+initCode.slice(2)) as `0x${string}`;
 return {chainId:56 as const,owner,treasury:TREASURY,nib:VAULT_V2_NIB,usdt:VAULT_V2_USDT,router:VAULT_V2_ROUTER,name:'NibVaultV2',constructorArgs:{nib_:VAULT_V2_NIB,usdt_:VAULT_V2_USDT,router_:VAULT_V2_ROUTER,owner_:owner},address,salt,initCodeHash:keccak256(initCode),tx:{chainId:56 as const,from:owner,to:CREATE2_FACTORY as `0x${string}`,value:'0',data}};
}
async function run(){
 const mode=process.argv[2]||'plan',dir=path.join(os.homedir(),'.local','state','taptap'),stateFile=path.join(dir,'nib-vault-v2-deploy.json');
 const plan=vaultV2Plan(),tx=plan.tx;
 const pub={owner:plan.owner,treasury:plan.treasury,liquidityLocked:false,contract:{name:plan.name,address:plan.address,salt:plan.salt,initCodeHash:plan.initCodeHash,constructorArgs:plan.constructorArgs}};
 if(mode==='plan'){console.log(JSON.stringify({...pub,tx:{to:tx.to,from:tx.from,value:'0',calldataKeccak:keccak256(tx.data),bytes:(tx.data.length-2)/2},next:'No transactions sent.'},null,2));return;}
 const c=createPublicClient({chain:bsc,transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:20000})});if(await c.getChainId()!==56)throw Error('RPC is on the wrong chain.');
 const code=async(a:`0x${string}`)=>{const x=await c.getCode({address:a});return !!x&&x!=='0x';};
 const norm=(x:string,a:any)=>{const b=Buffer.from(x.slice(2),'hex');for(const refs of Object.values(a.immutableReferences||{}) as any[])for(const r of refs)b.fill(0,r.start,r.start+r.length);return '0x'+b.toString('hex');};
 const vaultAbi=parseAbi(['function nib() view returns(address)','function usdt() view returns(address)','function wbnb() view returns(address)','function router() view returns(address)','function owner() view returns(address)','function pendingOwner() view returns(address)']);
 const routerAbi=parseAbi(['function WETH() view returns(address)']);
 const eq=(a:any,b:string)=>String(a).toLowerCase()===b.toLowerCase();
 const guard=async()=>{
  if(await code(plan.address))throw Error('NibVaultV2 is already deployed at '+plan.address);
  if(!await code(VAULT_V2_NIB)||!await code(VAULT_V2_USDT)||!await code(VAULT_V2_ROUTER))throw Error('A required existing contract has no code on this chain.');
  const w=await c.readContract({address:VAULT_V2_ROUTER,abi:routerAbi,functionName:'WETH'});
  if(!eq(w,NFT_WBNB))throw Error('The router reports WBNB '+w+', expected '+NFT_WBNB+'.');
  if(!await code(CREATE2_FACTORY))throw Error('The CREATE2 factory is missing on this chain.');
 };
 const costs=async()=>{const [gas,gasPrice,balance]=await Promise.all([c.estimateGas({account:TREASURY,to:tx.to,data:tx.data,value:0n}),c.getGasPrice(),c.getBalance({address:TREASURY})]);return {estimatedGas:gas.toString(),gasPriceGwei:(Number(gasPrice)/1e9).toFixed(3),estimatedCostBnb:formatEther(gas*gasPrice),costAtTenXGasPriceBnb:formatEther(gas*gasPrice*10n),treasuryBalanceBnb:formatEther(balance)};};
 if(mode==='dryrun'){
  await guard();
  console.log(JSON.stringify({what:'DRY RUN: deploy NibVaultV2(nib, usdt, router, treasury) via CREATE2 (nothing sent, no wallet touched)',from:TREASURY,to:tx.to,value:'0 BNB',...pub,calldataKeccak:keccak256(tx.data),calldataBytes:(tx.data.length-2)/2,runtimeBytes:(artifact('NibVaultV2').deployedBytecode.length-2)/2,...await costs(),next:'Run preview for a Binance contract-call preview, show it to the user, and execute only after explicit approval.'},null,2));return;
 }
 if(mode==='verify'){
  const a=artifact('NibVaultV2'),deployed=await c.getCode({address:plan.address});
  if(!deployed||deployed==='0x'||norm(deployed,a)!==a.deployedBytecode)throw Error('Runtime bytecode differs from reviewed source or not deployed.');
  const [nib,usdt,wbnb,router,owner,pending]=await Promise.all(['nib','usdt','wbnb','router','owner','pendingOwner'].map(fn=>c.readContract({address:plan.address,abi:vaultAbi,functionName:fn} as any)));
  if(!eq(nib,VAULT_V2_NIB)||!eq(usdt,VAULT_V2_USDT)||!eq(router,VAULT_V2_ROUTER)||!eq(wbnb,NFT_WBNB)||!eq(owner,TREASURY)||!/^0x0{40}$/i.test(String(pending)))throw Error('Immutables or owner differ from the approved deployment.');
  console.log(JSON.stringify({verified:true,...pub,next:'Verify the source on BscScan/Sourcify with artifacts/NibVaultV2-standard-input.json (contract contracts/NibVaultV2.sol:NibVaultV2, compiler from the artifact, optimizer 200 runs, viaIR, paris). Then set NIB_VAULT_V2 to the address in Vercel (production) to show the website disclosure, and merge the branch.'},null,2));return;
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
 const summary={what:'Deploy NibVaultV2(nib, usdt, router, treasury) via CREATE2. Treasury-owned vault: liquidity is NOT locked.',to:tx.to,value:'0 BNB',calldataKeccak:keccak256(tx.data),calldataBytes:(tx.data.length-2)/2,resultAddress:plan.address,constructorArgs:plan.constructorArgs,...cost};
 fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(stateFile,JSON.stringify({tx:{...tx},calldataKeccak:keccak256(tx.data),summary,preview:p}),{mode:0o600});
 console.log(JSON.stringify({summary,preview:{requestId:p.requestId,expiresAt:new Date(p.expiresAt).toISOString(),risks:p.risks,authorityChanges:p.authorityChanges,requireConfirmation:p.requireConfirmation},next:'Show the user this preview. Execute only after explicit approval: npx tsx scripts/nib-vault-v2-deploy.ts execute --approve-deployment (within the preview window).'},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
