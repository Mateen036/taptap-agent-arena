import {test} from 'node:test';import assert from 'node:assert/strict';import {parseEther,encodeFunctionData,keccak256,toHex} from 'viem';import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {nftChain} from './helpers/nft-chain';import {databaseFixture} from './helpers/database';import {nftSvg,nftTraits} from '../lib/nft-art';import {handle} from '../lib/api';import {actionData,AGENT_ID_REGISTRY} from '../lib/protocol';import {NFT_PAYMENT,NFT_ROUTER,nftAbi,nftCall} from '../lib/nft-protocol';import {validateNftTransaction,processNftIntent} from '../agent/nft-runner';
import {nftDeploymentPlan,normalizeRuntime,NFT_CREATE2,NFT_MULTICALL,deploymentAbi} from '../scripts/nft-deploy';
test('Nib Foundry: on-chain artwork, gated minting, market settlement, signed approval flow, and LP-only proceeds',async t=>{
 const f=await nftChain(),nft=f.art('NibFoundry').abi,market=f.art('NibMarketplace').abi,vault=f.art('NibLPVault').abi;
 try{
 await t.test('all 10,000 designs are unique; deployed renderer matches original SVG and metadata',async()=>{
  const traits=new Set<string>(),svgs=new Set<string>();for(let id=1;id<=10000;id++){traits.add(nftTraits(id).indexes.join(','));svgs.add(keccak256(toHex(nftSvg(id))));}assert.equal(traits.size,10000);assert.equal(svgs.size,10000);
  for(const id of [1,7,42,69,420,1337,8888,10000]){assert.equal(await f.read(f.renderer,f.art('NibRenderer').abi,'svg',[BigInt(id)]),nftSvg(id));const uri=await f.read(f.renderer,f.art('NibRenderer').abi,'tokenURI',[BigInt(id)]);const metadata=JSON.parse(Buffer.from(uri.split(',')[1],'base64').toString());assert.equal(metadata.attributes.length,6);assert.equal(Buffer.from(metadata.image.split(',')[1],'base64').toString(),nftSvg(id));}
  for(const name of ['NibFoundry','NibLPVault','NibMarketplace','NibRenderer'])assert.ok((f.art(name).deployedBytecode.length-2)/2<=24576,name+' runtime fits mainnet size limit');
 });
 await t.test('first mint free per wallet, exact payments, ten lifetime mints, eligibility, pause and replay protection',async()=>{
  const id=f.intent();await f.write(f.collection,nft,'mint',[1n,0n,await f.deadline(),id],1);assert.equal(await f.read(f.collection,nft,'ownerOf',[1n]),f.accounts[1].address);assert.equal(await f.read(NFT_PAYMENT,f.m.MockToken.abi,'balanceOf',[f.vault]),0n);
  await assert.rejects(f.write(f.collection,nft,'mint',[1n,parseEther('1'),await f.deadline(),id],1));
  await assert.rejects(f.write(f.collection,nft,'mint',[1n,0n,await f.deadline(),f.intent()],1));
  await f.write(NFT_PAYMENT,f.m.MockToken.abi,'approve',[f.collection,parseEther('9')],1);await f.write(f.collection,nft,'mint',[9n,parseEther('9'),await f.deadline(),f.intent()],1);
  assert.equal(await f.read(f.collection,nft,'mintedBy',[f.accounts[1].address]),10n);assert.equal(await f.read(f.collection,nft,'minted'),10n);assert.equal(await f.read(NFT_PAYMENT,f.m.MockToken.abi,'balanceOf',[f.vault]),parseEther('9'));
  await assert.rejects(f.write(f.collection,nft,'mint',[1n,parseEther('1'),await f.deadline(),f.intent()],1));
  await assert.rejects(f.write(f.collection,nft,'mint',[1n,0n,await f.deadline(),f.intent()],15));
  await f.write(f.collection,nft,'pause');await assert.rejects(f.write(f.collection,nft,'mint',[1n,0n,await f.deadline(),f.intent()],2));await f.write(f.collection,nft,'unpause');
  await assert.rejects(f.write(f.collection,nft,'safeTransferFrom',[f.accounts[1].address,f.accounts[15].address,1n],1));
 });
 await t.test('noncustodial marketplace pays seller and delivers atomically; rejects stale quotes and non-agents',async()=>{
  const token=1n,price=parseEther('2'),expiry=(await f.deadline())+86400n;await f.write(f.collection,nft,'approve',[f.market,token],1);await f.write(f.market,market,'list',[token,price,expiry],1);
  const l=await f.read(f.market,market,'listings',[token]);assert.equal(await f.read(f.collection,nft,'ownerOf',[token]),f.accounts[1].address,'Listing does not escrow the NFT');
  await assert.rejects(f.write(f.market,market,'buy',[token,l[0],price-1n,f.accounts[1].address,await f.deadline()],2));await assert.rejects(f.write(f.market,market,'buy',[token,l[0],price,f.accounts[1].address,await f.deadline()],15));
  const balance=await f.client.getBalance({address:f.accounts[1].address});await f.write(f.market,market,'buy',[token,l[0],price,f.accounts[1].address,await f.deadline()],2,price);
  assert.equal(await f.read(f.collection,nft,'ownerOf',[token]),f.accounts[2].address);assert.equal(await f.client.getBalance({address:f.accounts[1].address}),balance+price);assert.equal(await f.read(f.market,market,'completedSales'),1n);assert.equal(await f.read(f.market,market,'volume'),price);
  await assert.rejects(f.write(f.market,market,'buy',[token,l[0],price,f.accounts[1].address,await f.deadline()],2));await assert.rejects(f.write(f.collection,nft,'mint',[1n,parseEther('1'),await f.deadline(),f.intent()],1),'Selling does not reset lifetime mint cap');
  await f.write(f.collection,nft,'approve',[f.market,2n],1);await f.write(f.market,market,'list',[2n,price,expiry],1);const old=await f.read(f.market,market,'listings',[2n]);await f.write(f.market,market,'list',[2n,price+1n,expiry],1);await assert.rejects(f.write(f.market,market,'buy',[2n,old[0],price,f.accounts[1].address,await f.deadline()],2));
  await f.write(AGENT_ID_REGISTRY,f.m.MockIdentity.abi,'set',[f.accounts[1].address,0n]);assert.equal(await f.read(f.market,market,'available',[2n]),false);await f.write(f.market,market,'prune',[2n]);await f.write(AGENT_ID_REGISTRY,f.m.MockIdentity.abi,'set',[f.accounts[1].address,1n]);
 });
 for(const backend of ['sqlite','postgres'] as const)await t.test(backend+': signed agent requests need exact browser approval and matching confirmed receipt',async()=>{
  const db=await databaseFixture(backend),user='nft-'+backend,who=backend==='sqlite'?3:4,account=f.accounts[who],session=privateKeyToAccount(generatePrivateKey());
  const env:any={DB:db,BSC_RPC_URL:f.rpc,NFT_RPC_URL:f.rpc,NFT_COLLECTION:f.collection,NFT_MARKETPLACE:f.market,NFT_LP_VAULT:f.vault};
  const req=async(path:string,body?:any,uid=user)=>{const r=await handle(new Request('https://nft.test/api/'+path,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':uid,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json() as any};};
  try{
   const pair=await req('pair',{}),challenge=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:session.address}),signed=await req('agent/session',{challengeId:challenge.body.challengeId,signature:await account.signTypedData(challenge.body.typedData)});assert.equal(signed.status,200,JSON.stringify(signed.body));let nonce=0;
   const act=async(action:string,payload:any={})=>{const envelope={sessionId:signed.body.sessionId,nonce,timestamp:Date.now(),action,payload},signature=await session.signTypedData(actionData('https://nft.test',envelope) as any),r=await req('agent/action',{...envelope,signature});if(r.body.nonce!==undefined)nonce=r.body.nonce;return r;};
   const snapshot=await req('nft');assert.equal(snapshot.status,200,JSON.stringify(snapshot.body));assert.equal(snapshot.body.wallet.freeAvailable,true);assert.equal(snapshot.body.wallet.eligible,true);assert.equal(snapshot.body.configured,true);
   const queued=await req('nft/intents',{kind:'mint',quantity:1});assert.equal(queued.status,201,JSON.stringify(queued.body));const i=queued.body;
   assert.equal((await req(`nft/intents/${i.id}/approve`,{requestId:'forged',txDigest:i.txDigest})).status,409);
   assert.equal((await act('nft-execute',{intentId:i.id,requestId:'notapproved'})).status,409);
   assert.equal((await req(`nft/intents/${i.id}/cancel`,{},'other-owner')).status,409);
   const claimed=await act('nft-claim',{intentId:i.id});assert.equal(claimed.status,200);assert.equal(validateNftTransaction(claimed.body.intent,claimed.body.contracts,account.address),true);
   assert.throws(()=>validateNftTransaction({...i,transaction:{...i.transaction,to:NFT_PAYMENT}},claimed.body.contracts,account.address));
   const preview={requestId:'fixture-preview-'+backend,expiresAt:Date.now()+180000,risks:{riskDetails:[],addresses:{},riskBehaviors:[]},parsedTransaction:{operation:'Mint 1 NFT'},requireConfirmation:false};
   assert.equal((await act('nft-preview',{intentId:i.id,transaction:{...i.transaction,value:'1'},preview})).status,400);
   assert.equal((await act('nft-preview',{intentId:i.id,transaction:i.transaction,preview})).status,200);
   assert.equal((await act('nft-execute',{intentId:i.id,requestId:preview.requestId})).status,409);
   assert.equal((await req(`nft/intents/${i.id}/approve`,{requestId:preview.requestId,txDigest:i.txDigest})).status,200);
   assert.equal((await act('nft-execute',{intentId:i.id,requestId:preview.requestId})).status,200);
   assert.equal((await act('nft-execute',{intentId:i.id,requestId:preview.requestId})).status,409,'Approval is consumed once');
   assert.equal((await act('nft-fail',{intentId:i.id,code:'wallet'})).status,409,'Pending spends cannot be hidden as ordinary failures');
   const hash=await f.wallets[who].sendTransaction({account,chain:f.wallets[who].chain,to:i.transaction.to,data:i.transaction.data,value:0n});await f.client.waitForTransactionReceipt({hash});await f.provider.request({method:'evm_mine',params:[]});await f.provider.request({method:'evm_mine',params:[]});
   await db.prepare('INSERT INTO nft_intents(id,wallet,kind,payload,"transaction",summary,status,transaction_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('unverified-'+backend,'other-wallet','mint','{}','{}','{}','broadcast',hash,Date.now(),Date.now()+60000).run();
   assert.equal((await act('nft-broadcast',{intentId:i.id,transactionHash:hash})).status,200);const receipt=await act('nft-confirm',{intentId:i.id,transactionHash:hash});assert.equal(receipt.status,200,JSON.stringify(receipt.body));assert.equal(receipt.body.status,'confirmed','An unverified hash cannot reserve or block another wallet receipt');
   const readback=await req('nft');assert.equal(readback.body.wallet.minted,1);assert.equal(readback.body.owned.length,1);assert.equal(readback.body.intents[0].status,'confirmed');
   const second=await req('nft/intents',{kind:'mint',quantity:1});assert.equal(second.status,409,'Exact USDT allowance is required before paid mint');
   const approval=await req('nft/intents',{kind:'mint-approval',quantity:1});assert.equal(approval.status,201);assert.equal(approval.body.summary.payment,'1');assert.equal(validateNftTransaction(approval.body,{collection:f.collection,market:f.market},account.address),true);
   assert.equal((await req('disconnect',{})).status,200);const cancelled=await db.prepare('SELECT status FROM nft_intents WHERE id=?').bind(approval.body.id).first<any>();assert.equal(cancelled.status,'cancelled');
  }finally{await db.close();}
 });
 await t.test('crash recovery never executes an uncertain wallet call twice',async()=>{
  let executions=0;const actions:any[]=[];const s:any={wallet:f.accounts[5].address,nftExecutions:{uncertain:{requestId:'x'}}};await processNftIntent(s,[{id:'uncertain',status:'executing',created_at:0}],{persist:()=>{},baw:()=>{executions++;return {};},action:async(_s,k,p)=>{actions.push([k,p]);return {};}});assert.equal(executions,0);assert.equal(actions[0][0],'nft-fail');assert.equal(actions[0][1].uncertain,true);
 });
 await t.test('a known pre-execution wallet failure does not consume approval or create an uncertain submission',async()=>{
  const wallet=f.accounts[5].address,id='preflight',tx=nftCall(wallet,NFT_PAYMENT,[{type:'function',name:'approve',stateMutability:'nonpayable',inputs:[{name:'spender',type:'address'},{name:'value',type:'uint256'}],outputs:[{type:'bool'}]}],'approve',[f.collection,1n]);
  const s:any={wallet,nftPreviews:{[id]:{requestId:'local-preview',txDigest:keccak256(toHex(JSON.stringify(Object.fromEntries(Object.entries(tx).sort(([a],[b])=>a.localeCompare(b)))))),expiresAt:Date.now()+60000}}};
  // Use the same canonical digest as production; the deliberately disconnected status is read before execution.
  const {canonical}=await import('../lib/game');s.nftPreviews[id].txDigest=keccak256(toHex(canonical(tx)));const actions:string[]=[];
  await processNftIntent(s,[{id,status:'approved',created_at:0,transaction:tx,preview_request_id:'local-preview'}],{persist:()=>{},baw:()=>({status:'UNCONNECTED'}),action:async(_s,k)=>{actions.push(k);return {};}});assert.deepEqual(actions,['nft-fail']);assert.equal(s.nftExecutions[id],undefined);
 });
 await t.test('LP vault locks proceeds until token selection delay and exposes no withdrawal path',async()=>{
  const token=await f.deploy(f.m.MockToken);await assert.rejects(f.write(f.vault,vault,'addLiquidity',[1n,1n,1n,1n,await f.deadline()]));await assert.rejects(f.write(f.vault,vault,'proposeToken',[token],1));
  await f.write(f.vault,vault,'proposeToken',[token]);await assert.rejects(f.write(f.vault,vault,'activateToken'));await f.provider.request({method:'evm_increaseTime',params:[172801]});await f.provider.request({method:'evm_mine',params:[]});await f.write(f.vault,vault,'activateToken');await assert.rejects(f.write(f.vault,vault,'proposeToken',[NFT_PAYMENT]));
  await f.write(token,f.m.MockToken.abi,'mint',[f.vault,parseEther('9')]);await f.write(f.vault,vault,'addLiquidity',[parseEther('9'),parseEther('9'),parseEther('8'),parseEther('8'),await f.deadline()]);
  assert.equal(await f.read(f.vault,vault,'paymentAdded'),parseEther('9'));assert.equal(await f.read(f.vault,vault,'lpTokensLocked'),parseEther('9'));assert.equal(await f.read(NFT_PAYMENT,f.m.MockToken.abi,'allowance',[f.vault,NFT_ROUTER]),0n);assert.equal(vault.some((v:any)=>['withdraw','rescue','removeLiquidity','execute'].includes(v.name)),false);
 });
 await t.test('single deployment bundle is atomic and its CREATE2 addresses/runtime match the reviewed plan',async()=>{
  const factory=await f.deploy(f.m.MockCreate2),multicall=await f.deploy(f.m.MockMulticall);for(const [target,source]of [[NFT_CREATE2,factory],[NFT_MULTICALL,multicall]])await f.provider.request({method:'evm_setAccountCode',params:[target,(await f.client.getCode({address:source}))!]});
  const plan=nftDeploymentPlan(f.accounts[7].address),calls=plan.steps.map(s=>({target:NFT_CREATE2,allowFailure:false,callData:s.callData}));
  const bad=[...calls];bad[2]={...bad[2],callData:('0x'+plan.steps[2].salt.slice(2)+'fe') as `0x${string}`};await assert.rejects(f.write(NFT_MULTICALL,deploymentAbi,'aggregate3',[bad],7));
  assert.equal(await f.client.getCode({address:plan.contracts.renderer}),undefined,'Failed bundle rolls back the earlier renderer deployment');
  await f.write(NFT_MULTICALL,deploymentAbi,'aggregate3',[calls],7);
  for(const s of plan.steps){const code=(await f.client.getCode({address:s.address}))!;assert.equal(normalizeRuntime(code,f.art(s.name)),f.art(s.name).deployedBytecode);}
  assert.equal(await f.read(plan.contracts.collection,nft,'owner'),f.accounts[7].address);assert.equal(await f.read(plan.contracts.collection,nft,'mintOpen'),true);assert.equal(await f.read(plan.contracts.collection,nft,'lpVault'),plan.contracts.vault);
 });
 await t.test('supply boundary rejects crossing 10,000 and cannot mint token 10,001',async()=>{
  // Test-only boundary setup; only the counter is advanced, never production state.
  const slot=f.art('NibFoundry').storageLayout.storage.find((s:any)=>s.label==='minted').slot;
  await f.provider.request({method:'evm_setAccountStorageAt',params:[f.collection,'0x'+BigInt(slot).toString(16).padStart(64,'0'),'0x'+9999n.toString(16).padStart(64,'0')]});
  await f.write(NFT_PAYMENT,f.m.MockToken.abi,'approve',[f.collection,parseEther('1')],6);
  await assert.rejects(f.write(f.collection,nft,'mint',[2n,parseEther('1'),await f.deadline(),f.intent()],6));
  await f.write(f.collection,nft,'mint',[1n,0n,await f.deadline(),f.intent()],6);assert.equal(await f.read(f.collection,nft,'minted'),10000n);assert.equal(await f.read(f.collection,nft,'ownerOf',[10000n]),f.accounts[6].address);
  await assert.rejects(f.write(f.collection,nft,'mint',[1n,parseEther('1'),await f.deadline(),f.intent()],6));
 });
 }finally{await f.close();}
});
