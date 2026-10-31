// NibCollectionV2 + its NibMarketplace and NibCollectionBids, deployed through the Binance agentic wallet (baw). Never broadcasts without --approve-deployment.
// Usage: npx tsx scripts/nib-collection-v2-deploy.ts plan|dryrun|preview|execute|verify --step 1|2|3 [--approve-deployment]
//   plan     offline: constructor args, salts, deterministic addresses, calldata hashes for all three steps. No RPC, no wallet.
//   dryrun   read-only RPC: estimateGas / gas price / treasury balance / already-deployed + prerequisite checks. No wallet, nothing sent.
//   preview  asks Binance for a contract-call preview of the exact deployment (does not broadcast).
//   execute  broadcasts the previewed deployment; requires --approve-deployment after explicit user approval of the preview.
//   verify   compares on-chain runtime bytecode and immutables to the reviewed artifact.
// Steps (each one CREATE2 transaction through the Arachnid factory, so every address is known before anything is sent). Order matters:
//   0  NibVaultV2          (scripts/nib-vault-v2-deploy.ts, must already be deployed: the collection pays into it)
//   1  NibCollectionV2     (registry, USDT, NibVaultV2, renderer, treasury, BNB/USD feed, old collection, publicStartId)
//   2  NibMarketplace      redeployed for V2: the marketplace binds ONE collection immutably, the old one cannot serve V2
//   3  NibCollectionBids   redeployed for V2: same reason
// The old collection is only referenced as `legacy` (the airdrop source). The website serves NOTHING from it once NFT_COLLECTION_V2 is set.
// publicStartId = (old collection minted) + 1 = 1188 (the live old collection has 1187 minted, mint closed); dryrun/preview refuse to proceed unless the old collection's mint is closed and minted()+1 matches.
// Fee recipient of the V2 marketplace and collection bids defaults to NibVaultV2 (treasury-owned). Set V2_FEE_RECIPIENT=treasury to pay the treasury wallet directly
// (then set NFT_FEE_RECIPIENT to the same address on the website).
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {createPublicClient,http,encodeDeployData,getCreate2Address,keccak256,toHex,formatEther,parseAbi} from 'viem';import {bsc} from 'viem/chains';
import {CREATE2_FACTORY,TREASURY,baw,wallet} from './nib-deploy';
import {AGENT_ID_REGISTRY} from '../lib/protocol';
import {NFT_PAYMENT,NFT_PRICE_FEED,NFT_COLLECTION_V1} from '../lib/nft-protocol';
import {vaultV2Plan} from './nib-vault-v2-deploy';
export const V1_RENDERER='0xD056d8A5DBA90620452fa3E6236c8AdE27F21465' as const;
export const V1_MARKETPLACE='0x8B1434193028A88d2a501a88eFc66F4678EF6F02' as const;
export const V1_MINTED=1187n;
const artifact=(n:string)=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json','utf8'));
const MINIMAL=parseAbi(['function minted() view returns(uint256)','function mintOpen() view returns(bool)','function paused() view returns(bool)','function renderer() view returns(address)']);
export function collectionV2Plans(env:{V2_PUBLIC_START_ID?:string;V2_FEE_RECIPIENT?:string}=process.env as any,owner:`0x${string}`=TREASURY){
 const vault=vaultV2Plan().address as `0x${string}`,start=BigInt(env.V2_PUBLIC_START_ID||String(V1_MINTED+1n));
 if(start<2n||start>10000n)throw Error('Invalid public start id.');
 const feeRecipient=(env.V2_FEE_RECIPIENT==='treasury'?TREASURY:vault) as `0x${string}`;
 const build=(step:number,name:string,artifactName:string,args:any[],label:string)=>{
  const a=artifact(artifactName);if((a.deployedBytecode.length-2)/2>24576)throw Error(artifactName+' exceeds the contract size limit.');
  const initCode=encodeDeployData({abi:a.abi,bytecode:a.bytecode,args});
  const salt=keccak256(toHex('taptap:'+label+':v1:'+owner.toLowerCase()));
  const address=getCreate2Address({from:CREATE2_FACTORY,salt,bytecodeHash:keccak256(initCode)}) as `0x${string}`;
  const data=(salt+initCode.slice(2)) as `0x${string}`;   // the Arachnid factory takes raw calldata: salt, then the init code
  return {step,name,artifact:artifactName,address,salt,initCodeHash:keccak256(initCode),args,tx:{chainId:56 as const,from:owner,to:CREATE2_FACTORY as `0x${string}`,value:'0',data}};
 };
 const c=build(1,'NibCollectionV2','NibCollectionV2',[AGENT_ID_REGISTRY,NFT_PAYMENT,vault,V1_RENDERER,owner,NFT_PRICE_FEED,NFT_COLLECTION_V1,start],'nibcollectionv2');
 const m=build(2,'NibMarketplace (V2)','NibMarketplace',[c.address,AGENT_ID_REGISTRY,feeRecipient],'nibmarketplacev2');
 const b=build(3,'NibCollectionBids (V2)','NibCollectionBids',[c.address,AGENT_ID_REGISTRY,feeRecipient],'nibcollectionbidsv2');
 return {owner,vault,publicStartId:start,feeRecipient,steps:[c,m,b]};
}
async function run(){
 const mode=process.argv[2]||'plan',stepArg=process.argv.indexOf('--step'),step=stepArg>0?Number(process.argv[stepArg+1]):0,dir=path.join(os.homedir(),'.local','state','taptap');
 const all=collectionV2Plans(),summaryOf=(p:any)=>({step:p.step,name:p.name,address:p.address,salt:p.salt,initCodeHash:p.initCodeHash,constructorArgs:p.args.map((x:any)=>typeof x==='bigint'?x.toString():x),calldataKeccak:keccak256(p.tx.data),calldataBytes:(p.tx.data.length-2)/2});
 if(mode==='plan'){console.log(JSON.stringify({treasury:TREASURY,vaultV2:all.vault,publicStartId:String(all.publicStartId),feeRecipient:all.feeRecipient,steps:all.steps.map(summaryOf),env:{NFT_COLLECTION_V2:all.steps[0].address,NFT_MARKETPLACE_V2:all.steps[1].address,NFT_COLLECTION_BIDS_V2:all.steps[2].address,NIB_VAULT_V2:all.vault},next:'No transactions sent.'},null,2));return;}
 if(![1,2,3].includes(step))throw Error('Pass --step 1 (collection), 2 (marketplace) or 3 (collection bids).');
 const plan=all.steps[step-1],tx=plan.tx,stateFile=path.join(dir,'nib-collection-v2-deploy-step'+step+'.json');
 const c=createPublicClient({chain:bsc,transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:20000})});if(await c.getChainId()!==56)throw Error('RPC is on the wrong chain.');
 const code=async(a:`0x${string}`)=>{const x=await c.getCode({address:a});return !!x&&x!=='0x';};
 const norm=(x:string,a:any)=>{const b=Buffer.from(x.slice(2),'hex');for(const refs of Object.values(a.immutableReferences||{}) as any[])for(const r of refs)b.fill(0,r.start,r.start+r.length);return '0x'+b.toString('hex');};
 const eq=(a:any,b:string)=>String(a).toLowerCase()===b.toLowerCase();
 const guard=async()=>{
  if(await code(plan.address))throw Error(plan.name+' is already deployed at '+plan.address);
  if(!await code(CREATE2_FACTORY))throw Error('The CREATE2 factory is missing on this chain.');
  if(step===1){
   if(!await code(all.vault))throw Error('Deploy NibVaultV2 first ('+all.vault+'): the collection constructor needs it.');
   const [minted,open,paused,renderer]=await Promise.all(['minted','mintOpen','paused','renderer'].map(fn=>c.readContract({address:NFT_COLLECTION_V1,abi:MINIMAL,functionName:fn} as any)));
   if(open===true&&paused!==true)throw Error('The old collection mint is still open. Close it before deploying V2 so the snapshot cannot change.');
   if(BigInt(minted as any)+1n!==all.publicStartId)throw Error('Old collection minted '+minted+' but publicStartId is '+all.publicStartId+'. Set V2_PUBLIC_START_ID (= minted + 1) only after the old mint is closed.');
   if(!eq(renderer,V1_RENDERER))throw Error('The old collection renderer differs from the reviewed one.');
  }else if(!await code(all.steps[0].address))throw Error('Deploy step 1 (NibCollectionV2) first.');
 };
 const costs=async()=>{const [gas,gasPrice,balance]=await Promise.all([c.estimateGas({account:TREASURY,to:tx.to,data:tx.data,value:0n}),c.getGasPrice(),c.getBalance({address:TREASURY})]);return {estimatedGas:gas.toString(),gasPriceGwei:(Number(gasPrice)/1e9).toFixed(3),estimatedCostBnb:formatEther(gas*gasPrice),costAtTenXGasPriceBnb:formatEther(gas*gasPrice*10n),treasuryBalanceBnb:formatEther(balance)};};
 if(mode==='dryrun'){
  await guard();
  console.log(JSON.stringify({what:'DRY RUN: deploy '+plan.name+' via CREATE2 (nothing sent, no wallet touched)',from:TREASURY,to:tx.to,value:'0 BNB',...summaryOf(plan),runtimeBytes:(artifact(plan.artifact).deployedBytecode.length-2)/2,...await costs(),next:'Run preview for a Binance contract-call preview, show it to the user, and execute only after their explicit approval.'},null,2));return;
 }
 if(mode==='verify'){
  const a=artifact(plan.artifact),deployed=await c.getCode({address:plan.address});
  if(!deployed||deployed==='0x'||norm(deployed,a)!==a.deployedBytecode)throw Error('Runtime bytecode differs from reviewed source or not deployed.');
  const read=(address:any,sig:string,args:any[]=[])=>c.readContract({address,abi:parseAbi(['function '+sig]),functionName:sig.split('(')[0],args} as any);
  const checks:any={};
  if(step===1){
   const col=plan.address,v=(n:string)=>read(col,n+'() view returns('+(['legacy','lpVault','renderer','owner','priceFeed','paymentToken','agentIdRegistry','pendingOwner'].includes(n)?'address':'uint256')+')');
   const [legacy,vault,renderer,owner,feed,pay,registry,price,start,pending]=await Promise.all([v('legacy'),v('lpVault'),v('renderer'),v('owner'),v('priceFeed'),v('paymentToken'),v('agentIdRegistry'),v('mintPrice'),v('publicStartId'),v('pendingOwner')]);
   if(!eq(legacy,NFT_COLLECTION_V1)||!eq(vault,all.vault)||!eq(renderer,V1_RENDERER)||!eq(owner,TREASURY)||!eq(feed,NFT_PRICE_FEED)||!eq(pay,NFT_PAYMENT)||!eq(registry,AGENT_ID_REGISTRY)||BigInt(price as any)!==5n*10n**16n||BigInt(start as any)!==all.publicStartId||!/^0x0{40}$/i.test(String(pending)))throw Error('Immutables or owner differ from the approved deployment.');
   Object.assign(checks,{mintOpen:await read(col,'mintOpen() view returns(bool)'),airdropFinalized:await read(col,'airdropFinalized() view returns(bool)'),totalSupply:String(await read(col,'totalSupply() view returns(uint256)'))});
  }else{
   const coll=await read(plan.address,'collection() view returns(address)'),fee=await read(plan.address,'feeRecipient() view returns(address)'),reg=await read(plan.address,'agentIdRegistry() view returns(address)');
   if(!eq(coll,all.steps[0].address)||!eq(fee,all.feeRecipient)||!eq(reg,AGENT_ID_REGISTRY))throw Error('Immutables differ from the approved deployment.');
  }
  console.log(JSON.stringify({verified:true,...summaryOf(plan),...checks,next:step===3?'All three contracts are deployed. Verify sources on BscScan/Sourcify (artifacts/<name>-standard-input.json), run the airdrop (scripts/nib-collection-v2-airdrop.ts), and only after finalizeAirdrop set NFT_COLLECTION_V2, NFT_MARKETPLACE_V2, NFT_COLLECTION_BIDS_V2 and NIB_VAULT_V2 on the website, then setMintOpen(true).':'Continue with the next step.'},null,2));return;
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
  console.log(JSON.stringify({status:result.status,transactionHash:result.txHash||result.transactionHash,contract:plan.address,next:'Confirm the receipt on BscScan, then run verify --step '+step+'. Never execute an uncertain deployment twice.'},null,2));return;
 }
 if(mode!=='preview')throw Error('Unknown mode '+mode);
 const w=wallet();if(w.toLowerCase()!==TREASURY.toLowerCase())throw Error('Connected wallet '+w+' is not the treasury.');
 await guard();
 const cost=await costs();
 const p=baw(['contract-call','preview','--binanceChainId','56','--from',TREASURY,'--to',tx.to,'--value','0','--inputData',tx.data]);if(!p.requestId)throw Error('Binance did not return a usable preview.');
 const n=Number(p.expiresAt);p.expiresAt=Number.isFinite(n)?(n<1e12?n*1000:n):Date.now()+180000;
 const summary={what:'Deploy '+plan.name+' via CREATE2.',to:tx.to,value:'0 BNB',...summaryOf(plan),resultAddress:plan.address,...cost};
 fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(stateFile,JSON.stringify({tx:{...tx},calldataKeccak:keccak256(tx.data),summary,preview:p}),{mode:0o600});
 console.log(JSON.stringify({summary,preview:{requestId:p.requestId,expiresAt:new Date(p.expiresAt).toISOString(),risks:p.risks,authorityChanges:p.authorityChanges,requireConfirmation:p.requireConfirmation},next:'Show the user this preview. Execute only after explicit approval: npx tsx scripts/nib-collection-v2-deploy.ts execute --step '+step+' --approve-deployment (within the preview window).'},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
