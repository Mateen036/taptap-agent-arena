// NIB pre-market (NibBidMarket) deployment via the Binance agentic wallet (baw). Never broadcasts without --approve-deployment.
// Usage: npx tsx scripts/nib-market-deploy.ts plan|preview|execute|verify [--approve-deployment]
// One step: deploy NibBidMarket(nib, treasury) through the Arachnid CREATE2 factory, so the address is known before any tx is sent.
// The market has no owner: the treasury can only pause NEW bids and receives fees. Nothing needs configuring after deployment.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {createPublicClient,http,encodeDeployData,getCreate2Address,keccak256,toHex,formatEther,parseAbi} from 'viem';import {bsc} from 'viem/chains';
import {CREATE2_FACTORY,TREASURY,baw,wallet} from './nib-deploy';
export const NIB_TOKEN='0x1F11d9feAF354aD31861B4fa26759349e2860cFb' as const;
const artifact=(n:string)=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json','utf8'));
export function marketPlan(owner:`0x${string}`=TREASURY){
 const a=artifact('NibBidMarket');if((a.deployedBytecode.length-2)/2>24576)throw Error('NibBidMarket exceeds the contract size limit.');
 const initCode=encodeDeployData({abi:a.abi,bytecode:a.bytecode,args:[NIB_TOKEN,TREASURY]});
 const salt=keccak256(toHex('taptap:nibmarket:v1:'+owner.toLowerCase()));
 const address=getCreate2Address({from:CREATE2_FACTORY,salt,bytecodeHash:keccak256(initCode)});
 // The Arachnid factory takes raw calldata: salt (32 bytes) followed by the init code.
 const data=(salt+initCode.slice(2)) as `0x${string}`;
 return {chainId:56 as const,owner,treasury:TREASURY,nib:NIB_TOKEN,name:'NibBidMarket',address,salt,initCodeHash:keccak256(initCode),tx:{chainId:56 as const,from:owner,to:CREATE2_FACTORY as `0x${string}`,value:'0',data}};
}
async function run(){
 const mode=process.argv[2]||'plan',dir=path.join(os.homedir(),'.local','state','taptap'),stateFile=path.join(dir,'nib-market-deploy.json');
 const plan=marketPlan(),tx=plan.tx;
 const c=createPublicClient({chain:bsc,transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:20000})});if(await c.getChainId()!==56)throw Error('RPC is on the wrong chain.');
 const code=async(a:`0x${string}`)=>{const x=await c.getCode({address:a});return !!x&&x!=='0x';};
 const norm=(x:string,a:any)=>{const b=Buffer.from(x.slice(2),'hex');for(const refs of Object.values(a.immutableReferences||{}) as any[])for(const r of refs)b.fill(0,r.start,r.start+r.length);return '0x'+b.toString('hex');};
 const guard=async()=>{
  if(await code(plan.address))throw Error('NibBidMarket is already deployed at '+plan.address);
  if(!await code(plan.nib))throw Error('The NIB token has no code at '+plan.nib+'.');
  if(!await code(CREATE2_FACTORY))throw Error('The CREATE2 factory is missing on this chain.');
 };
 const pub={owner:plan.owner,treasury:plan.treasury,nib:plan.nib,market:{address:plan.address,salt:plan.salt,initCodeHash:plan.initCodeHash}};
 if(mode==='plan'){console.log(JSON.stringify({...pub,tx:{to:tx.to,calldataKeccak:keccak256(tx.data),bytes:(tx.data.length-2)/2},next:'No transactions sent.'},null,2));return;}
 if(mode==='verify'){
  const a=artifact('NibBidMarket'),deployed=await c.getCode({address:plan.address});
  if(!deployed||deployed==='0x'||norm(deployed,a)!==a.deployedBytecode)throw Error('Runtime bytecode differs from reviewed source or not deployed.');
  const abi=parseAbi(['function nib() view returns(address)','function treasury() view returns(address)','function paused() view returns(bool)','function bidNonce() view returns(uint256)']);
  const [n,t,paused]=await Promise.all(['nib','treasury','paused'].map(fn=>c.readContract({address:plan.address,abi,functionName:fn} as any)));
  if(String(n).toLowerCase()!==plan.nib.toLowerCase()||String(t).toLowerCase()!==TREASURY.toLowerCase())throw Error('Immutables differ from the approved deployment.');
  console.log(JSON.stringify({verified:true,paused,...pub,next:'Set NIB_BID_MARKET to the market address and NIB_MARKET_FROM_BLOCK to the deployment block (BscScan, "Contract Creator" tx).'},null,2));return;
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
  console.log(JSON.stringify({status:result.status,transactionHash:result.txHash||result.transactionHash,market:plan.address,next:'Confirm the receipt on BscScan, then run verify. Never execute an uncertain deployment twice.'},null,2));return;
 }
 if(mode!=='preview')throw Error('Unknown mode '+mode);
 const w=wallet();if(w.toLowerCase()!==TREASURY.toLowerCase())throw Error('Connected wallet '+w+' is not the treasury.');
 await guard();
 const [gas,gasPrice,balance]=await Promise.all([c.estimateGas({account:TREASURY,to:tx.to,data:tx.data,value:0n}),c.getGasPrice(),c.getBalance({address:TREASURY})]);
 const p=baw(['contract-call','preview','--binanceChainId','56','--from',TREASURY,'--to',tx.to,'--value','0','--inputData',tx.data]);if(!p.requestId)throw Error('Binance did not return a usable preview.');
 const n=Number(p.expiresAt);p.expiresAt=Number.isFinite(n)?(n<1e12?n*1000:n):Date.now()+180000;
 const summary={what:'Deploy NibBidMarket(nib, treasury) via CREATE2',to:tx.to,value:'0 BNB',calldataKeccak:keccak256(tx.data),calldataBytes:(tx.data.length-2)/2,resultAddress:plan.address,estimatedGas:gas.toString(),gasPriceGwei:(Number(gasPrice)/1e9).toFixed(3),estimatedCostBnb:formatEther(gas*gasPrice),treasuryBalanceBnb:formatEther(balance)};
 fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(stateFile,JSON.stringify({tx:{...tx},calldataKeccak:keccak256(tx.data),summary,preview:p}),{mode:0o600});
 console.log(JSON.stringify({summary,preview:{requestId:p.requestId,expiresAt:new Date(p.expiresAt).toISOString(),risks:p.risks,authorityChanges:p.authorityChanges,requireConfirmation:p.requireConfirmation},next:'Show the user this preview. Execute only after explicit approval: npx tsx scripts/nib-market-deploy.ts execute --approve-deployment (within the preview window).'},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
