// Collection-wide NFT bids (NibCollectionBids) deployment via the Binance agentic wallet (baw). Never broadcasts without --approve-deployment.
// Usage: npx tsx scripts/nib-collection-bids-deploy.ts plan|dryrun|preview|execute|verify [--approve-deployment]
//   plan     offline: constructor args, salt, deterministic address, calldata hash. No RPC, no wallet.
//   dryrun   read-only RPC: estimateGas / gas price / treasury balance / already-deployed checks. No wallet, no Binance preview, nothing sent.
//   preview  asks Binance for a contract-call preview of the exact deployment (does not broadcast).
//   execute  broadcasts the previewed deployment; requires --approve-deployment after explicit user approval of the preview.
//   verify   compares on-chain runtime bytecode and immutables to the reviewed artifact.
// One step: deploy NibCollectionBids(collection, agentIdRegistry, treasury) through the Arachnid CREATE2 factory, so the address is known before any tx is sent.
// The contract has no owner, no pause and no upgrade path, so nothing needs configuring after deployment except the website env var.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {createPublicClient,http,encodeDeployData,getCreate2Address,keccak256,toHex,formatEther,parseAbi} from 'viem';import {bsc} from 'viem/chains';
import {CREATE2_FACTORY,TREASURY,baw,wallet} from './nib-deploy';
import {AGENT_ID_REGISTRY} from '../lib/protocol';
export const NFT_COLLECTION='0x7374f0379F5b2689B906D47Da708B394F1910B23' as const;
export const NFT_MARKETPLACE='0x8B1434193028A88d2a501a88eFc66F4678EF6F02' as const;
const artifact=(n:string)=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json','utf8'));
export function collectionBidsPlan(owner:`0x${string}`=TREASURY){
 const a=artifact('NibCollectionBids');if((a.deployedBytecode.length-2)/2>24576)throw Error('NibCollectionBids exceeds the contract size limit.');
 const args=[NFT_COLLECTION,AGENT_ID_REGISTRY,TREASURY];
 const initCode=encodeDeployData({abi:a.abi,bytecode:a.bytecode,args});
 const salt=keccak256(toHex('taptap:nibcollectionbids:v1:'+owner.toLowerCase()));
 const address=getCreate2Address({from:CREATE2_FACTORY,salt,bytecodeHash:keccak256(initCode)});
 // The Arachnid factory takes raw calldata: salt (32 bytes) followed by the init code.
 const data=(salt+initCode.slice(2)) as `0x${string}`;
 return {chainId:56 as const,owner,treasury:TREASURY,collection:NFT_COLLECTION,agentIdRegistry:AGENT_ID_REGISTRY,name:'NibCollectionBids',constructorArgs:{collection_:NFT_COLLECTION,registry_:AGENT_ID_REGISTRY,feeRecipient_:TREASURY},address,salt,initCodeHash:keccak256(initCode),tx:{chainId:56 as const,from:owner,to:CREATE2_FACTORY as `0x${string}`,value:'0',data}};
}
async function run(){
 const mode=process.argv[2]||'plan',dir=path.join(os.homedir(),'.local','state','taptap'),stateFile=path.join(dir,'nib-collection-bids-deploy.json');
 const plan=collectionBidsPlan(),tx=plan.tx;
 const pub={owner:plan.owner,treasury:plan.treasury,contract:{name:plan.name,address:plan.address,salt:plan.salt,initCodeHash:plan.initCodeHash,constructorArgs:plan.constructorArgs}};
 if(mode==='plan'){console.log(JSON.stringify({...pub,tx:{to:tx.to,from:tx.from,value:'0',calldataKeccak:keccak256(tx.data),bytes:(tx.data.length-2)/2},next:'No transactions sent.'},null,2));return;}
 const c=createPublicClient({chain:bsc,transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:20000})});if(await c.getChainId()!==56)throw Error('RPC is on the wrong chain.');
 const code=async(a:`0x${string}`)=>{const x=await c.getCode({address:a});return !!x&&x!=='0x';};
 const norm=(x:string,a:any)=>{const b=Buffer.from(x.slice(2),'hex');for(const refs of Object.values(a.immutableReferences||{}) as any[])for(const r of refs)b.fill(0,r.start,r.start+r.length);return '0x'+b.toString('hex');};
 const feeAbi=parseAbi(['function feeRecipient() view returns(address)','function collection() view returns(address)','function agentIdRegistry() view returns(address)']);
 const guard=async()=>{
  if(await code(plan.address))throw Error('NibCollectionBids is already deployed at '+plan.address);
  if(!await code(NFT_COLLECTION)||!await code(AGENT_ID_REGISTRY)||!await code(NFT_MARKETPLACE))throw Error('A required existing contract has no code on this chain.');
  const fee=await c.readContract({address:NFT_MARKETPLACE,abi:feeAbi,functionName:'feeRecipient'});
  if(String(fee).toLowerCase()!==TREASURY.toLowerCase())throw Error('The live marketplace fee recipient is '+fee+', not the treasury. Review before deploying.');
  if(!await code(CREATE2_FACTORY))throw Error('The CREATE2 factory is missing on this chain.');
 };
 const costs=async()=>{const [gas,gasPrice,balance]=await Promise.all([c.estimateGas({account:TREASURY,to:tx.to,data:tx.data,value:0n}),c.getGasPrice(),c.getBalance({address:TREASURY})]);return {estimatedGas:gas.toString(),gasPriceGwei:(Number(gasPrice)/1e9).toFixed(3),estimatedCostBnb:formatEther(gas*gasPrice),costAtTenXGasPriceBnb:formatEther(gas*gasPrice*10n),treasuryBalanceBnb:formatEther(balance)};};
 if(mode==='dryrun'){
  await guard();
  console.log(JSON.stringify({what:'DRY RUN: deploy NibCollectionBids(collection, agentIdRegistry, treasury) via CREATE2 (nothing sent, no wallet touched)',from:TREASURY,to:tx.to,value:'0 BNB',...pub,calldataKeccak:keccak256(tx.data),calldataBytes:(tx.data.length-2)/2,runtimeBytes:(artifact('NibCollectionBids').deployedBytecode.length-2)/2,...await costs(),next:'Run preview for a Binance contract-call preview, show it to the user, and execute only after explicit approval.'},null,2));return;
 }
 if(mode==='verify'){
  const a=artifact('NibCollectionBids'),deployed=await c.getCode({address:plan.address});
  if(!deployed||deployed==='0x'||norm(deployed,a)!==a.deployedBytecode)throw Error('Runtime bytecode differs from reviewed source or not deployed.');
  const [col,reg,fee]=await Promise.all(['collection','agentIdRegistry','feeRecipient'].map(fn=>c.readContract({address:plan.address,abi:feeAbi,functionName:fn} as any)));
  if(String(col).toLowerCase()!==NFT_COLLECTION.toLowerCase()||String(reg).toLowerCase()!==AGENT_ID_REGISTRY.toLowerCase()||String(fee).toLowerCase()!==TREASURY.toLowerCase())throw Error('Immutables differ from the approved deployment.');
  console.log(JSON.stringify({verified:true,...pub,next:'Set NFT_COLLECTION_BIDS to the contract address in Vercel (production) and redeploy, pin the address in the connector, verify the source on BscScan/Sourcify with artifacts/NibCollectionBids-standard-input.json, then merge the branch.'},null,2));return;
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
 const summary={what:'Deploy NibCollectionBids(collection, agentIdRegistry, treasury) via CREATE2',to:tx.to,value:'0 BNB',calldataKeccak:keccak256(tx.data),calldataBytes:(tx.data.length-2)/2,resultAddress:plan.address,constructorArgs:plan.constructorArgs,...cost};
 fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(stateFile,JSON.stringify({tx:{...tx},calldataKeccak:keccak256(tx.data),summary,preview:p}),{mode:0o600});
 console.log(JSON.stringify({summary,preview:{requestId:p.requestId,expiresAt:new Date(p.expiresAt).toISOString(),risks:p.risks,authorityChanges:p.authorityChanges,requireConfirmation:p.requireConfirmation},next:'Show the user this preview. Execute only after explicit approval: npx tsx scripts/nib-collection-bids-deploy.ts execute --approve-deployment (within the preview window).'},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
