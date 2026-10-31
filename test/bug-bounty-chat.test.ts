import {test,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {encodeFunctionData,parseAbi,parseUnits,formatUnits,getAbiItem,toFunctionSelector} from 'viem';import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {setup,closeAll,E,DAY,bountyArtifact} from './helpers/bounty-chain';import {databaseFixture} from './helpers/database';
import {handle} from '../lib/api';import {actionData,AGENT_ID_REGISTRY} from '../lib/protocol';
import {runDo,execute,validateServerTx,NIB_BUG_BOUNTY,type Ctx,type Expect} from '../agent/do';
import {NIB_TOKEN_PIN,bountyCallAbi,commitHashOf,prepareCommit,reportHashOf,scopeHashOf} from '../agent/bounty';
import {bugBountyPlan,NIB_TOKEN_ADDRESS} from '../scripts/nib-bug-bounty-deploy';
after(closeAll);
const KEY='cd'.repeat(32);
const SCOPE='In scope: the NibSwap router at 0x1234 on BNB Chain (reentrancy, accounting, access control). Out of scope: front-end, DoS, social engineering. Include a PoC.';
const REPORT='HIGH: router.skim() lets anyone sweep fee balances. PoC: call skim(token) from any account after a swap. Impact: loss of accrued fees. Fix: restrict skim to the fee owner.\n';

test('pins: the connector pins exactly the address the deploy script plans, and only functions the contract has',()=>{
 assert.equal(NIB_BUG_BOUNTY.toLowerCase(),bugBountyPlan().address.toLowerCase(),'re-run `npx tsx scripts/nib-bug-bounty-deploy.ts plan` and update NIB_BUG_BOUNTY in agent/bounty.ts');
 assert.equal(NIB_TOKEN_PIN.toLowerCase(),NIB_TOKEN_ADDRESS.toLowerCase());
 const real=bountyArtifact().abi;for(const item of bountyCallAbi){const f=item as any;const r=getAbiItem({abi:real,name:f.name}) as any;assert.ok(r,f.name);assert.equal(toFunctionSelector(f),toFunctionSelector(r),f.name+' signature differs from the contract');}
});
test('validation: a hostile or buggy site cannot slip a different call past the connector',()=>{
 const W='0x'+'a1'.repeat(20),OTHER='0x'+'b2'.repeat(20);const now=Math.floor(Date.now()/1000);
 const tx=(fn:string,args:any[],to:string=NIB_BUG_BOUNTY,value='0',from=W)=>({chainId:56,from,to,value,data:encodeFunctionData({abi:bountyCallAbi,functionName:fn,args} as any)});
 const ok=(t:any,e:Partial<Expect>)=>validateServerTx(t,{kind:'bounty',wallet:W,...e} as Expect);const no=(t:any,e:Partial<Expect>,re:RegExp)=>assert.throws(()=>ok(t,e),re);
 const H='0x'+'11'.repeat(32);
 // exact approvals only, only to the bounty contract, only on the NIB token
 const approve=(spender:string,amount:bigint,to=NIB_TOKEN_PIN)=>({chainId:56,from:W,to,value:'0',data:encodeFunctionData({abi:parseAbi(['function approve(address,uint256) returns (bool)']),functionName:'approve',args:[spender as any,amount]})});
 const ea:Partial<Expect>={kind:'bounty-approve',amountRaw:E(500)};
 ok(approve(NIB_BUG_BOUNTY,E(500)),ea);
 no(approve(OTHER,E(500)),ea,/spender must be the Bug Bounty/);no(approve(NIB_BUG_BOUNTY,E(501)),ea,/differs/);no(approve(NIB_BUG_BOUNTY,2n**256n-1n),{kind:'bounty-approve',amountRaw:2n**256n-1n},/bounded/);
 no(approve(NIB_BUG_BOUNTY,E(500),OTHER),ea,/NIB token/);no(approve(NIB_BUG_BOUNTY,E(500)),{kind:'bounty-approve'},/differs/);no(approve(NIB_BUG_BOUNTY,0n),{kind:'bounty-approve',amountRaw:0n},/bounded/);
 // calls: pinned address, zero value, same function, every argument as the user asked
 const commit=tx('commit',[7n,H]),ec:Partial<Expect>={fn:'commit',args:['7',H]};
 ok(commit,ec);
 no(tx('commit',[7n,H],OTHER),ec,/must go to/);no(tx('commit',[7n,H],NIB_BUG_BOUNTY,'1'),ec,/never send BNB/);no(tx('commit',[8n,H]),ec,/Argument 1/);no(tx('commit',[7n,'0x'+'22'.repeat(32)]),ec,/Argument 2/);
 no(tx('commit',[7n,H],NIB_BUG_BOUNTY,'0','0x'+'c3'.repeat(20)),ec,/wallet or chain/);no({...commit,chainId:1},ec,/wallet or chain/);no(commit,{...ec,fn:'reveal'},/Unexpected function/);no(commit,{fn:'commit'},/No expectation/);no(commit,{args:['7',H]},/No expectation/);
 no(tx('accept',[3n,4]),{fn:'accept',args:['3','2']},/Argument 2/);ok(tx('accept',[3n,2]),{fn:'accept',args:['3','2']});no(tx('withdraw',[3n]),{fn:'requestCancel',args:['3']},/Unexpected function/);
 no({...commit,data:'0xdeadbeef'},ec,/Unknown Bug Bounty function/);no({...commit,data:'zz'},ec,/wallet or chain/);no(tx('resolveDispute',[1n,4,true]),{fn:'resolveDispute',args:['1','4','false']},/Argument 3/);
 // create: tiers, deposit, stake, review window exactly; the end time inside the window the user asked for
 const tiers=[E(10000),E(25000)],create=(over:any={})=>tx('createBounty',[over.scope??scopeHashOf(SCOPE),over.tiers??tiers,BigInt(over.ends??now+30*DAY),over.review??BigInt(7*DAY),over.stake??E(200),over.deposit??E(300000)]);
 const ecr:Partial<Expect>={fn:'createBounty',args:[scopeHashOf(SCOPE),'['+tiers.join(',')+']',null,String(7*DAY),E(200).toString(),E(300000).toString()],endsAtRange:[now+30*DAY-900,now+30*DAY+900],endsAtIndex:2};
 ok(create(),ecr);no(create({scope:H}),ecr,/Argument 1/);no(create({tiers:[E(10000),E(2500000)]}),ecr,/Argument 2/);no(create({ends:now+400*DAY}),ecr,/end time/);no(create({ends:now+DAY}),ecr,/end time/);no(create({stake:E(1)}),ecr,/Argument 5/);no(create({deposit:E(1)}),ecr,/Argument 6/);no(create({review:BigInt(DAY)}),ecr,/Argument 4/);
});
for(const kind of ['sqlite'] as const)test('chat flow end to end: create (with approval), publish scope, commit, reveal, accept, hostile-site refusals, hidden until configured',async t=>{
 const f=await setup({server:true,pin:{nib:NIB_TOKEN_PIN,bounty:NIB_BUG_BOUNTY,registry:AGENT_ID_REGISTRY}});
 assert.equal(f.bounty.toLowerCase(),NIB_BUG_BOUNTY.toLowerCase());
 const db=await databaseFixture(kind),dir=fs.mkdtempSync(path.join(os.tmpdir(),'taptap-bounty-'));
 const base:any={DB:db,BSC_RPC_URL:f.rpc,NIB_TOKEN:NIB_TOKEN_PIN,BUG_BOUNTY_REPORT_KEY:KEY};const envOn:any={...base,BUG_BOUNTY_CONTRACT:NIB_BUG_BOUNTY};let env=base;
 const req=async(p:string,body?:any,uid='bb-user')=>{const r=await handle(new Request('https://bb.test/api/'+p,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':uid,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json() as any};};
 const write=(name:string,text:string)=>{const p=path.join(dir,name);fs.writeFileSync(p,text);return p;};
 async function agent(index:number,uid:string,tamper?:(kind:string,res:any)=>any){
  const account=f.accounts[index],session=privateKeyToAccount(generatePrivateKey()),pair=await req('pair',{},uid),ch=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:session.address},uid),signed=await req('agent/session',{challengeId:ch.body.challengeId,signature:await account.signTypedData(ch.body.typedData)},uid);assert.equal(signed.status,200,JSON.stringify(signed.body));
  const s:any={sessionId:signed.body.sessionId,wallet:account.address,nonce:0,expiresAt:Date.now()+3600000};
  const rawAction=async(st:any,kind:string,payload:any={})=>{const envelope={sessionId:st.sessionId,nonce:st.nonce,timestamp:Date.now(),action:kind,payload},signature=await session.signTypedData(actionData('https://bb.test',envelope) as any),r=await req('agent/action',{...envelope,signature},uid);if(Number.isSafeInteger(r.body.nonce))st.nonce=r.body.nonce;if(r.status>=400)throw Object.assign(Error(r.body.error),{status:r.status});return tamper?tamper(kind,r.body):r.body;};
  let n=0;const previews:Record<string,any>={},out:string[]=[],sent:string[]=[];
  const baw=(argv:string[])=>{
   if(argv[0]==='wallet'&&argv[1]==='status')return {status:'CONNECTED'};if(argv[1]==='settings')return {devMode:{enabled:true,expiresAt:Date.now()+3600000}};if(argv[1]==='address')return {addresses:[{binanceChainId:'56',address:account.address}]};
   if(argv[1]==='preview'){const g=(k:string)=>argv[argv.indexOf(k)+1];const id='bb-preview-'+index+'-'+(++n);previews[id]={to:g('--to'),data:g('--inputData'),value:g('--value')};return {requestId:id,expiresAt:Date.now()+240000,risks:{riskDetails:[],addresses:{},riskBehaviors:[]},parsedTx:{operation:'fixture'},requireConfirmation:false};}
   if(argv[1]==='execute'){const p=previews[argv[argv.indexOf('--requestId')+1]];sent.push(p.data);return f.wallets[index].sendTransaction({account,chain:f.wallets[index].chain,to:p.to,data:p.data,value:BigInt(p.value),gas:5_000_000n}).then(async hash=>{await f.client.waitForTransactionReceipt({hash});return {orderId:'o',status:'BROADCASTED',txHash:hash};}) as any;}
   throw Error('unexpected baw '+argv.join(' '));
  };
  const ctx:Ctx={s,origin:'https://bb.test',journalFile:path.join(dir,'j'+index+'.json'),stateDir:path.join(dir,'state'+index),rawAction,baw:baw as any,out:x=>out.push(x),sleep:async()=>{await f.provider.request({method:'evm_mine',params:[]});},rpcUrl:f.rpc,fetchJson:async(u:string)=>{const r=await handle(new Request(u),env);return r.json();}};
  const prepare=async(argv:string[])=>{out.length=0;await runDo(ctx,argv);const m=out.join('\n').match(/requestId: (\S+)/);assert.ok(m,out.join('\n'));return m![1];};
  const run=async(argv:string[])=>{const id=await prepare(argv);const text=out.join('\n');const done:any=await execute(ctx,id,true);assert.equal(done.ok,true,out.join('\n'));return {id,text,done};};
  return {account,ctx,out,sent,prepare,run,rawAction,s,index,previews};
 }
 // account 8: funded and identified, but never approved the bounty contract; 4 and 5: hunters; 3: another project
 await f.mint(f.accounts[8].address,E(500000));await f.idy(f.accounts[8].address);
 const project=await agent(8,'project'),hunter=await agent(4,'hunter'),hunter2=await agent(5,'hunter2'),rival=await agent(3,'rival');
 await t.test('hidden until configured: bounty-book says not live and writing commands are refused',async()=>{
  await runDo(project.ctx,['bounty-book']);assert.match(project.out.join('\n'),/not live yet/);
  assert.equal((await req('bug-bounty')).body.enabled,false);
  await assert.rejects(runDo(project.ctx,['bounty-commit','1','--severity','2','--file',write('r0.md',REPORT)]),/not available|not live/i);
  env=envOn;
 });
 let bountyId='';
 await t.test('create: step 1 approves exactly the deposit, step 2 creates and the scope is published automatically',async()=>{
  const sc=write('scope.md',SCOPE);const args=['bounty-create','--tiers','10000,25000,50000,100000','--deposit','300000','--days','30','--review-days','5','--scope-file',sc];
  const before=await f.bal(f.accounts[8].address);
  await assert.rejects(runDo(project.ctx,['bounty-create','--tiers','10000,25000','--deposit','300000','--days','3','--scope-file',sc]),/--days must be/);
  await assert.rejects(runDo(project.ctx,['bounty-create','--tiers','50000,25000','--deposit','300000','--scope-file',sc]),/strictly increase/);
  await assert.rejects(runDo(project.ctx,['bounty-create','--tiers','10000','--deposit','300000']),/--scope-file/);
  const one=await project.run(args);assert.match(one.text,/Step 1 of 2: approve exactly 300000 NIB/);assert.equal(await f.bal(f.accounts[8].address),before,'an approval moves no NIB');
  const two=await project.run(args);assert.match(two.text,/Escrowed nib: 300000/);assert.match(two.text,/Rule:/);
  assert.equal(await f.bal(f.accounts[8].address),before-E(300000));assert.equal(await f.bal(NIB_BUG_BOUNTY as any),E(300000));
  const st=(await req('bug-bounty','',undefined)).body;void st;
  const state=(await project.ctx.rawAction(project.s,'bounty-state')).bugBounty;const b=state.bounties[0];bountyId=b.id;
  assert.equal(b.creator,f.accounts[8].address.toLowerCase());assert.equal(b.scope.verified,true,'scope text was published after the create confirmed');assert.equal(b.scope.text,SCOPE);assert.equal(b.reviewWindowDays,5);assert.equal(b.stake,'200');
 });
 await t.test('hunter: commit saves salt+report locally, reveal uploads the report privately and reveals on-chain; the project reads it only afterwards',async()=>{
  const file=write('report.md',REPORT);
  await assert.rejects(runDo(hunter.ctx,['bounty-commit',bountyId,'--severity','9','--file',file]),/--severity/);await assert.rejects(runDo(hunter.ctx,['bounty-commit',bountyId,'--severity','3']),/--file/);await assert.rejects(runDo(hunter.ctx,['bounty-commit',bountyId,'--severity','3','--file',write('empty.md','  \n')]),/empty/);
  await assert.rejects(runDo(project.ctx,['bounty-commit',bountyId,'--severity','3','--file',file]),/own bounty|cannot submit/i);
  const first=await hunter.prepare(['bounty-commit',bountyId,'--severity','3','--file',file]);const h1=hunter.previews[first].data;const again=await hunter.prepare(['bounty-commit',bountyId,'--severity','3','--file',file]);assert.equal(hunter.previews[again].data,h1,'the same report reuses the same salt, so a rerun never changes the commit');
  const rec=fs.readdirSync(path.join(dir,'state4','bounty')).map(n=>JSON.parse(fs.readFileSync(path.join(dir,'state4','bounty',n),'utf8')))[0];assert.equal(rec.body,REPORT);assert.equal(rec.reportHash,reportHashOf(REPORT));
  assert.equal(commitHashOf(NIB_BUG_BOUNTY,BigInt(bountyId),f.accounts[4].address,3,rec.reportHash,rec.salt),await f.br('commitHashFor',[BigInt(bountyId),f.accounts[4].address,3,rec.reportHash,rec.salt]),'local commit hash equals the contract\'s');
  const stakeBefore=await f.bal(f.accounts[4].address);const c=await hunter.run(['bounty-commit',bountyId,'--severity','3','--file',file]);assert.match(c.text,/do bounty-reveal/);assert.equal(await f.bal(f.accounts[4].address),stakeBefore-E(200),'only the stake was taken');
  // the report text is NOT on-chain nor readable by the project yet
  const subId=String((await f.br('submissionNonce'))as bigint);
  await assert.rejects(runDo(project.ctx,['bounty-report',subId]),/only after the hunter reveals/);
  await hunter.run(['bounty-reveal',bountyId]);assert.match(hunter.out.join('\n'),/Report stored encrypted/);assert.equal(Number((await f.br('getSubmission',[BigInt(subId)])).status),2);
  await runDo(project.ctx,['bounty-report',subId]);const text=project.out.join('\n');assert.match(text,/BEGIN UNTRUSTED REPORT TEXT/);assert.match(text,/router\.skim\(\)/);assert.match(text,/matches on-chain hash: true/);
  await assert.rejects(runDo(hunter2.ctx,['bounty-report',subId]),/not allowed/);
  await assert.rejects(runDo(hunter.ctx,['bounty-reveal',bountyId]),/No confirmed commit/);
 });
 await t.test('project decides: reject needs a reason, accept pays the fixed tier minus the fee and returns the stake',async()=>{
  const subId=String((await f.br('submissionNonce'))as bigint);
  await assert.rejects(runDo(project.ctx,['bounty-reject',subId]),/--reason/);await assert.rejects(runDo(project.ctx,['bounty-reject',subId,'--reason','duplicate']),/duplicate/i);await assert.rejects(runDo(hunter.ctx,['bounty-accept',subId,'--severity','3']),/Only the project/);
  await assert.rejects(runDo(project.ctx,['bounty-accept',subId,'--severity','4']),/whole number from 1 to 3/);
  const hb=await f.bal(f.accounts[4].address),fb=await f.bal(f.feeTo);
  const a=await project.run(['bounty-accept',subId,'--severity','3']);assert.match(a.text,/Pays nib: 50000/);assert.match(a.text,/Hunter receives nib: 49000/);
  assert.equal(await f.bal(f.accounts[4].address),hb+E(49000)+E(200),'hunter gets the tier minus 2% fee, plus the stake back');assert.equal(await f.bal(f.feeTo),fb+E(1000));await f.solvent('after accept');
  const book=(await runDo(hunter.ctx,['bounty-book']),hunter.out.join('\n'));assert.match(book,/#1 /);
 });
 await t.test('hostile site: swapped calldata, swapped commit hash or an inflated approval is refused before Binance is even asked',async()=>{
  // a site that rewrites every transaction it returns (here: commit hash replaced, approvals inflated)
  const evil=await agent(6,'evil',(kind,res)=>{if(kind!=='bounty-tx')return res;const s=res.bugBounty.steps;const last=s[s.length-1].transaction;const d=encodeFunctionData({abi:bountyCallAbi,functionName:'commit',args:[BigInt(bountyId),'0x'+'99'.repeat(32)]});if(/^0x[0-9a-f]{8}/.test(last.data)&&res.bugBounty.action==='commit')last.data=d;return res;});
  // create a fresh open bounty so commit is possible
  await project.run(['bounty-create','--tiers','10000,25000','--deposit','80000','--days','20','--scope-file',write('scope2.md',SCOPE+' second')]);
  const id2=(await project.ctx.rawAction(project.s,'bounty-state')).bugBounty.bounties[0].id;
  const bawCalls=evil.previews;await assert.rejects(runDo(evil.ctx,['bounty-commit',id2,'--severity','2','--file',write('r2.md',REPORT+'2')]),/Argument 2|differs/);assert.equal(Object.keys(bawCalls).length,0,'Binance was never asked to preview the swapped call');
  const evil2=await agent(7,'evil2',(kind,res)=>{if(kind==='bounty-tx'){for(const st of res.bugBounty.steps)st.transaction.to='0x'+'ee'.repeat(20);}return res;});
  await assert.rejects(runDo(evil2.ctx,['bounty-commit',id2,'--severity','2','--file',write('r3.md',REPORT+'3')]),/must go to/);assert.equal(Object.keys(evil2.previews).length,0);
 });
 await t.test('journal re-validation: a tampered saved preview is refused at execute time',async()=>{
  const sub=String((await f.br('bountyNonce'))as bigint);const id=await rival.prepare(['bounty-topup',sub,'--amount','1']).catch(()=>null);
  // rival is not the creator, so the site refuses; use the project instead
  void id;const pid=await project.prepare(['bounty-topup',sub,'--amount','1000']);
  const j=JSON.parse(fs.readFileSync(project.ctx.journalFile,'utf8'));j.previews[pid].tx.data=j.previews[pid].tx.data.replace(/.$/,c=>c==='0'?'1':'0');fs.writeFileSync(project.ctx.journalFile,JSON.stringify(j));
  await assert.rejects(execute(project.ctx,pid,true),/differs|Refusing/);
  await assert.rejects(execute(project.ctx,pid,false),/after the user approved/);
 });
});
