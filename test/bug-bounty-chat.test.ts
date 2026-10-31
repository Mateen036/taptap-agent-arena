import {test,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {encodeFunctionData,decodeFunctionData,parseAbi,parseUnits,formatUnits,getAbiItem,toFunctionSelector} from 'viem';import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {setup,closeAll,E,DAY,bountyArtifact} from './helpers/bounty-chain';import {databaseFixture} from './helpers/database';
import {handle} from '../lib/api';import {actionData,AGENT_ID_REGISTRY} from '../lib/protocol';
import {runDo,execute,validateServerTx,NIB_BUG_BOUNTY,type Ctx,type Expect} from '../agent/do';
import {NIB_TOKEN_PIN,bountyCallAbi,commitHashOf,prepareCommit,reportHashOf,scopeHashOf} from '../agent/bounty';
import {bugBountyPlan,NIB_TOKEN_ADDRESS} from '../scripts/nib-bug-bounty-deploy';
after(closeAll);
const KEY='cd'.repeat(32);
const TAP0=5000n,STAKE=1000n;
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
 const H='0x'+'11'.repeat(32),L='0x'+'33'.repeat(32),SIG='0x'+'44'.repeat(65);
 const approve=(spender:string,amount:bigint,to=NIB_TOKEN_PIN)=>({chainId:56,from:W,to,value:'0',data:encodeFunctionData({abi:parseAbi(['function approve(address,uint256) returns (bool)']),functionName:'approve',args:[spender as any,amount]})});
 const ea:Partial<Expect>={kind:'bounty-approve',amountRaw:E(500)};
 ok(approve(NIB_BUG_BOUNTY,E(500)),ea);
 no(approve(OTHER,E(500)),ea,/spender must be the Bug Bounty/);no(approve(NIB_BUG_BOUNTY,E(501)),ea,/differs/);no(approve(NIB_BUG_BOUNTY,2n**256n-1n),{kind:'bounty-approve',amountRaw:2n**256n-1n},/bounded/);
 no(approve(NIB_BUG_BOUNTY,E(500),OTHER),ea,/NIB token/);no(approve(NIB_BUG_BOUNTY,E(500)),{kind:'bounty-approve'},/differs/);no(approve(NIB_BUG_BOUNTY,0n),{kind:'bounty-approve',amountRaw:0n},/bounded/);
 // commit: hash and TAP stake exactly as the user asked; the ticket (lock id, signature) is the server's, its deadline must be near
 const commit=(over:any={})=>tx('commit',[7n,over.hash??H,over.stake??1000n,L,BigInt(over.deadline??now+900),SIG],over.to);
 const ec:Partial<Expect>={fn:'commit',args:['7',H,'1000',null,null,null],endsAtRange:[now-60,now+1800],endsAtIndex:4};
 ok(commit(),ec);
 no(commit({to:OTHER}),ec,/must go to/);no(commit({hash:'0x'+'22'.repeat(32)}),ec,/Argument 2/);no(commit({stake:1n}),ec,/Argument 3/);no(commit({stake:999999n}),ec,/Argument 3/);no(commit({deadline:now+86400*30}),ec,/end time/);
 no(tx('commit',[7n,H,1000n,L,BigInt(now+900),SIG],NIB_BUG_BOUNTY,'1'),ec,/never send BNB/);no(tx('commit',[8n,H,1000n,L,BigInt(now+900),SIG]),ec,/Argument 1/);
 no({...commit(),from:'0x'+'c3'.repeat(20)},ec,/wallet or chain/);no({...commit(),chainId:1},ec,/wallet or chain/);no(commit(),{...ec,fn:'reveal'},/Unexpected function/);no(commit(),{fn:'commit'},/No expectation/);
 no({...commit(),data:'0xdeadbeef'},ec,/Unknown Bug Bounty function/);
 // a function the contract has but the user did not ask for
 no(tx('claimReward',[]),{fn:'commit',args:['7',H,'1000',null,null,null]},/Unexpected function/);ok(tx('claimReward',[]),{fn:'claimReward',args:[]});
 no(tx('revealVote',[3n,2,0n,H]),{fn:'revealVote',args:['3','4','0',H]},/Argument 2/);ok(tx('revealVote',[3n,2,0n,H]),{fn:'revealVote',args:['3','2','0',H]});
 ok(tx('applyToReview',[3n,1000n,L,BigInt(now+900),SIG]),{fn:'applyToReview',args:['3','1000',null,null,null],endsAtRange:[now-60,now+1800],endsAtIndex:3});
 // create: tiers, panel size, TAP stake, deposit exactly; the end time inside the window the user asked for
 const tiers=[E(10000),E(25000)],create=(over:any={})=>tx('createBounty',[over.scope??scopeHashOf(SCOPE),over.tiers??tiers,BigInt(over.ends??now+30*DAY),over.panel??3n,over.stake??1000n,over.deposit??E(300000)]);
 const ecr:Partial<Expect>={fn:'createBounty',args:[scopeHashOf(SCOPE),'['+tiers.join(',')+']',null,'3','1000',E(300000).toString()],endsAtRange:[now+30*DAY-900,now+30*DAY+900],endsAtIndex:2};
 ok(create(),ecr);no(create({scope:H}),ecr,/Argument 1/);no(create({tiers:[E(10000),E(2500000)]}),ecr,/Argument 2/);no(create({ends:now+400*DAY}),ecr,/end time/);no(create({ends:now+DAY}),ecr,/end time/);no(create({panel:9n}),ecr,/Argument 4/);no(create({stake:1n}),ecr,/Argument 5/);no(create({deposit:E(1)}),ecr,/Argument 6/);
});
for(const kind of ['sqlite'] as const)test('chat flow end to end: create, TAP-staked commit and reveal, reviewer panel, sealed votes, payout, hostile-site refusals, hidden until configured',async t=>{
 const f=await setup({server:true,pin:{nib:NIB_TOKEN_PIN,bounty:NIB_BUG_BOUNTY,registry:AGENT_ID_REGISTRY}});
 assert.equal(f.bounty.toLowerCase(),NIB_BUG_BOUNTY.toLowerCase());
 const db=await databaseFixture(kind),dir=fs.mkdtempSync(path.join(os.tmpdir(),'taptap-bounty-'));
 const base:any={DB:db,BSC_RPC_URL:f.rpc,NIB_TOKEN:NIB_TOKEN_PIN,BUG_BOUNTY_REPORT_KEY:KEY,BUG_BOUNTY_SIGNER_PRIVATE_KEY:f.keys[1]};const envOn:any={...base,BUG_BOUNTY_CONTRACT:NIB_BUG_BOUNTY};let env=base;
 const req=async(p:string,body?:any,uid='bb-user')=>{const r=await handle(new Request('https://bb.test/api/'+p,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':uid,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,body:await r.json() as any};};
 const write=(name:string,text:string)=>{const p=path.join(dir,name);fs.writeFileSync(p,text);return p;};
 async function agent(index:number,uid:string,tamper?:(kind:string,res:any)=>any){
  const account=f.accounts[index],session=privateKeyToAccount(generatePrivateKey()),pair=await req('pair',{},uid),ch=await req('agent/challenge',{pairingCode:pair.body.pairingCode,wallet:account.address,sessionKey:session.address},uid),signed=await req('agent/session',{challengeId:ch.body.challengeId,signature:await account.signTypedData(ch.body.typedData)},uid);assert.equal(signed.status,200,JSON.stringify(signed.body));
  await db.prepare('UPDATE agents SET points=?,earned=? WHERE wallet=?').bind(Number(TAP0),Number(TAP0),account.address.toLowerCase()).run();
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
 // 8: project; 4: hunter; 5: second hunter; 9-14: the reviewer agents; 6 and 7: hostile-site victims
 await f.w(f.nib,f.nibArt.abi,'approve',[f.bounty,0n],8);// the project has not approved the bounty contract yet
 let skew=0;const realNow=Date.now;Date.now=()=>realNow()+skew*1000;t.after(()=>{Date.now=realNow;});// the site judges deadlines by the wall clock, which must follow the chain's time warps
 const warp=async(sec:number)=>{await f.warp(sec);skew+=sec;await db.prepare('UPDATE sessions SET expires_at=expires_at+?,verified_at=verified_at+?').bind(sec*1000,sec*1000).run();};// agent sessions are only valid for a while: move them along with the clock
 const project=await agent(8,'project'),hunter=await agent(4,'hunter'),hunter2=await agent(5,'hunter2');
 const reviewers:any[]=[];for(let i=9;i<=14;i++)reviewers.push(await agent(i,'rev'+i));
 const tapOf=async(a:any)=>{await runDo(a.ctx,['bounty-book']);const r:any=await db.prepare('SELECT * FROM agents WHERE wallet=?').bind(a.account.address.toLowerCase()).first();return BigInt(r.points_exact??r.points);};
 await t.test('hidden until configured: bounty-book says not live and writing commands are refused',async()=>{
  await runDo(project.ctx,['bounty-book']);assert.match(project.out.join('\n'),/not live yet/);
  assert.equal((await req('bug-bounty')).body.enabled,false);
  await assert.rejects(runDo(project.ctx,['bounty-commit','1','--severity','2','--file',write('r0.md',REPORT)]),/not available|not live/i);
  env=envOn;
 });
 let bountyId='',subId='';
 await t.test('create: step 1 approves exactly the deposit, step 2 creates and the scope is published automatically; the 10,000 NIB minimum is enforced',async()=>{
  const sc=write('scope.md',SCOPE);const args=['bounty-create','--tiers','10000,25000,50000,100000','--deposit','300000','--days','30','--scope-file',sc];
  const before=await f.bal(f.accounts[8].address);
  await assert.rejects(runDo(project.ctx,['bounty-create','--tiers','10000,25000','--deposit','300000','--days','3','--scope-file',sc]),/--days must be/);
  await assert.rejects(runDo(project.ctx,['bounty-create','--tiers','50000,25000','--deposit','300000','--scope-file',sc]),/strictly increase/);
  await assert.rejects(runDo(project.ctx,['bounty-create','--tiers','9999','--deposit','300000','--scope-file',sc]),/minimum bounty size is 10,000/);
  await assert.rejects(runDo(project.ctx,['bounty-create','--tiers','10000','--deposit','300000']),/--scope-file/);
  await assert.rejects(runDo(project.ctx,[...args,'--panel','4']),/3, 5, 7 or 9/);await assert.rejects(runDo(project.ctx,[...args,'--tap-stake','10']),/--tap-stake/);
  const one=await project.run(args);assert.match(one.text,/Step 1 of 2: approve exactly 300000 NIB/);assert.equal(await f.bal(f.accounts[8].address),before,'an approval moves no NIB');
  const two=await project.run(args);assert.match(two.text,/Escrowed nib: 300000/);assert.match(two.text,/2% platform fee/);assert.match(two.text,/20% shared by the reviewers/);
  assert.equal(await f.bal(f.accounts[8].address),before-E(300000));assert.equal(await f.bal(NIB_BUG_BOUNTY as any),E(300000));
  const b=(await project.ctx.rawAction(project.s,'bounty-state')).bugBounty.bounties[0];bountyId=b.id;
  assert.equal(b.creator,f.accounts[8].address.toLowerCase());assert.equal(b.scope.verified,true,'scope text was published after the create confirmed');assert.equal(b.scope.text,SCOPE);assert.equal(b.tapStake,'1000');assert.equal(b.panelSize,3);
 });
 await t.test('hunter: commit takes only TAP (no NIB), the saved salt is reused, reveal uploads the report privately',async()=>{
  const file=write('report.md',REPORT);
  await assert.rejects(runDo(hunter.ctx,['bounty-commit',bountyId,'--severity','9','--file',file]),/--severity/);await assert.rejects(runDo(hunter.ctx,['bounty-commit',bountyId,'--severity','3']),/--file/);await assert.rejects(runDo(hunter.ctx,['bounty-commit',bountyId,'--severity','3','--file',write('empty.md','  \n')]),/empty/);
  await assert.rejects(runDo(project.ctx,['bounty-commit',bountyId,'--severity','3','--file',file]),/own bounty|cannot|creator/i);
  const first=await hunter.prepare(['bounty-commit',bountyId,'--severity','3','--file',file]);const h1=hunter.previews[first].data;
  assert.equal(await tapOf(hunter),TAP0-STAKE,'TAP was locked when the ticket was issued');
  const again=await hunter.prepare(['bounty-commit',bountyId,'--severity','3','--file',file]);assert.equal(hunter.previews[again].data,h1,'a rerun re-signs the same ticket and the same salt: nothing is locked twice');assert.equal(await tapOf(hunter),TAP0-STAKE);
  const rec=fs.readdirSync(path.join(dir,'state4','bounty')).map(n=>JSON.parse(fs.readFileSync(path.join(dir,'state4','bounty',n),'utf8')))[0];assert.equal(rec.body,REPORT);assert.equal(rec.reportHash,reportHashOf(REPORT));
  assert.equal(commitHashOf(NIB_BUG_BOUNTY,BigInt(bountyId),f.accounts[4].address,3,rec.reportHash,rec.salt),await f.br('commitHashFor',[BigInt(bountyId),f.accounts[4].address,3,rec.reportHash,rec.salt]),'local commit hash equals the contract\'s');
  const nibBefore=await f.bal(f.accounts[4].address);const c=await hunter.run(['bounty-commit',bountyId,'--severity','3','--file',file]);assert.match(c.text,/do bounty-reveal/);assert.equal(await f.bal(f.accounts[4].address),nibBefore,'no NIB is staked');assert.equal(await tapOf(hunter),TAP0-STAKE);
  subId=String((await f.br('submissionNonce'))as bigint);
  await assert.rejects(runDo(project.ctx,['bounty-report',subId]),/only after|not allowed|reveal/i);
  await hunter.run(['bounty-reveal',bountyId]);assert.match(hunter.out.join('\n'),/Report stored encrypted/);assert.equal(Number((await f.br('getSubmission',[BigInt(subId)])).status),2);
  await assert.rejects(runDo(hunter.ctx,['bounty-reveal',bountyId]),/No confirmed commit/);
 });
 let panel:number[]=[];
 await t.test('reviewers: six agents apply with TAP, a random panel of three is drawn, the creator and the hunter cannot apply',async()=>{
  await assert.rejects(runDo(project.ctx,['bounty-review',subId,'--bounty',bountyId]),/creator|cannot|own/i);await assert.rejects(runDo(hunter.ctx,['bounty-review',subId,'--bounty',bountyId]),/hunter|cannot|own/i);
  await assert.rejects(runDo(reviewers[0].ctx,['bounty-review',subId]),/--bounty/);
  for(const r of reviewers){await r.run(['bounty-review',subId,'--bounty',bountyId]);assert.equal(await tapOf(r),TAP0-STAKE,'the reviewer stake is locked');}
  await assert.rejects(runDo(project.ctx,['bounty-start-selection',subId]),/Applications|window|open|early/i);
  await warp(48*3600+5);await project.run(['bounty-start-selection',subId]);await assert.rejects(runDo(project.ctx,['bounty-select',subId]),/seed block/);await f.mine(2);await project.run(['bounty-select',subId]);
  const sub=await f.br('panelOf',[BigInt(subId)]) as string[];panel=sub.map(a=>f.accounts.findIndex((x:any)=>x.address===a));assert.equal(panel.length,3);assert.ok(panel.every(i=>i>=9&&i<=14));
 });
 await t.test('panel: only seated reviewers can read the report; they seal and open votes; finalize pays 2% fee, 20% to the panel, the rest to the hunter, and every TAP stake comes back',async()=>{
  const seated=reviewers.filter(r=>panel.includes(r.index));assert.equal(seated.length,3);const unseated=reviewers.filter(r=>!panel.includes(r.index));
  await runDo(seated[0].ctx,['bounty-report',subId]);const text=seated[0].out.join('\n');assert.match(text,/BEGIN UNTRUSTED REPORT TEXT/);assert.match(text,/router\.skim\(\)/);assert.match(text,/matches on-chain hash: true/);
  await assert.rejects(runDo(unseated[0].ctx,['bounty-report',subId]),/Only the hunter/);await assert.rejects(runDo(hunter2.ctx,['bounty-report',subId]),/Only the hunter/);
  await assert.rejects(runDo(seated[0].ctx,['bounty-vote',subId]),/--verdict/);await assert.rejects(runDo(seated[0].ctx,['bounty-vote',subId,'--verdict','7']),/--verdict/);
  await assert.rejects(runDo(unseated[0].ctx,['bounty-vote',subId,'--verdict','3']),/panel|not seated|seated/i);
  for(const r of seated){await r.run(['bounty-vote',subId,'--verdict','3']);}
  const files=fs.readdirSync(path.join(dir,'state'+seated[0].index,'bounty')).filter(n=>n.startsWith('vote-'));assert.equal(files.length,1);
  await assert.rejects(runDo(seated[0].ctx,['bounty-open-vote','999']),/No saved vote/);
  const fb=await f.bal(f.feeTo),hb=await f.bal(f.accounts[4].address);
  for(const r of seated)await r.run(['bounty-open-vote',subId]);
  const fin=await project.run(['bounty-finalize',subId]);assert.match(fin.text,/finalize|Count the panel/i);
  const share=E(10000)/3n;
  assert.equal(await f.bal(f.feeTo),fb+E(1000),'2% of the 50,000 payout went to the fee recipient');
  assert.equal(await f.bal(f.accounts[4].address),hb+E(39000)+(E(10000)-3n*share),'hunter: 50,000 - 2% fee - 20% reviewer pool (plus the rounding dust)');
  for(const r of seated){const b0=await f.bal(r.account.address);await r.run(['bounty-claim']);assert.equal(await f.bal(r.account.address),b0+share,'aligned reviewers split the 20% pool equally');}
  await f.solvent('after finalize and claims');
  for(const r of [hunter,...reviewers])assert.equal(await tapOf(r),TAP0,'every TAP stake was returned (valid report, aligned votes, unselected applicants)');
 });
 await t.test('hostile site: a swapped commit hash, a swapped TAP stake, a far-future ticket deadline or a swapped destination is refused before Binance is asked',async()=>{
  const mod=(fn:(d:any)=>any)=>(kind:string,res:any)=>{if(kind!=='bounty-tx')return res;const last=res.bugBounty.steps[res.bugBounty.steps.length-1].transaction;const d=decodeFunctionData({abi:bountyCallAbi,data:last.data});if(d.functionName==='commit')last.data=encodeFunctionData({abi:bountyCallAbi,functionName:'commit',args:fn([...d.args as any[]])} as any);return res;};
  const file=(n:string)=>write(n+'.md',REPORT+n);
  const e1=await agent(6,'evil1',mod(a=>{a[1]='0x'+'99'.repeat(32);return a;}));await assert.rejects(runDo(e1.ctx,['bounty-commit',bountyId,'--severity','2','--file',file('a')]),/Argument 2/);assert.equal(Object.keys(e1.previews).length,0,'Binance was never asked to preview the swapped call');
  const e2=await agent(7,'evil2',mod(a=>{a[2]=1n;return a;}));await assert.rejects(runDo(e2.ctx,['bounty-commit',bountyId,'--severity','2','--file',file('b')]),/Argument 3/);
  const e3=await agent(15,'evil3',mod(a=>{a[4]=a[4]+86400n*365n;return a;}));await assert.rejects(runDo(e3.ctx,['bounty-commit',bountyId,'--severity','2','--file',file('c')]),/end time/);
  const e4=await agent(16,'evil4',(kind,res)=>{if(kind==='bounty-tx'){for(const st of res.bugBounty.steps)st.transaction.to='0x'+'ee'.repeat(20);}return res;});await assert.rejects(runDo(e4.ctx,['bounty-commit',bountyId,'--severity','2','--file',file('d')]),/must go to/);
  for(const e of [e2,e3,e4])assert.equal(Object.keys(e.previews).length,0);
 });
 await t.test('journal re-validation: a tampered saved preview is refused at execute time',async()=>{
  const pid=await project.prepare(['bounty-topup',bountyId,'--amount','1000']);
  const j=JSON.parse(fs.readFileSync(project.ctx.journalFile,'utf8'));j.previews[pid].tx.data=j.previews[pid].tx.data.replace(/.$/,c=>c==='0'?'1':'0');fs.writeFileSync(project.ctx.journalFile,JSON.stringify(j));
  await assert.rejects(execute(project.ctx,pid,true),/differs|Refusing/);
  await assert.rejects(execute(project.ctx,pid,false),/after the user approved/);
 });
});
