import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import solc from 'solc';
import {createWalletClient,createPublicClient,http,parseEther,decodeEventLog,zeroAddress,encodeFunctionData} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {vaultV2Mocks} from './helpers/vault-v2-mocks';

const vaultArt=()=>JSON.parse(fs.readFileSync('artifacts/NibVaultV2.json','utf8'));
let mocksOut:any;
function mocks(){if(mocksOut)return mocksOut;const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Mocks.sol':{content:vaultV2Mocks}},settings:{evmVersion:'paris',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:(p:string)=>({contents:fs.readFileSync('node_modules/'+p,'utf8')})}));if(out.errors?.some((e:any)=>e.severity==='error'))throw Error(out.errors.map((e:any)=>e.formattedMessage).join('\n'));return mocksOut=out.contracts['Mocks.sol'];}

async function chain(){
 const server=ganache.server({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:6,defaultBalance:100000},miner:{blockGasLimit:30000000}});await server.listen(0,'127.0.0.1');
 const rpc='http://127.0.0.1:'+(server.address() as any).port,c:any={id:56,name:'Local BNB fixture',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:{default:{http:[rpc]}}};
 const accounts=Object.values(server.provider.getInitialAccounts()).map((a:any)=>privateKeyToAccount(a.secretKey));
 const wallets=accounts.map(account=>createWalletClient({account,chain:c,transport:http(rpc)})),client=createPublicClient({chain:c,transport:http(rpc)}),m=mocks();
 const deploy=async(a:any,args:any[]=[],who=0)=>{const hash=await wallets[who].deployContract({account:accounts[who],chain:c,abi:a.abi,bytecode:a.bytecode||'0x'+a.evm.bytecode.object,args} as any);const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success'||!r.contractAddress)throw Error('deploy reverted');return {address:r.contractAddress,receipt:r};};
 const write=async(address:any,abi:any,functionName:string,args:any[]=[],who=0,value=0n)=>{const hash=await wallets[who].writeContract({address,abi,functionName,args,value} as any);const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw Error('Transaction reverted');return r;};
 const read=(address:any,abi:any,functionName:string,args:any[]=[])=>client.readContract({address,abi,functionName,args} as any) as Promise<any>;
 return {server,client,accounts,wallets,m,deploy,write,read,rpc,chain:c,async close(){await server.close();}};
}
// Ganache reports string reasons in the message but custom errors only as raw data, so decode both from an eth_call replay.
import {decodeErrorResult,encodeFunctionData as enc} from 'viem';
async function revertText(f:any,vault:string,abi:any,fn:string,args:any[],who:number){
 try{await f.client.call({account:f.accounts[who].address,to:vault,data:enc({abi,functionName:fn,args})});return 'NO REVERT';}
 catch(e:any){let d:any;e.walk((x:any)=>{if(typeof x?.data==='string'&&x.data.startsWith('0x')){d=x.data;return true;}return false;});
  if(!d)return String(e.details||e.message);try{const r=decodeErrorResult({abi,data:d});return r.errorName+' '+(r.args||[]).join(' ');}catch{return d;}}
}
const logs=(r:any,abi:any)=>r.logs.map((l:any)=>{try{return decodeEventLog({abi,data:l.data,topics:l.topics}) as any}catch{return null}}).filter(Boolean);

test('NibVaultV2: treasury-managed vault: deposits, immediate liquidity, removal, withdrawals, ownership',async t=>{
 const f=await chain(),va=vaultArt(),m=f.m;
 const treasury=f.accounts[0].address,anyone=f.accounts[1].address,donor=f.accounts[2].address,heir=f.accounts[3].address;
 try{
 const nib=(await f.deploy(m.MockERC20,['NIB Token','NIB'])).address,usdt=(await f.deploy(m.MockERC20,['Tether','USDT'])).address,wbnb=(await f.deploy(m.MockWBNB)).address,router=(await f.deploy(m.MockV2Router,[wbnb])).address;
 const erc=m.MockERC20.abi,E=parseEther;
 await f.write(nib,erc,'mint',[treasury,E('1000000')]);await f.write(usdt,erc,'mint',[treasury,E('1000000')]);await f.write(usdt,erc,'mint',[donor,E('5000')]);await f.write(nib,erc,'mint',[donor,E('5000')]);
 const bal=(token:string,who:string)=>f.read(token,erc,'balanceOf',[who]) as Promise<bigint>;
 const bnbOf=(who:string)=>f.client.getBalance({address:who as any});
 const gasOf=(r:any)=>r.gasUsed*r.effectiveGasPrice;
 const dl=async(extra=600n)=>BigInt((await f.client.getBlock()).timestamp)+extra;

 await t.test('constructor guards and immutables',async()=>{
  await assert.rejects(f.deploy(va,[zeroAddress,usdt,router,treasury]),/Missing token\/router/);
  await assert.rejects(f.deploy(va,[nib,nib,router,treasury]),/Duplicate token/);
  await assert.rejects(f.deploy(va,[nib,wbnb,router,treasury]),/Duplicate token/);
  await assert.rejects(f.deploy(va,[nib,usdt,router,zeroAddress]),/revert/i);
 });
 const deployed=await f.deploy(va,[nib,usdt,router,treasury]),vault=deployed.address;
 const rd=(n:string,a:any[]=[])=>f.read(vault,va.abi,n,a);
 const wr=(n:string,a:any[],who=0,value=0n)=>f.write(vault,va.abi,n,a,who,value);
 const addBNB=async(nd:bigint,bd:bigint,nm:bigint,bm:bigint,who=0,deadline?:bigint)=>wr('addLiquidityBNB',[nd,bd,nm,bm,deadline??await dl()],who);
 const addUSDT=async(nd:bigint,ud:bigint,nm:bigint,um:bigint,who=0,deadline?:bigint)=>wr('addLiquidityUSDT',[nd,ud,nm,um,deadline??await dl()],who);

 await t.test('immutable NIB, owner is the treasury, nothing else is configurable',async()=>{
  assert.equal((await rd('nib')).toLowerCase(),nib.toLowerCase());assert.equal((await rd('usdt')).toLowerCase(),usdt.toLowerCase());assert.equal((await rd('wbnb')).toLowerCase(),wbnb.toLowerCase());assert.equal((await rd('router')).toLowerCase(),router.toLowerCase());
  assert.equal((await rd('owner')).toLowerCase(),treasury.toLowerCase());
  const names=va.abi.filter((x:any)=>x.type==='function').map((x:any)=>x.name).sort();
  assert.deepEqual(names,['MAX_DEADLINE','acceptOwnership','addLiquidityBNB','addLiquidityUSDT','balances','depositToken','lpBalanceBNB','lpBalanceUSDT','nib','owner','pairBNB','pairUSDT','pendingOwner','removeLiquidityBNB','removeLiquidityUSDT','renounceOwnership','router','transferOwnership','usdt','wbnb','withdrawAll','withdrawBNB','withdrawToken'].sort(),'The ABI contains exactly the documented functions: no setToken/propose/activate/timelock, no generic call, no arbitrary recipient.');
  assert.equal(va.abi.filter((x:any)=>x.type==='function'&&/propose|activate|delay|setToken|execute|call|upgrade|pause/i.test(x.name)).length,0);
 });

 await t.test('anyone can deposit BNB, USDT, NIB and any token, with events',async()=>{
  const hash=await f.wallets[2].sendTransaction({to:vault,value:E('3')} as any);const rec=await f.client.waitForTransactionReceipt({hash});
  const ev=logs(rec,va.abi).find((l:any)=>l.eventName==='NativeReceived');assert.equal(ev.args.from.toLowerCase(),donor.toLowerCase());assert.equal(ev.args.amount,E('3'));
  await f.write(usdt,erc,'approve',[vault,E('1000')],2);await f.write(nib,erc,'approve',[vault,E('1000')],2);
  const d1=await wr('depositToken',[usdt,E('1000')],2),d2=await wr('depositToken',[nib,E('1000')],2);
  assert.equal(logs(d1,va.abi).find((l:any)=>l.eventName==='TokenDeposited').args.amount,E('1000'));assert.equal(logs(d2,va.abi).find((l:any)=>l.eventName==='TokenDeposited').args.token.toLowerCase(),nib.toLowerCase());
  await assert.rejects(wr('depositToken',[usdt,0n],2),/Invalid deposit/);await assert.rejects(wr('depositToken',[zeroAddress,1n],2),/Invalid deposit/);
  // The treasury funds the vault too (plain transfers).
  await f.write(nib,erc,'transfer',[vault,E('199000')]);await f.write(usdt,erc,'transfer',[vault,E('9000')]);
  const [bnb,w,u,n]=await rd('balances');assert.deepEqual([bnb,w,u,n],[E('3'),0n,E('10000'),E('200000')]);
 });

 await t.test('only the owner can manage liquidity and withdraw',async()=>{
  const d=await dl();
  for(const [fn,args] of [['addLiquidityBNB',[1n,1n,1n,1n,d]],['addLiquidityUSDT',[1n,1n,1n,1n,d]],['removeLiquidityBNB',[1n,1n,1n,d]],['removeLiquidityUSDT',[1n,1n,1n,d]],['withdrawToken',[nib,1n]],['withdrawBNB',[1n]],['withdrawAll',[[nib]]],['transferOwnership',[anyone]]] as any)
   assert.match(await revertText(f,vault,va.abi,fn,args,1),/OwnableUnauthorizedAccount/,fn);
 });

 await t.test('liquidity can be added immediately: no delay, no activation step, LP stays in the vault',async()=>{
  // Same block window as deployment: nothing to wait for.
  const before=await bnbOf(vault);
  const r=await addBNB(E('100000'),E('2'),E('100000'),E('2'));
  const pair=await rd('pairBNB');assert.notEqual(pair,zeroAddress);
  const ev=logs(r,va.abi).find((l:any)=>l.eventName==='LiquidityAddedBNB');assert.equal(ev.args.nibAmount,E('100000'));assert.equal(ev.args.bnbAmount,E('2'));assert.equal(ev.args.pair.toLowerCase(),pair.toLowerCase());
  assert.equal(await rd('lpBalanceBNB'),ev.args.lpTokens);assert.equal(await bal(pair,vault),ev.args.lpTokens);assert.equal(await bal(pair,treasury),0n,'LP is held by the vault, not the treasury');
  assert.equal(await bnbOf(vault),before-E('2'));
  assert.equal(await f.read(nib,erc,'allowance',[vault,router]),0n,'router NIB approval is reset');
  const u=await addUSDT(E('50000'),E('5000'),E('50000'),E('5000'));const ev2=logs(u,va.abi).find((l:any)=>l.eventName==='LiquidityAddedUSDT');
  assert.equal(ev2.args.usdtAmount,E('5000'));assert.equal(await rd('lpBalanceUSDT'),ev2.args.lpTokens);
  assert.equal(await f.read(usdt,erc,'allowance',[vault,router]),0n);assert.equal(await f.read(nib,erc,'allowance',[vault,router]),0n);
 });

 await t.test('an unbalanced second add refunds the unused BNB to the vault, never elsewhere',async()=>{
  const nibBefore=await bal(nib,vault),bnbBefore=await bnbOf(vault);
  // Pool ratio is 50000 NIB per BNB; offering 10000 NIB with 1 BNB uses only 0.2 BNB.
  const r=await addBNB(E('10000'),E('1'),E('10000'),E('0.2'));
  const ev=logs(r,va.abi).find((l:any)=>l.eventName==='LiquidityAddedBNB');assert.equal(ev.args.bnbAmount,E('0.2'));
  assert.equal(await bnbOf(vault),bnbBefore-E('0.2'),'only 0.2 BNB left the vault; the rest was refunded to it');
  assert.equal(await bal(nib,vault),nibBefore-E('10000'));
  assert.ok(logs(r,va.abi).some((l:any)=>l.eventName==='NativeReceived'),'refund is logged');
 });

 await t.test('guards: minimums, deadline, balance, slippage',async()=>{
  await assert.rejects(addBNB(1n,1n,0n,1n),/Invalid minimums/);await assert.rejects(addBNB(1n,1n,1n,0n),/Invalid minimums/);await assert.rejects(addBNB(1n,1n,2n,1n),/Invalid minimums/);
  await assert.rejects(addUSDT(1n,1n,0n,1n),/Invalid minimums/);
  const now=BigInt((await f.client.getBlock()).timestamp);
  await assert.rejects(addBNB(E('1'),E('0.01'),E('1'),E('0.01'),0,now-1n),/Invalid deadline/);await assert.rejects(addBNB(E('1'),E('0.01'),E('1'),E('0.01'),0,now+4000n),/Invalid deadline/);
  await assert.rejects(addBNB(E('1'),E('1000000'),E('1'),E('0.01')),/Insufficient BNB/);
  await f.wallets[2].sendTransaction({to:vault,value:E('5')} as any);
  assert.match(await revertText(f,vault,va.abi,'addLiquidityBNB',[E('10000'),E('1'),E('10000'),E('1'),await dl()],0),/INSUFFICIENT_B_AMOUNT/,'router slippage minimum protects the vault');
 });

 await t.test('remove liquidity returns both assets to the vault (not the owner) until withdrawn',async()=>{
  const lp=await rd('lpBalanceBNB') as bigint,pair=await rd('pairBNB');
  const nibBefore=await bal(nib,vault),bnbBefore=await bnbOf(vault),treasuryNib=await bal(nib,treasury);
  await assert.rejects(wr('removeLiquidityBNB',[lp+1n,1n,1n,await dl()]),/revert/i);
  await assert.rejects(wr('removeLiquidityBNB',[0n,1n,1n,await dl()]),/Invalid amounts/);await assert.rejects(wr('removeLiquidityBNB',[lp,0n,1n,await dl()]),/Invalid amounts/);
  await assert.rejects(wr('removeLiquidityBNB',[lp,E('999999999'),1n,await dl()]),/INSUFFICIENT_A_AMOUNT/i);
  const half=lp/2n,r=await wr('removeLiquidityBNB',[half,1n,1n,await dl()]);
  const ev=logs(r,va.abi).find((l:any)=>l.eventName==='LiquidityRemovedBNB');assert.equal(ev.args.lpTokens,half);
  assert.equal(await bal(nib,vault),nibBefore+ev.args.nibAmount);assert.equal(await bnbOf(vault),bnbBefore+ev.args.bnbAmount);assert.equal(await bal(nib,treasury),treasuryNib);
  assert.equal(await bal(pair,vault),lp-half);assert.equal(await f.read(pair,erc,'allowance',[vault,router]),0n);
  // USDT pair, all of it
  const ulp=await rd('lpBalanceUSDT') as bigint,ur=await wr('removeLiquidityUSDT',[ulp,1n,1n,await dl()]);
  const uev=logs(ur,va.abi).find((l:any)=>l.eventName==='LiquidityRemovedUSDT');assert.equal(await rd('lpBalanceUSDT'),0n);assert.ok(uev.args.usdtAmount>0n);
  await assert.rejects(wr('removeLiquidityUSDT',[1n,1n,1n,await dl()]),/revert/i);
 });

 await t.test('withdrawals always go to the owner: tokens, BNB, WBNB and LP tokens',async()=>{
  const pair=await rd('pairBNB'),lp=await rd('lpBalanceBNB') as bigint;
  // LP token withdrawal
  const r=await wr('withdrawToken',[pair,lp]);const ev=logs(r,va.abi).find((l:any)=>l.eventName==='TokenWithdrawn');assert.equal(ev.args.to.toLowerCase(),treasury.toLowerCase());assert.equal(ev.args.amount,lp);
  assert.equal(await bal(pair,treasury),lp);assert.equal(await rd('lpBalanceBNB'),0n);
  // NIB, USDT
  const nv=await bal(nib,vault),tb=await bal(nib,treasury);await wr('withdrawToken',[nib,nv/2n]);assert.equal(await bal(nib,treasury),tb+nv/2n);
  await assert.rejects(wr('withdrawToken',[nib,0n]),/Invalid withdrawal/);await assert.rejects(wr('withdrawToken',[zeroAddress,1n]),/Invalid withdrawal/);await assert.rejects(wr('withdrawToken',[nib,nv*2n]),/revert/i);
  // BNB
  const bv=await bnbOf(vault),b0=await bnbOf(treasury),rr=await wr('withdrawBNB',[E('0.5')]);assert.equal(await bnbOf(treasury),b0+E('0.5')-gasOf(rr));assert.equal(await bnbOf(vault),bv-E('0.5'));
  assert.equal(logs(rr,va.abi).find((l:any)=>l.eventName==='NativeWithdrawn').args.amount,E('0.5'));
  await assert.rejects(wr('withdrawBNB',[0n]),/Invalid withdrawal/);await assert.rejects(wr('withdrawBNB',[bv*2n]),/Invalid withdrawal/);
  // WBNB sent to the vault is recoverable too
  await f.write(wbnb,m.MockWBNB.abi,'deposit',[],2,E('1'));await f.write(wbnb,erc,'transfer',[vault,E('1')],2);assert.equal((await rd('balances'))[1],E('1'));
  await wr('withdrawToken',[wbnb,E('1')]);assert.equal(await bal(wbnb,treasury),E('1'));
  // Arbitrary stray token sent by mistake is recoverable
  const stray=(await f.deploy(m.MockERC20,['Stray','STR'])).address;await f.write(stray,erc,'mint',[vault,E('7')]);await wr('withdrawToken',[stray,E('7')]);assert.equal(await bal(stray,treasury),E('7'));
 });

 await t.test('withdrawAll empties BNB and every listed token in one call',async()=>{
  await f.write(usdt,erc,'transfer',[vault,E('11')]);await f.wallets[2].sendTransaction({to:vault,value:E('1')} as any);
  const r=await wr('withdrawAll',[[nib,usdt,wbnb]]);
  const [bnb,w,u,n]=await rd('balances');assert.deepEqual([bnb,w,u,n],[0n,0n,0n,0n]);
  assert.ok(logs(r,va.abi).filter((l:any)=>l.eventName==='TokenWithdrawn').length>=2);assert.ok(logs(r,va.abi).some((l:any)=>l.eventName==='NativeWithdrawn'));
  await wr('withdrawAll',[[]]);// empty vault: harmless no-op
 });

 await t.test('ownership: renounce is disabled, transfer is two-step, funds follow the new owner',async()=>{
  await assert.rejects(wr('renounceOwnership',[]),/Renounce disabled/);
  await f.wallets[2].sendTransaction({to:vault,value:E('2')} as any);
  await wr('transferOwnership',[heir]);assert.equal((await rd('owner')).toLowerCase(),treasury.toLowerCase());assert.equal((await rd('pendingOwner')).toLowerCase(),heir.toLowerCase());
  await assert.rejects(wr('acceptOwnership',[],1),/revert/);
  assert.match(await revertText(f,vault,va.abi,'acceptOwnership',[],1),/OwnableUnauthorizedAccount/);
  await wr('acceptOwnership',[],3);assert.equal((await rd('owner')).toLowerCase(),heir.toLowerCase());
  assert.match(await revertText(f,vault,va.abi,'withdrawBNB',[1n],0),/OwnableUnauthorizedAccount/);
  const b0=await bnbOf(heir),r=await wr('withdrawBNB',[E('2')],3);assert.equal(await bnbOf(heir),b0+E('2')-gasOf(r));
 });

 await t.test('a BNB withdrawal that the owner contract rejects reverts without losing funds',async()=>{
  const ro=(await f.deploy(m.RejectingOwner)).address;
  await wr('transferOwnership',[ro],3);await f.write(ro,m.RejectingOwner.abi,'acceptOwnership',[vault]);assert.equal((await rd('owner')).toLowerCase(),ro.toLowerCase());
  await f.wallets[2].sendTransaction({to:vault,value:E('1')} as any);
  const call=(fn:string,args:any[])=>{return f.write(ro,m.RejectingOwner.abi,'call',[vault,encodeFunctionData({abi:va.abi,functionName:fn,args})]);};
  await assert.rejects(call('withdrawBNB',[E('1')]),/BNB transfer failed/);assert.equal(await bnbOf(vault),E('1'));
  await f.write(ro,m.RejectingOwner.abi,'setReject',[false]);await call('withdrawBNB',[E('1')]);assert.equal(await bnbOf(vault),0n);
 });
 }finally{await f.close();}
});

// Optional BSC mainnet-fork check against the real PancakeSwap V2 router, WBNB, USDT and the real NIB token / treasury.
// Set NIB_FORK_RPC to a BSC RPC URL (for example https://bsc-dataseed.bnbchain.org) to run it. Nothing is broadcast: it runs on an in-memory fork.
const FORK=process.env.NIB_FORK_RPC;
test('NibVaultV2 on a BSC mainnet fork: real PancakeSwap V2 add / remove / withdraw with the real treasury',{skip:!FORK&&'set NIB_FORK_RPC to run the mainnet-fork test',timeout:300000},async()=>{
 const TREASURY='0x0D96e8Aa89c196D3b1b0100cDAe3b931e8a0eC0d',NIB='0x1F11d9feAF354aD31861B4fa26759349e2860cFb',ROUTER='0x10ED43C718714eb63d5aA57B78B54704E256024E',USDT='0x55d398326f99059fF775485246999027B3197955',WBNB='0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
 const USDT_WHALE='0xF977814e90dA44bFA03b6295A0616a897441aceC';// large public USDT holder, only impersonated on the in-memory fork
 const server=ganache.server({logging:{quiet:true},chain:{chainId:56},fork:{url:FORK!},wallet:{unlockedAccounts:[TREASURY,USDT_WHALE],totalAccounts:2},miner:{blockGasLimit:30000000}});await server.listen(0,'127.0.0.1');
 const rpc='http://127.0.0.1:'+(server.address() as any).port,c:any={id:56,name:'fork',nativeCurrency:{name:'BNB',symbol:'BNB',decimals:18},rpcUrls:{default:{http:[rpc]}}};
 const client=createPublicClient({chain:c,transport:http(rpc)}),va=vaultArt();
 const treasury=createWalletClient({account:TREASURY as any,chain:c,transport:http(rpc)});
 const e20=[{type:'function',name:'balanceOf',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]},{type:'function',name:'transfer',stateMutability:'nonpayable',inputs:[{type:'address'},{type:'uint256'}],outputs:[{type:'bool'}]}] as const;
 const send=async(fn:()=>Promise<`0x${string}`>,label:string)=>{const r=await client.waitForTransactionReceipt({hash:await fn()});assert.equal(r.status,'success',label);console.log('fork gas',label,r.gasUsed.toString());return r;};
 const tx=(address:any,abi:any,functionName:string,args:any[]=[],value=0n)=>send(()=>treasury.writeContract({address,abi,functionName,args,value,gas:8_000_000n} as any),functionName);
 const bal=(token:string,who:string)=>client.readContract({address:token as any,abi:e20,functionName:'balanceOf',args:[who as any]}) as Promise<bigint>;
 try{
  await server.provider.request({method:'evm_setAccountBalance',params:[TREASURY,'0x'+(1000n*10n**18n).toString(16)]} as any);
  const nibHeld=await bal(NIB,TREASURY);assert.ok(nibHeld>=parseEther('2000000'),'the treasury holds the NIB on the fork: '+nibHeld);
  const dep=await send(()=>treasury.deployContract({abi:va.abi,bytecode:va.bytecode,args:[NIB,USDT,ROUTER,TREASURY],gas:5_000_000n} as any),'deploy NibVaultV2');
  const vault=dep.contractAddress!,rd=(n:string,a:any[]=[])=>client.readContract({address:vault,abi:va.abi,functionName:n,args:a}) as Promise<any>;
  assert.equal((await rd('wbnb')).toLowerCase(),WBNB.toLowerCase());assert.equal((await rd('owner')).toLowerCase(),TREASURY.toLowerCase());
  // Fund the vault: NIB and USDT from the treasury; BNB by a plain transfer.
  const nibIn=parseEther('1000000'),bnbIn=parseEther('1'),dl=async()=>(await client.getBlock()).timestamp+600n;
  await tx(NIB,e20,'transfer',[vault,nibIn*2n]);
  await send(()=>treasury.sendTransaction({to:vault,value:bnbIn*3n,gas:100000n} as any),'deposit BNB');
  // NIB/BNB: immediately after deploy, no delay
  await tx(vault,va.abi,'addLiquidityBNB',[nibIn,bnbIn,nibIn*99n/100n,bnbIn*99n/100n,await dl()]);
  const lpBNB=await rd('lpBalanceBNB') as bigint;assert.ok(lpBNB>0n);assert.notEqual(await rd('pairBNB'),zeroAddress);
  // NIB/USDT: a public USDT whale (impersonated on the fork only) tops the vault up, as any depositor could.
  const whale=createWalletClient({account:USDT_WHALE as any,chain:c,transport:http(rpc)});
  await server.provider.request({method:'evm_setAccountBalance',params:[USDT_WHALE,'0x'+(10n*10n**18n).toString(16)]} as any);
  await send(()=>whale.writeContract({address:USDT,abi:e20,functionName:'transfer',args:[vault,parseEther('10')],gas:200000n} as any),'whale USDT deposit');
  await tx(vault,va.abi,'addLiquidityUSDT',[parseEther('100000'),parseEther('10'),parseEther('99000'),parseEther('9.9'),await dl()]);
  const lpU=await rd('lpBalanceUSDT') as bigint;assert.ok(lpU>0n);assert.notEqual(await rd('pairUSDT'),zeroAddress);
  await tx(vault,va.abi,'removeLiquidityUSDT',[lpU,1n,1n,await dl()]);assert.equal(await rd('lpBalanceUSDT'),0n);
  // remove half, withdraw LP + proceeds to the treasury
  await tx(vault,va.abi,'removeLiquidityBNB',[lpBNB/2n,1n,1n,await dl()]);
  const pair=await rd('pairBNB'),lpLeft=await rd('lpBalanceBNB') as bigint;assert.ok(lpLeft>0n&&lpLeft<lpBNB);
  const nibBefore=await bal(NIB,TREASURY);
  await tx(vault,va.abi,'withdrawAll',[[NIB,USDT,WBNB,pair]]);
  assert.equal(await bal(pair,TREASURY),lpLeft,'remaining LP withdrawn to the treasury');assert.ok(await bal(NIB,TREASURY)>nibBefore);
  const [bnb,w,u,n]=await rd('balances');assert.deepEqual([bnb,w,u,n],[0n,0n,0n,0n]);
 }finally{await server.close();}
});
