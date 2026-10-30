import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {encodeFunctionData,parseAbi,parseUnits,parseEther} from 'viem';import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {nftChain} from './helpers/nft-chain';import {databaseFixture} from './helpers/database';import {handle} from '../lib/api';import {actionData} from '../lib/protocol';
import {parseDoArgs,validateServerTx,summarizePreview,normalizeExpiry,act,execute,runDo,status,loadJournal,saveJournal,DoError,NIB_AIRDROP,NIB_MARKET,NIB_TOKEN,type Ctx} from '../agent/do';

const W='0x1111111111111111111111111111111111111111';
const airdropAbi=parseAbi(['function claim((address wallet,uint256 season,uint256 cumulativePoints,uint256 deadline,bytes32 voucherId) v,bytes signature) returns (uint256,uint256)']);
const marketAbi=parseAbi(['function placeBid(uint256 nibAmount,uint256 bnbAmount,uint256 expiresAt) payable returns (uint256)','function cancelBid(uint256 id)','function acceptBid(uint256 id,uint256 nibAmount,uint256 minBnbOut,uint256 deadline)']);
const erc20Abi=parseAbi(['function approve(address,uint256) returns (bool)']);
const tx=(to:string,data:string,value='0')=>({chainId:56,from:W,to,value,data});

test('chat commands: argument parsing is strict',()=>{
 assert.deepEqual(parseDoArgs(['nib-bid','--bnb','0.01','--price','0.00001']),{cmd:'nib-bid',rest:[],flags:{bnb:'0.01',price:'0.00001'}});
 assert.deepEqual(parseDoArgs(['mint','--usdt','--qty','2']).flags,{usdt:true,qty:'2'});
 assert.deepEqual(parseDoArgs(['nft-buy','42']).rest,['42']);
 assert.throws(()=>parseDoArgs(['nib-bid','--bnb']),/Missing value/);
});
test('chat commands: preview summary names what, value, token changes, risks and expiry',()=>{
 const text=summarizePreview('Test',tx(NIB_MARKET,'0x','1000000000000000000'),{parsedTx:{transactionType:'x'},simulationResult:{balanceChanges:[{symbol:'BNB',amount:'-1'}]},risks:{riskDetails:[{text:'bad'}]},requireConfirmation:true,expiresAt:Date.now()+240000});
 assert.match(text,/BNB sent:\s+1 BNB/);assert.match(text,/"symbol":"BNB"/);assert.match(text,/bad/);assert.match(text,/extra confirmation/);assert.match(text,/expires/i);
 assert.ok(normalizeExpiry({expiresAt:1893456000})>1e12,'seconds are normalised to ms');
});
test('chat commands: server-built transactions are validated before any preview or execute',()=>{
 const now=Math.floor(Date.now()/1000),id='0x'+'ab'.repeat(32);
 const claim=(wallet:string,deadline:number)=>encodeFunctionData({abi:airdropAbi,functionName:'claim',args:[{wallet:wallet as `0x${string}`,season:1n,cumulativePoints:1000n,deadline:BigInt(deadline),voucherId:id as `0x${string}`},'0x'+'11'.repeat(65) as `0x${string}`]});
 assert.ok(validateServerTx(tx(NIB_AIRDROP,claim(W,now+600)),{kind:'airdrop-claim',wallet:W}));
 assert.throws(()=>validateServerTx(tx(NIB_AIRDROP,claim(W,now+600),'1'),{kind:'airdrop-claim',wallet:W}),/0 BNB/);
 assert.throws(()=>validateServerTx(tx(NIB_MARKET,claim(W,now+600)),{kind:'airdrop-claim',wallet:W}),/airdrop contract/);
 assert.throws(()=>validateServerTx(tx(NIB_AIRDROP,claim('0x2222222222222222222222222222222222222222',now+600)),{kind:'airdrop-claim',wallet:W}),/different wallet/);
 assert.throws(()=>validateServerTx(tx(NIB_AIRDROP,claim(W,now-5)),{kind:'airdrop-claim',wallet:W}),/expired/);
 assert.throws(()=>validateServerTx({...tx(NIB_AIRDROP,claim(W,now+600)),chainId:1},{kind:'airdrop-claim',wallet:W}),/chain/);
 const bnb=parseEther('0.01'),nib=parseUnits('1000',18),deposit=bnb+bnb*2n/100n;
 const bid=encodeFunctionData({abi:marketAbi,functionName:'placeBid',args:[nib,bnb,0n]});
 assert.ok(validateServerTx(tx(NIB_MARKET,bid,deposit.toString()),{kind:'nib-bid',wallet:W,bnbRaw:bnb,nibRaw:nib}));
 assert.throws(()=>validateServerTx(tx(NIB_MARKET,bid,(deposit*2n).toString()),{kind:'nib-bid',wallet:W,bnbRaw:bnb}),/bid plus the 2% buyer fee/);
 assert.throws(()=>validateServerTx(tx(NIB_MARKET,bid,deposit.toString()),{kind:'nib-bid',wallet:W,bnbRaw:bnb+1n}),/BNB amount differs/);
 const approve=(amount:bigint,spender=NIB_MARKET)=>encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[spender as `0x${string}`,amount]});
 assert.ok(validateServerTx(tx(NIB_TOKEN,approve(nib)),{kind:'nib-approve',wallet:W,amountRaw:nib}));
 assert.throws(()=>validateServerTx(tx(NIB_TOKEN,approve(2n**256n-1n)),{kind:'nib-approve',wallet:W}),/exact, bounded/,'unlimited approvals are refused');
 assert.throws(()=>validateServerTx(tx(NIB_TOKEN,approve(nib,'0x3333333333333333333333333333333333333333')),{kind:'nib-approve',wallet:W}),/pre-market only/);
 assert.throws(()=>validateServerTx(tx(NIB_TOKEN,approve(nib+1n)),{kind:'nib-approve',wallet:W,amountRaw:nib}),/differs/);
 const accept=(minOut:bigint,deadline:number)=>encodeFunctionData({abi:marketAbi,functionName:'acceptBid',args:[7n,nib,minOut,BigInt(deadline)]});
 assert.ok(validateServerTx(tx(NIB_MARKET,accept(1n,now+600)),{kind:'nib-accept',wallet:W,bidId:'7',amountRaw:nib}));
 assert.throws(()=>validateServerTx(tx(NIB_MARKET,accept(1n,now+600)),{kind:'nib-accept',wallet:W,bidId:'8'}),/differs/);
 assert.throws(()=>validateServerTx(tx(NIB_MARKET,accept(0n,now+600)),{kind:'nib-accept',wallet:W}),/minimum-BNB/);
 assert.throws(()=>validateServerTx(tx(NIB_MARKET,accept(1n,now+99999)),{kind:'nib-accept',wallet:W}),/deadline/);
 assert.ok(validateServerTx(tx(NIB_MARKET,encodeFunctionData({abi:marketAbi,functionName:'cancelBid',args:[5n]})),{kind:'nib-cancel',wallet:W,bidId:'5'}));
 assert.throws(()=>validateServerTx(tx(NIB_MARKET,encodeFunctionData({abi:marketAbi,functionName:'cancelBid',args:[5n]})),{kind:'nib-cancel',wallet:W,bidId:'6'}),/does not match/);
});

function fakeCtx(over:Partial<Ctx>={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'taptap-do-')),out:string[]=[],calls:string[][]=[];
 const ctx:Ctx={s:{sessionId:'s',wallet:W,expiresAt:Date.now()+3600000},origin:'https://x.test',journalFile:path.join(dir,'j.json'),rawAction:async()=>({}),out:t=>out.push(t),sleep:async()=>{},
  baw:(argv:string[])=>{calls.push(argv);if(argv[0]==='wallet'&&argv[1]==='status')return {status:'CONNECTED'};if(argv[1]==='settings')return {devMode:{enabled:true,expiresAt:Date.now()+3600000}};if(argv[1]==='address')return {addresses:[{binanceChainId:'56',address:W}]};throw Error('unexpected baw '+argv.join(' '));},...over};
 return {ctx,out,calls,dir};
}
test('chat commands: nonce mismatches from a parallel connector are resynchronised, other errors are not retried',async()=>{
 let n=0;const {ctx}=fakeCtx({rawAction:async()=>{if(++n<3)throw Object.assign(Error('Nonce mismatch. Resynchronize'),{status:409});return {ok:true};}});
 assert.deepEqual(await act(ctx,'state'),{ok:true});assert.equal(n,3);
 let m=0;const other=fakeCtx({rawAction:async()=>{m++;throw Object.assign(Error('Agent disconnected.'),{status:403});}});
 await assert.rejects(act(other.ctx,'state'),/disconnected/);assert.equal(m,1);
});
test('chat commands: execute needs --approve, a fresh preview, and never sends twice',async()=>{
 const f=fakeCtx(),now=Date.now(),data=encodeFunctionData({abi:marketAbi,functionName:'cancelBid',args:[5n]});
 const entry=(id:string,expiresAt:number)=>({requestId:id,type:'tx',label:'Cancel bid',expect:{kind:'nib-cancel',bidId:'5'},tx:tx(NIB_MARKET,data),expiresAt,createdAt:now});
 const j=loadJournal(f.ctx.journalFile);j.previews.fresh=entry('fresh',now+120000);j.previews.stale=entry('stale',now-1000);j.previews.bad={...entry('bad',now+120000),tx:{...tx(NIB_MARKET,data),to:NIB_TOKEN}};saveJournal(f.ctx.journalFile,j);
 await assert.rejects(execute(f.ctx,'fresh',false),/after the user approved/);
 await assert.rejects(execute(f.ctx,'nope',true),/Unknown requestId/);
 await assert.rejects(execute(f.ctx,'stale',true),/expired/);
 await assert.rejects(execute(f.ctx,'bad',true),DoError);
 assert.equal(f.calls.filter(c=>c[1]==='execute').length,0,'nothing was sent');
 // a Binance failure during execute is uncertain: journalled first, and a second run does not call execute again
 let sent=0;const g=fakeCtx({baw:(argv:string[])=>{if(argv[1]==='execute'){sent++;throw Error('timeout');}return f.ctx.baw(argv);}});saveJournal(g.ctx.journalFile,{previews:{fresh:entry('fresh',now+120000)},executions:{}});
 await assert.rejects(execute(g.ctx,'fresh',true),/uncertain/);assert.equal(sent,1);
 await assert.rejects(execute(g.ctx,'fresh',true),/no transaction hash is known/);
 assert.equal(sent,1,'never re-executes an uncertain transaction');
 // a successful run waits for the receipt and settles
 let confirmed=0;const h=fakeCtx({baw:(argv:string[])=>argv[1]==='execute'?{orderId:'o1',status:'BROADCASTED',txHash:'0x'+'cd'.repeat(32)}:f.ctx.baw(argv),
  receipt:async()=>({status:'success',blockNumber:5n,from:W,to:NIB_MARKET,input:data,value:0n,confirmations:2n}),rawAction:async(_s,k)=>{if(k==='nib-market-state'){confirmed++;return {nibMarket:{user:{nib:'0'},openBids:0}};}return {};}});
 saveJournal(h.ctx.journalFile,{previews:{fresh:entry('fresh',now+120000)},executions:{}});
 const done:any=await execute(h.ctx,'fresh',true);assert.equal(done.ok,true);assert.equal(confirmed,1);assert.match(h.out.join('\n'),/Done/);
 assert.equal((await execute(h.ctx,'fresh',true) as any).already,true,'finished requests are never re-run');
 // a receipt that does not match the approved call is rejected
 const k=fakeCtx({baw:h.ctx.baw,receipt:async()=>({status:'success',blockNumber:5n,from:W,to:NIB_MARKET,input:'0x1234',value:0n,confirmations:2n})});saveJournal(k.ctx.journalFile,{previews:{fresh:entry('fresh',now+120000)},executions:{}});
 await assert.rejects(execute(k.ctx,'fresh',true),/does not match the approved call/);
});

test('chat commands end to end: mint, approve and list an NFT, and earn, only by agent-started signed requests with chat approval',async t=>{
 const f=await nftChain(),db=await databaseFixture('sqlite'),who=3,account=f.accounts[who],session=privateKeyToAccount(generatePrivateKey());
 const env:any={DB:db,BSC_RPC_URL:f.rpc,NFT_RPC_URL:f.rpc,NFT_COLLECTION:f.collection,NFT_MARKETPLACE:f.market,NFT_LP_VAULT:f.vault};
 const req=async(p:string,body?:any,uid='chat-user')=>{const r=await handle(new Request('https://chat.test/api/'+p,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':uid,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json() as any};};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'taptap-chat-'));
 try{
  const pair=await req('pair',{}),challenge=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:session.address}),signed=await req('agent/session',{challengeId:challenge.body.challengeId,signature:await account.signTypedData(challenge.body.typedData)});assert.equal(signed.status,200);
  const s:any={sessionId:signed.body.sessionId,wallet:account.address,nonce:0,expiresAt:Date.now()+3600000};
  const rawAction=async(st:any,kind:string,payload:any={})=>{const envelope={sessionId:st.sessionId,nonce:st.nonce,timestamp:Date.now(),action:kind,payload},signature=await session.signTypedData(actionData('https://chat.test',envelope) as any),r=await req('agent/action',{...envelope,signature});if(Number.isSafeInteger(r.body.nonce))st.nonce=r.body.nonce;if(r.status>=400)throw Object.assign(Error(r.body.error),{status:r.status});return r.body;};
  let n=0;const previews:Record<string,any>={},out:string[]=[],sent:string[]=[];
  const baw=(argv:string[])=>{
   if(argv[0]==='wallet'&&argv[1]==='status')return {status:'CONNECTED'};if(argv[1]==='settings')return {devMode:{enabled:true,expiresAt:Date.now()+3600000}};if(argv[1]==='address')return {addresses:[{binanceChainId:'56',address:account.address}]};
   if(argv[1]==='preview'){const g=(k:string)=>argv[argv.indexOf(k)+1];const id='fixture-preview-'+(++n);previews[id]={to:g('--to'),data:g('--inputData'),value:g('--value')};return {requestId:id,expiresAt:Date.now()+240000,risks:{riskDetails:[],addresses:{},riskBehaviors:[]},parsedTx:{operation:'fixture'},requireConfirmation:false};}
   if(argv[1]==='execute'){const p=previews[argv[argv.indexOf('--requestId')+1]];sent.push(p.data);return f.wallets[who].sendTransaction({account,chain:f.wallets[who].chain,to:p.to,data:p.data,value:BigInt(p.value)}).then(async hash=>{await f.client.waitForTransactionReceipt({hash});return {orderId:'o',status:'BROADCASTED',txHash:hash};}) as any;}
   throw Error('unexpected baw '+argv.join(' '));
  };
  const ctx:Ctx={s,origin:'https://chat.test',journalFile:path.join(dir,'j.json'),rawAction,baw:baw as any,out:x=>out.push(x),sleep:async()=>{await f.provider.request({method:'evm_mine',params:[]});},rpcUrl:f.rpc,collection:f.collection};
  const prepare=async(argv:string[])=>{out.length=0;await runDo(ctx,argv);const m=out.join('\n').match(/requestId: (\S+)/);assert.ok(m,out.join('\n'));return m![1];};
  const nft=f.art('NibCollection').abi,market=f.art('NibMarketplace').abi;
  await t.test('mint: preview first, nothing moves until the chat yes, then it confirms and settles',async()=>{
   const id=await prepare(['mint','--usdt']);assert.match(out.join('\n'),/Mint 1 Nib Collection NFT|Mint 1 Nib NFT/);assert.equal(sent.length,0,'previewing never sends');
   await assert.rejects(execute(ctx,id,false),/after the user approved/);assert.equal(sent.length,0);
   const done:any=await execute(ctx,id,true);assert.equal(done.ok,true,out.join('\n'));assert.equal(sent.length,1);
   assert.equal(await f.read(f.collection,nft,'mintedBy',[account.address]),1n);
   const row:any=await db.prepare('SELECT status FROM nft_intents WHERE wallet=?').bind(account.address.toLowerCase()).first();assert.equal(row.status,'confirmed');
   assert.equal((await execute(ctx,id,true) as any).already,true);assert.equal(sent.length,1,'finished requests are never re-sent');
  });
  await t.test('list needs a one-time exact approval for that NFT; the agent prepares it, then the listing',async()=>{
   const tokenId=Number(await f.read(f.collection,nft,'tokenOfOwnerByIndex',[account.address,0n]));
   const approvalId=await prepare(['nft-list',String(tokenId),'--bnb','2']);assert.match(out.join('\n'),/Approve .* for trading/);assert.match(out.join('\n'),/run the same list command again/);
   assert.equal((await execute(ctx,approvalId,true) as any).ok,true,out.join('\n'));
   const listId=await prepare(['nft-list',String(tokenId),'--bnb','2']);assert.match(out.join('\n'),/List Nib #/);assert.match(out.join('\n'),/2 BNB/);
   assert.equal((await execute(ctx,listId,true) as any).ok,true,out.join('\n'));
   const l=await f.read(f.market,market,'listings',[BigInt(tokenId)]);assert.equal(l[2],parseEther('2'));
   assert.equal(sent.length,3);
  });
  await t.test('browser-queued requests still need the browser approval; agent requests are bound to the paired wallet',async()=>{
   const queued=await req('nft/intents',{kind:'mint-approval',quantity:1});assert.equal(queued.status,201,JSON.stringify(queued.body));
   assert.equal(await rawAction(s,'nft-execute',{intentId:queued.body.id,requestId:'x'}).catch((e:any)=>e.status),409);
   await assert.rejects(rawAction(s,'nft-execute',{intentId:'does-not-exist',requestId:'x'}),/not found/i);
  });
  await t.test('earn: the agent creates its own command and taps without any dashboard queueing',async()=>{
   const created=await rawAction(s,'command-create',{target:50});assert.equal(created.command.target,50);assert.equal(created.agent.commands[0].status,'queued');
   await assert.rejects(rawAction(s,'command-create',{target:0}),/1/);await assert.rejects(rawAction(s,'mission-claim',{index:1}),/Complete this mission first/);
   await assert.rejects(rawAction(s,'mission-claim',{index:9}),/Invalid mission/);
   out.length=0;const real:Ctx={...ctx,sleep:ms=>new Promise(r=>setTimeout(r,Math.min(ms,5200)))};
   const result:any=await runDo(real,['earn-max','--minutes','0.15']);assert.ok(result&&Number(result.earnedTap)>0,JSON.stringify(result)+out.join('\n'));assert.ok(result.taps>0);
   const st:any=await status(ctx,true);assert.equal(st.wallet,account.address);assert.ok(st.game.energy);
  });
 }finally{await db.close();await f.close();}
});
