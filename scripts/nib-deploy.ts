// NIB token + airdrop deployment via the Binance agentic wallet (baw). Never broadcasts without --approve-deployment.
// Usage: npx tsx scripts/nib-deploy.ts plan|preview|execute|verify [--step 1|2|3|4 (4 = open season 1)] [--approve-deployment]
// Steps: 1 NibAirdrop(owner=treasury, signer) · 2 NibToken(airdrop, treasury) · 3 airdrop.setToken(token)
// Deploys use the Arachnid CREATE2 factory, so every address is known before any tx is sent.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
import {createPublicClient,http,encodeDeployData,encodeFunctionData,getCreate2Address,keccak256,toHex,concatHex,parseAbi,formatEther} from 'viem';import {bsc} from 'viem/chains';import {privateKeyToAccount} from 'viem/accounts';
export const CREATE2_FACTORY='0x4e59b44847b379578588920cA78FbF26c0B4956C' as const;
export const TREASURY='0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d' as const;
const SIGNER_FILE=process.env.NIB_SIGNER_FILE||'/workspace/secrets/nib_signer.txt';
const artifact=(n:string)=>JSON.parse(fs.readFileSync('artifacts/'+n+'.json','utf8'));
const E18=10n**18n;
export function signerAddress(){const k=fs.readFileSync(SIGNER_FILE,'utf8').trim() as `0x${string}`;return privateKeyToAccount(k).address;}// the key itself is never printed
export function nibPlan(owner:`0x${string}`,signer:`0x${string}`){
 const mk=(name:string,args:any[])=>{const a=artifact(name);if((a.deployedBytecode.length-2)/2>24576)throw Error(name+' exceeds the contract size limit.');const initCode=encodeDeployData({abi:a.abi,bytecode:a.bytecode,args});const salt=keccak256(toHex('taptap:nib:v1:'+owner.toLowerCase()+':'+name));const address=getCreate2Address({from:CREATE2_FACTORY,salt,bytecodeHash:keccak256(initCode)});return {name,address,salt,initCodeHash:keccak256(initCode),callData:concatHex([salt,initCode])};};
 const airdrop=mk('NibAirdrop',[owner,signer]),token=mk('NibToken',[airdrop.address,TREASURY]);
 const setToken=encodeFunctionData({abi:artifact('NibAirdrop').abi,functionName:'setToken',args:[token.address]});
 const openSeason=encodeFunctionData({abi:artifact('NibAirdrop').abi,functionName:'openNextSeason',args:[]});
 const tx=(step:number)=>step===4?{to:airdrop.address,data:openSeason}:step===1?{to:CREATE2_FACTORY,data:airdrop.callData}:step===2?{to:CREATE2_FACTORY,data:token.callData}:{to:airdrop.address,data:setToken};
 return {chainId:56 as const,owner,signer,treasury:TREASURY,airdrop,token,tx:(s:number)=>({chainId:56 as const,from:owner,value:'0',...tx(s)})};
}
export const baw=(args:string[])=>{const r=spawnSync('baw',[...args,'--json'],{encoding:'utf8',maxBuffer:8*1024*1024});let d;try{d=JSON.parse(r.stdout)}catch{throw Error('Binance CLI returned no readable result.');}if(r.status||!d.success)throw Error(d.error?.message||r.stderr||'Binance operation failed.');return d.data;};
export function wallet(){if(baw(['wallet','status']).status!=='CONNECTED')throw Error('Sign in to Binance Agentic Wallet first.');const s=baw(['wallet','settings']),raw=s.devMode?.expiresAt,n=Number(raw),expiry=typeof raw==='string'&&!/^\d+$/.test(raw)?Date.parse(raw):n<1e12?n*1000:n;if(!s.devMode?.enabled||!Number.isFinite(expiry)||expiry<=Date.now())throw Error('Enable Developer Mode before previewing a deployment.');const a=baw(['wallet','address']).addresses.find((x:any)=>String(x.binanceChainId)==='56')?.address;if(!a)throw Error('BNB Chain wallet unavailable.');return a as `0x${string}`;}
async function run(){
 const mode=process.argv[2]||'plan',si=process.argv.indexOf('--step'),step=si>=0?Number(process.argv[si+1]):0;
 const dir=path.join(os.homedir(),'.local','state','taptap'),stateFile=(s:number)=>path.join(dir,'nib-deploy-step'+s+'.json');
 const plan=nibPlan(TREASURY,signerAddress());
 const c=createPublicClient({chain:bsc,transport:http(process.env.BSC_RPC_URL||'https://bsc-dataseed.bnbchain.org',{timeout:20000})});if(await c.getChainId()!==56)throw Error('RPC is on the wrong chain.');
 const code=async(a:`0x${string}`)=>{const x=await c.getCode({address:a});return !!x&&x!=='0x';};
 const norm=(x:string,a:any)=>{const b=Buffer.from(x.slice(2),'hex');for(const refs of Object.values(a.immutableReferences||{}) as any[])for(const r of refs)b.fill(0,r.start,r.start+r.length);return '0x'+b.toString('hex');};
 const same=async(a:any)=>norm((await c.getCode({address:a.address}))!,artifact(a.name))===artifact(a.name).deployedBytecode;
 const abi=artifact('NibAirdrop').abi,tabi=parseAbi(['function balanceOf(address) view returns(uint256)']);
 const guard=async(s:number)=>{
  if(s===1&&await code(plan.airdrop.address))throw Error('NibAirdrop is already deployed at '+plan.airdrop.address);
  if(s===2){if(!await code(plan.airdrop.address)||!await same(plan.airdrop))throw Error('Step 1 not done: NibAirdrop missing or runtime code differs.');if(await code(plan.token.address))throw Error('NibToken is already deployed.');}
  if(s===4){const [t,cur,paused]=await Promise.all([c.readContract({address:plan.airdrop.address,abi,functionName:'token'} as any),c.readContract({address:plan.airdrop.address,abi,functionName:'currentSeason'} as any),c.readContract({address:plan.airdrop.address,abi,functionName:'paused'} as any)]);if(/^0x0{40}$/.test(String(t)))throw Error('Token not set yet (step 3).');if(Number(cur)!==0)throw Error('Season '+cur+' is already opened. Opening the next one needs the previous to have ended.');if(paused)throw Error('Airdrop is paused.');}
  if(s===3){if(!await code(plan.token.address)||!await same(plan.token))throw Error('Step 2 not done: NibToken missing or runtime code differs.');
   const bal=await c.readContract({address:plan.token.address,abi:tabi,functionName:'balanceOf',args:[plan.airdrop.address]});if(bal<800_000_000n*E18)throw Error('Airdrop does not hold 800M NIB.');
   const t=await c.readContract({address:plan.airdrop.address,abi,functionName:'token'} as any);if(!/^0x0{40}$/.test(String(t)))throw Error('Token already set.');}
 };
 const pub={owner:plan.owner,signer:plan.signer,treasury:plan.treasury,airdrop:{address:plan.airdrop.address,initCodeHash:plan.airdrop.initCodeHash},token:{address:plan.token.address,initCodeHash:plan.token.initCodeHash}};
 if(mode==='plan'){console.log(JSON.stringify({...pub,steps:[1,2,3,4].map(s=>{const t=plan.tx(s);return {step:s,to:t.to,calldataKeccak:keccak256(t.data),bytes:(t.data.length-2)/2};}),next:'No transactions sent.'},null,2));return;}
 if(mode==='verify'){
  if(!await same(plan.airdrop)||!await same(plan.token))throw Error('Runtime bytecode differs from reviewed source or not deployed.');
  const r=(fn:string)=>c.readContract({address:plan.airdrop.address,abi,functionName:fn} as any);const eq=(a:any,b:string)=>String(a).toLowerCase()===b.toLowerCase();
  const [o,sg,tk]=await Promise.all([r('owner'),r('signer'),r('token')]);if(!eq(o,TREASURY)||!eq(sg,plan.signer)||!eq(tk,plan.token.address))throw Error('Owner, signer or token link differs from the approved deployment.');
  const tb=await Promise.all([[plan.airdrop.address],[TREASURY]].map(a=>c.readContract({address:plan.token.address,abi:tabi,functionName:'balanceOf',args:a as any})));if(tb[0]!==800_000_000n*E18||tb[1]!==200_000_000n*E18)throw Error('Token balances differ from 800M / 200M.');
  console.log(JSON.stringify({verified:true,...pub},null,2));return;
 }
 if(![1,2,3,4].includes(step))throw Error('Pass --step 1, 2, 3 or 4.');
 const tx=plan.tx(step);
 if(mode==='execute'){
  if(!process.argv.includes('--approve-deployment'))throw Error('Review the exact preview and get explicit user approval, then pass --approve-deployment.');
  const saved=JSON.parse(fs.readFileSync(stateFile(step),'utf8'));
  if(saved.execution)throw Error('Execution was already attempted. Verify the receipt before doing anything else.');
  if(saved.preview.expiresAt<Date.now())throw Error('Preview expired. Run a fresh preview.');
  if(wallet().toLowerCase()!==TREASURY.toLowerCase()||saved.tx.from.toLowerCase()!==TREASURY.toLowerCase())throw Error('Connected wallet differs from the treasury owner.');
  if(keccak256(tx.data)!==saved.calldataKeccak||tx.to.toLowerCase()!==saved.tx.to.toLowerCase())throw Error('Source or signer changed since the preview. Run a fresh preview.');
  await guard(step);
  saved.execution={startedAt:Date.now()};fs.writeFileSync(stateFile(step),JSON.stringify(saved),{mode:0o600});
  const result=baw(['contract-call','execute','--requestId',saved.preview.requestId]);saved.execution.result=result;fs.writeFileSync(stateFile(step),JSON.stringify(saved),{mode:0o600});
  console.log(JSON.stringify({step,status:result.status,transactionHash:result.txHash||result.transactionHash,next:'Confirm the receipt on BscScan, then preview the next step. Never execute an uncertain step twice.'},null,2));return;
 }
 if(mode!=='preview')throw Error('Unknown mode '+mode);
 const w=wallet();if(w.toLowerCase()!==TREASURY.toLowerCase())throw Error('Connected wallet '+w+' is not the treasury owner.');
 await guard(step);
 const [gas,gasPrice,balance]=await Promise.all([c.estimateGas({account:TREASURY,to:tx.to,data:tx.data as `0x${string}`,value:0n}),c.getGasPrice(),c.getBalance({address:TREASURY})]);
 const p=baw(['contract-call','preview','--binanceChainId','56','--from',TREASURY,'--to',tx.to,'--value','0','--inputData',tx.data]);if(!p.requestId)throw Error('Binance did not return a usable preview.');
 const n=Number(p.expiresAt);p.expiresAt=Number.isFinite(n)?(n<1e12?n*1000:n):Date.now()+180000;
 const summary={step,what:['','Deploy NibAirdrop(owner=treasury, signer)','Deploy NibToken(airdrop, treasury)','airdrop.setToken(token)','airdrop.openNextSeason() (opens season 1)'][step],to:tx.to,value:'0 BNB',calldataKeccak:keccak256(tx.data),calldataBytes:(tx.data.length-2)/2,resultAddress:step===1?plan.airdrop.address:step===2?plan.token.address:null,estimatedGas:gas.toString(),gasPriceGwei:formatEther(gasPrice*1000000000n),estimatedNetworkFeeBNB:formatEther(gas*gasPrice),walletBNBBalance:formatEther(balance),...pub};
 fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(stateFile(step),JSON.stringify({tx:{...tx},calldataKeccak:keccak256(tx.data),summary,preview:p}),{mode:0o600});
 console.log(JSON.stringify({summary,preview:{requestId:p.requestId,expiresAt:new Date(p.expiresAt).toISOString(),risks:p.risks,authorityChanges:p.authorityChanges,requireConfirmation:p.requireConfirmation},next:'Show the user this preview. Execute only after explicit approval: npx tsx scripts/nib-deploy.ts execute --step '+step+' --approve-deployment (within the preview window).'},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
