import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
import {createPublicClient,http,encodeDeployData,encodeFunctionData,getCreate2Address,keccak256,toHex,parseAbi,isAddress,formatEther} from 'viem';import {bsc} from 'viem/chains';
import {NFT_PAYMENT,NFT_ROUTER,nftAbi,nftVaultAbi,nftMarketAbi} from '../lib/nft-protocol';import {AGENT_ID_REGISTRY} from '../lib/protocol';import {canonical} from '../lib/game';
export const NFT_CREATE2='0x4e59b44847b379578588920cA78FbF26c0B4956C' as const;
export const NFT_MULTICALL='0xcA11bde05977b3631167028862bE2a173976CA11' as const;
export const deploymentAbi=parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns((bool success,bytes returnData)[] returnData)']);
const artifact=(name:string)=>JSON.parse(fs.readFileSync('artifacts/'+name+'.json','utf8'));
export function nftDeploymentPlan(owner:`0x${string}`){
 if(!isAddress(owner))throw Error('Set an owner public wallet address.');
 const steps:any[]=[];
 const add=(name:string,args:any[])=>{const a=artifact(name);if((a.deployedBytecode.length-2)/2>24576)throw Error(name+' exceeds the mainnet contract size limit.');const initCode=encodeDeployData({abi:a.abi,bytecode:a.bytecode,args});const salt=keccak256(toHex('taptap:nib-foundry:v1:'+owner.toLowerCase()+':'+name));const address=getCreate2Address({from:NFT_CREATE2,salt,bytecodeHash:keccak256(initCode)});steps.push({name,address,salt,args,initCode,callData:(salt+initCode.slice(2)) as `0x${string}`,runtimeBytecodeHash:keccak256(a.deployedBytecode),initCodeHash:keccak256(initCode),compiler:a.compiler});return address;};
 const renderer=add('NibRenderer',[]),vault=add('NibLPVault',[NFT_PAYMENT,NFT_ROUTER,owner]),collection=add('NibFoundry',[AGENT_ID_REGISTRY,NFT_PAYMENT,vault,renderer,owner]),market=add('NibMarketplace',[collection,NFT_PAYMENT,AGENT_ID_REGISTRY]);
 const calls=steps.map(s=>({target:NFT_CREATE2,allowFailure:false,callData:s.callData}));
 return {chainId:56 as const,owner,contracts:{renderer,vault,collection,market},payment:NFT_PAYMENT,router:NFT_ROUTER,registry:AGENT_ID_REGISTRY,supply:10000,perWalletLimit:10,firstFree:'one per wallet',paidMintPrice:'1 USDT',lpPolicy:'Primary mint proceeds go directly to an LP-only vault. Future token selection has a 2-day delay; LP tokens have no withdrawal path.',transaction:{chainId:56 as const,from:owner,to:NFT_MULTICALL,value:'0',data:encodeFunctionData({abi:deploymentAbi,functionName:'aggregate3',args:[calls]})},steps};
}
export function normalizeRuntime(code:`0x${string}`,a:any){const bytes=Buffer.from(code.slice(2),'hex');for(const refs of Object.values(a.immutableReferences||{}) as any[])for(const r of refs)bytes.fill(0,r.start,r.start+r.length);return '0x'+bytes.toString('hex');}
const baw=(args:string[])=>{const r=spawnSync('baw',[...args,'--json'],{encoding:'utf8',maxBuffer:8*1024*1024});let d;try{d=JSON.parse(r.stdout)}catch{throw Error('Binance CLI returned no readable result.');}if(r.status||!d.success)throw Error(d.error?.message||r.stderr||'Binance operation failed.');return d.data;};
function signer(){if(baw(['wallet','status']).status!=='CONNECTED')throw Error('Sign in to Binance Agentic Wallet first.');const s=baw(['wallet','settings']),raw=s.devMode?.expiresAt,n=Number(raw),expiry=typeof raw==='string'&&!/^\d+$/.test(raw)?Date.parse(raw):n<1e12?n*1000:n;if(!s.devMode?.enabled||!Number.isFinite(expiry)||expiry<=Date.now())throw Error('Enable Developer Mode before preparing a deployment preview.');const address=baw(['wallet','address']).addresses.find((a:any)=>String(a.binanceChainId)==='56')?.address;if(!address)throw Error('BNB Chain wallet unavailable.');return address as `0x${string}`;}
async function run(){
 const mode=process.argv[2]||'plan',i=process.argv.indexOf('--owner');let owner=process.argv[i+1] as `0x${string}`;
 const dir=path.join(os.homedir(),'.local','state','taptap'),stateFile=path.join(dir,'nft-deployment.json');
 if(['preview','execute'].includes(mode)){const connected=signer();if(i>=0&&connected.toLowerCase()!==owner.toLowerCase())throw Error('Connected wallet differs from the selected owner.');owner=connected;}
 if(mode==='execute'){
  if(!process.argv.includes('--approve-deployment'))throw Error('Review the exact preview and obtain explicit user approval before --approve-deployment.');
  const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(saved.owner.toLowerCase()!==owner.toLowerCase()||saved.preview.expiresAt<Date.now())throw Error('Deployment preview expired or wallet changed. Run a fresh preview.');
  const rebuilt=nftDeploymentPlan(owner);if(keccak256(toHex(canonical(rebuilt)))!==saved.planDigest)throw Error('Deployment source changed. Review a fresh preview.');
  if(saved.execution)throw Error('Execution was already attempted. Verify its receipt before taking any further action.');
  saved.execution={startedAt:Date.now()};fs.writeFileSync(stateFile,JSON.stringify(saved),{mode:0o600});
  const result=baw(['contract-call','execute','--requestId',saved.preview.requestId]);saved.execution.result=result;fs.writeFileSync(stateFile,JSON.stringify(saved),{mode:0o600});console.log(JSON.stringify({status:result.status,transactionHash:result.txHash||result.transactionHash,orderId:result.orderId,next:'Verify the on-chain receipt and runtime code before configuring the website. Never execute an uncertain deployment twice.'},null,2));return;
 }
 if(!owner||!isAddress(owner))throw Error('Usage: npx tsx scripts/nft-deploy.ts plan|preview|verify --owner PUBLIC_ADDRESS');
 const plan=nftDeploymentPlan(owner),c=createPublicClient({chain:bsc,transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:20000})});if(await c.getChainId()!==56)throw Error('RPC is on the wrong chain.');
 if(mode==='verify'){
  for(const step of plan.steps){const code=await c.getCode({address:step.address});if(!code||normalizeRuntime(code,artifact(step.name))!==artifact(step.name).deployedBytecode)throw Error(step.name+' runtime bytecode does not match reviewed source.');}
  const r=async(address:any,abi:any,functionName:string)=>c.readContract({address,abi,functionName} as any);
  const values=await Promise.all([r(plan.contracts.collection,nftAbi,'lpVault'),r(plan.contracts.collection,nftAbi,'renderer'),r(plan.contracts.market,nftMarketAbi,'collection'),r(plan.contracts.vault,nftVaultAbi,'router'),r(plan.contracts.collection,parseAbi(['function owner() view returns(address)']),'owner'),r(plan.contracts.vault,parseAbi(['function owner() view returns(address)']),'owner')]);
  const expected=[plan.contracts.vault,plan.contracts.renderer,plan.contracts.collection,NFT_ROUTER,owner,owner];if(values.some((v,j)=>String(v).toLowerCase()!==expected[j].toLowerCase()))throw Error('Contract ownership or links differ from the approved deployment.');
  console.log(JSON.stringify({verified:true,chainId:56,contracts:plan.contracts,owner},null,2));return;
 }
 const codeEntries=await Promise.all([NFT_CREATE2,NFT_MULTICALL,NFT_ROUTER,NFT_PAYMENT,AGENT_ID_REGISTRY].map(async address=>{const code=await c.getCode({address});if(!code||code==='0x')throw Error('Required on-chain dependency missing: '+address);return {address,codeHash:keccak256(code)};}));
 const existing=await Promise.all(plan.steps.map(async s=>!!(await c.getCode({address:s.address}))));if(existing.some(Boolean))throw Error('A predicted contract address is already deployed. Use verify and reconcile before creating a new deployment.');
 const [gas,gasPrice,balance]=await Promise.all([c.estimateGas({account:owner,to:plan.transaction.to,data:plan.transaction.data,value:0n}),c.getGasPrice(),c.getBalance({address:owner})]);
 const summary={collection:plan.contracts.collection,contracts:plan.contracts,owner,chainId:56,supply:10000,firstFree:'one per eligible wallet',maximumMintsPerWallet:10,paidPrice:'1 USDT',nativeTransferValue:'0 BNB',estimatedGas:gas.toString(),estimatedNetworkFeeBNB:formatEther(gas*gasPrice),walletBNBBalance:formatEther(balance),lpPolicy:plan.lpPolicy,dependencies:codeEntries};
 fs.mkdirSync('docs/nft',{recursive:true});const {walletBNBBalance:privateBalance,...publicSummary}=summary;fs.writeFileSync('docs/nft/deployment-plan.json',JSON.stringify({...publicSummary,transaction:plan.transaction,steps:plan.steps},null,2)+'\n');
 if(mode==='preview'){
  const p=baw(['contract-call','preview','--binanceChainId','56','--from',owner,'--to',plan.transaction.to,'--value','0','--inputData',plan.transaction.data]);if(!p.requestId)throw Error('Binance did not return a usable deployment preview.');const n=Number(p.expiresAt);p.expiresAt=Number.isFinite(n)?(n<1e12?n*1000:n):Date.now()+180000;
  fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(stateFile,JSON.stringify({owner,planDigest:keccak256(toHex(canonical(plan))),summary,preview:p}),{mode:0o600});
  fs.writeFileSync(path.join(dir,'nft-deployment-preview.json'),JSON.stringify({summary,preview:p},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({summary,preview:{requestId:p.requestId,expiresAt:p.expiresAt,risks:p.risks,authorityChanges:p.authorityChanges,requireConfirmation:p.requireConfirmation},fullPreview:path.join(dir,'nft-deployment-preview.json'),next:'Show the full parsed operation and risks. Execute only after explicit approval of this exact mainnet deployment.'},null,2));
 }else console.log(JSON.stringify({summary,plan:'docs/nft/deployment-plan.json',next:'No transactions sent. The atomic CREATE2 bundle deploys all four contracts. Obtain a Binance preview and explicit approval before execution.'},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(error=>{console.error(error.message);process.exitCode=1;});
