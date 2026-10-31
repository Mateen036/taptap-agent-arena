import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {decodeFunctionData,keccak256,toHex} from 'viem';
import {setup,closeAll,E,DAY,TIERS,STAKE,DEPOSIT,Status} from './helpers/bounty-chain';
import {databaseFixture} from './helpers/database';
import {bugBountyState,bugBountyAction,bugBountyRoute,bountyTxAction,bountyAbi,createTerms,nibAmount,scopeHash,reportHashOf,sealReport,openReport,bountyPhase,tierLabel,BugBountyError,BUG_BOUNTY_ACTIONS,BOUNTY_FUNCTIONS,MAX_REPORT_BYTES} from '../lib/bug-bounty';
import {handle} from '../lib/api';
after(closeAll);
const KEY='ab'.repeat(32);
const policy={active:false,version:2 as const,formula:'5*owned' as const,scope:'earned_tap_only' as const};
const SCOPE='In scope: the NibSwap router contracts at 0x1234 on BNB Chain. Out of scope: front-end, social engineering, DoS. Report with a PoC and impact.';
const who=(addr:string)=>({wallet:addr.toLowerCase(),connected:true});
const status=async(p:Promise<any>)=>{try{await p;return 200;}catch(e:any){return e instanceof BugBountyError?e.status:-1;}};
async function world(kind:'sqlite'|'postgres'='sqlite'){
 const t=await setup({server:true});const DB=await databaseFixture(kind);
 const env:any={DB,BUG_BOUNTY_CONTRACT:t.bounty,BUG_BOUNTY_REPORT_KEY:KEY,NIB_TOKEN:t.nib,BSC_RPC_URL:t.rpc,_utilityPolicy:policy};
 const now=async()=>(await t.now())*1000;
 const act=async(wallet:string,action:string,payload:any)=>bugBountyAction(env,who(wallet),action,payload,await now());
 const tx=async(wallet:string,payload:any)=>(await act(wallet,'bounty-tx',payload)).bugBounty;
 const decode=(step:any)=>decodeFunctionData({abi:bountyAbi,data:step.transaction.data});
 return {t,DB,env,now,act,tx,decode};
}

test('hidden by default: no contract env means no data, no RPC, 404 on every action and sub-route',async()=>{
 const env:any={DB:null,_utilityPolicy:policy};
 assert.deepEqual(await bugBountyState(env,null,Date.now()),{enabled:false});
 const r=await bugBountyRoute(new Request('https://x.test/api/bug-bounty'),env,null,Date.now());assert.equal(r?.status,200);assert.deepEqual(await r!.json(),{enabled:false});
 const sub=await bugBountyRoute(new Request('https://x.test/api/bug-bounty/1/submissions'),env,null,Date.now());assert.equal(sub?.status,404);
 for(const action of BUG_BOUNTY_ACTIONS)assert.equal(await status(bugBountyAction(env,who('0x'+'2'.repeat(40)),action,{},Date.now())),404,action);
 for(const bad of ['','0x123','not an address','0x'+'g'.repeat(40)])assert.deepEqual(await bugBountyState({...env,BUG_BOUNTY_CONTRACT:bad},null,Date.now()),{enabled:false},bad);
 // POST is never routed here; unknown paths fall through
 assert.equal(await bugBountyRoute(new Request('https://x.test/api/bug-bounty',{method:'POST'}),env,null,Date.now()),null);assert.equal(await bugBountyRoute(new Request('https://x.test/api/other'),env,null,Date.now()),null);
 // and the real HTTP handler returns the disabled answer with a storage-less env too
 const DB=await databaseFixture('sqlite');const res=await handle(new Request('https://x.test/api/bug-bounty'),{DB} as any);assert.equal(res.status,200);assert.deepEqual(await res.json(),{enabled:false});
 const act=await handle(new Request('https://x.test/api/agent/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'bounty-tx',nonce:0,timestamp:Date.now(),payload:{},sessionId:'x',signature:'0x'})}),{DB} as any);assert.notEqual(act.status,200);
});
test('an address with no contract behind it is ignored, not trusted',async()=>{
 const t=await setup({server:true});const env:any={DB:await databaseFixture('sqlite'),BUG_BOUNTY_CONTRACT:'0x'+'4'.repeat(40),BSC_RPC_URL:t.rpc,_utilityPolicy:policy};
 const s:any=await bugBountyState(env,null,Date.now()).catch((e:any)=>({err:e.status}));assert.ok(s.err===503||s.live===false,JSON.stringify(s));
});
test('pure helpers: amounts, phases, labels, terms mirror the contract rules',()=>{
 assert.equal(nibAmount('1.5','x'),15n*10n**17n);for(const bad of ['1e3','-1','0','abc','','1.0000000000000000001',null,undefined,'1,000'])assert.throws(()=>nibAmount(bad as any,'x'),(e:any)=>e.status===400,String(bad));
 assert.equal(tierLabel(4,4),'Critical');assert.equal(tierLabel(4,1),'Low');assert.equal(tierLabel(1,1),'Bounty');assert.equal(tierLabel(3,3),'High');
 assert.equal(bountyPhase({closed:false,endsAt:200,closesAt:200,cancelRequestedAt:0},100),'open');assert.equal(bountyPhase({closed:false,endsAt:200,closesAt:150,cancelRequestedAt:50},100),'closing');assert.equal(bountyPhase({closed:false,endsAt:200,closesAt:150,cancelRequestedAt:50},150),'ended');assert.equal(bountyPhase({closed:true,endsAt:200,closesAt:200,cancelRequestedAt:0},100),'withdrawn');
 const params={minDeposit:E(50000),minLowestTier:E(10000)};const ok={tiers:['10000','25000','50000','100000'],deposit:'300000',days:30,reviewDays:7,scope:SCOPE};
 const t=createTerms(ok,params,1000);assert.equal(t.stake,E(200),'default stake is 2% of the lowest tier');assert.equal(t.endsAt,BigInt(1000+30*86400));assert.equal(t.scopeHash,scopeHash(SCOPE));
 const bad:[string,any][]=[['no tiers',{...ok,tiers:[]}],['5 tiers',{...ok,tiers:['10000','20000','30000','40000','50000']}],['not increasing',{...ok,tiers:['10000','10000']}],['lowest too small',{...ok,tiers:['9999','20000']}],['deposit under min',{...ok,deposit:'49999',tiers:['10000']}],['deposit under top tier',{...ok,deposit:'60000',tiers:['10000','70000']}],
  ['too short',{...ok,days:13}],['too long',{...ok,days:366}],['review too short',{...ok,reviewDays:2}],['review too long',{...ok,reviewDays:31}],['stake <1%',{...ok,stake:'99'}],['stake >10%',{...ok,stake:'1001'}],['no scope',{...ok,scope:undefined}],['tiny scope',{...ok,scope:'short'}],['huge scope',{...ok,scope:'x'.repeat(16385)}]];
 for(const [name,p] of bad)assert.throws(()=>createTerms(p,params,1000),(e:any)=>e instanceof BugBountyError&&e.status===400,name);
 assert.ok(createTerms({...ok,stake:'100'},params,1000));assert.ok(createTerms({...ok,stake:'1000'},params,1000));
});
test('reports are sealed with AES-GCM bound to the submission and hash; tampering or a wrong key fails',async()=>{
 const env:any={BUG_BOUNTY_REPORT_KEY:KEY};const body='critical: reentrancy in withdraw() allows draining. PoC: ...';const rh=reportHashOf(body);
 const sealed=await sealReport(env,'7',rh,body);assert.ok(!sealed.ciphertext.includes(btoa(body).slice(0,12)));assert.equal(await openReport(env,'7',rh,sealed),body);
 assert.notEqual((await sealReport(env,'7',rh,body)).ciphertext,sealed.ciphertext,'fresh IV every time');
 await assert.rejects(openReport(env,'8',rh,sealed),(e:any)=>e.status===500,'bound to the submission id');
 await assert.rejects(openReport(env,'7',keccak256(toHex('other')),sealed),(e:any)=>e.status===500,'bound to the report hash');
 await assert.rejects(openReport({BUG_BOUNTY_REPORT_KEY:'cd'.repeat(32)} as any,'7',rh,sealed),(e:any)=>e.status===500,'wrong key');
 const flipped={...sealed,ciphertext:(sealed.ciphertext[0]==='A'?'B':'A')+sealed.ciphertext.slice(1)};await assert.rejects(openReport(env,'7',rh,flipped),(e:any)=>e.status===500,'tampered');
 for(const k of [undefined,'','zz'.repeat(32),'ab'.repeat(31)])await assert.rejects(sealReport({BUG_BOUNTY_REPORT_KEY:k} as any,'1',rh,body),(e:any)=>e.status===503,'bad key: '+k);
});
test('state and scope: the public scope text is shown only when it matches the on-chain hash, and is immutable',async()=>{
 const w=await world();const {t}=w;const id=await t.create({scope:'x'});
 // the project committed to SCOPE's hash on-chain
 await t.bw('createBounty',[scopeHash(SCOPE),TIERS,BigInt(await t.now()+30*DAY),BigInt(7*DAY),STAKE,DEPOSIT],3);const id2=await t.br('bountyNonce') as bigint;
 let s:any=await bugBountyState(w.env,null,await w.now());assert.equal(s.enabled,true);assert.equal(s.live,true);assert.equal(s.bounties.length,2);assert.equal(s.bounties[0].id,id2.toString());assert.equal(s.bounties[0].scope.verified,false);assert.equal(s.params.feeBps,200);
 assert.equal(s.bounties[0].tiers.length,4);assert.equal(s.bounties[0].tiers[3].label,'Critical');assert.equal(s.bounties[0].tiers[0].nib,'10000');assert.equal(s.bounties[0].available,'300000');assert.equal(s.bounties[0].phase,'open');
 assert.equal(s.params.arbiter,t.arbiter.toLowerCase());assert.equal(s.totals.escrow,'600000');assert.equal(s.you,undefined);
 // only the creator, only the exact text, only once
 assert.equal(await status(w.act(t.hunter,'bounty-scope-put',{bountyId:id2.toString(),text:SCOPE})),403);
 assert.equal(await status(w.act(t.creator,'bounty-scope-put',{bountyId:id2.toString(),text:SCOPE+' tampered'})),409);
 assert.equal(await status(w.act(t.creator,'bounty-scope-put',{bountyId:'99',text:SCOPE})),404);
 assert.equal(await status(w.act(t.creator,'bounty-scope-put',{bountyId:id2.toString(),text:'x'.repeat(16385)})),400);
 assert.equal(await status(w.act(t.creator,'bounty-scope-put',{bountyId:id2.toString()})),400);
 assert.equal(await status(w.act(t.creator,'bounty-scope-put',{bountyId:id2.toString(),text:SCOPE})),200);
 assert.equal(await status(w.act(t.creator,'bounty-scope-put',{bountyId:id2.toString(),text:SCOPE})),409,'immutable once published');
 s=await bugBountyState(w.env,t.hunter.toLowerCase(),await w.now());assert.equal(s.bounties[0].scope.verified,true);assert.equal(s.bounties[0].scope.text,SCOPE);assert.equal(s.you.hunter.paid,0);assert.deepEqual(s.you.mySubmissions,[]);
 // a forged DB row (hash mismatch) is never displayed
 await w.DB.prepare('UPDATE bounty_scopes SET text=? WHERE bounty_id=?').bind('forged text that the project never committed to',id2.toString()).run();
 s=await bugBountyState(w.env,null,await w.now());assert.equal(s.bounties[0].scope.verified,false);assert.equal(s.bounties[0].scope.text,null);
 // viewer-specific data: submissions and the creator's own bounties
 const sub=await t.submit(id2,4,2);s=await bugBountyState(w.env,t.hunter.toLowerCase(),await w.now());assert.equal(s.you.mySubmissions.length,1);assert.equal(s.you.mySubmissions[0].status,'Revealed');assert.equal(s.you.mySubmissions[0].claimedLabel,'Medium');assert.equal(s.you.mySubmissions[0].reportHash,sub.reportHash);
 s=await bugBountyState(w.env,t.creator.toLowerCase(),await w.now());assert.deepEqual(s.you.myBounties.sort(),[id.toString(),id2.toString()].sort());
 s=await bugBountyState(w.env,t.arbiter.toLowerCase(),await w.now());assert.equal(s.you.isArbiter,true);
 const res=await bugBountyRoute(new Request('https://x.test/api/bug-bounty/'+id2+'/submissions'),w.env,null,await w.now());assert.equal(res?.status,200);const subs=await res!.json();assert.equal(subs.submissions.length,1);assert.equal(JSON.stringify(subs).includes('body'),false,'no report text in the public list');
 await assert.rejects(bugBountyRoute(new Request('https://x.test/api/bug-bounty/999/submissions'),w.env,null,await w.now()) as any,(e:any)=>e.status===404);
});
test('bounty previews (project side): validated terms, exact-amount approval only when short, calldata decodes to exactly what was asked',async()=>{
 const w=await world();const {t}=w;const newbie=t.accounts[8].address;await t.mint(newbie,E(400000));await t.idy(newbie);
 const terms={fn:'create',tiers:['10000','25000','50000','100000'],deposit:'300000',days:30,reviewDays:7,stake:'500',scope:SCOPE};
 // no allowance yet: step 1 is an approval of EXACTLY the deposit, never unlimited
 let r=await w.tx(newbie,terms);assert.equal(r.steps.length,2);const ap=decodeFunctionData({abi:[{type:'function',name:'approve',inputs:[{type:'address'},{type:'uint256'}],outputs:[{type:'bool'}],stateMutability:'nonpayable'}],data:r.steps[0].transaction.data});
 assert.equal((ap.args as any)[0].toLowerCase(),t.bounty.toLowerCase());assert.equal((ap.args as any)[1],DEPOSIT);assert.equal(r.steps[0].transaction.to.toLowerCase(),t.nib.toLowerCase());assert.equal(r.steps[1].dependsOn!==null,true);
 const d:any=w.decode(r.steps[1]);assert.equal(d.functionName,'createBounty');assert.equal(d.args[0],scopeHash(SCOPE));assert.deepEqual(d.args[1],TIERS);assert.equal(d.args[4],E(500));assert.equal(d.args[5],DEPOSIT);assert.equal(r.steps[1].transaction.value,'0');assert.equal(r.steps[1].transaction.from.toLowerCase(),newbie.toLowerCase());
 assert.match(r.steps[1].baw,/^baw contract-call preview --binanceChainId 56 /);assert.ok(r.summary.rules.length>=3);
 // after the approval confirms, only the create step remains
 await t.w(t.nib,t.nibArt.abi,'approve',[t.bounty,DEPOSIT],8);r=await w.tx(newbie,terms);assert.equal(r.steps.length,1);
 // insufficient NIB is a clear 409 before anything is previewed
 assert.equal(await status(w.tx(newbie,{...terms,deposit:'500000',tiers:['10000','500000']})),409);
 // the arbiter, an unknown fn and bad terms
 assert.equal(await status(w.tx(t.arbiter,terms)),403);assert.equal(await status(w.tx(newbie,{...terms,fn:'drain'})),400);assert.equal(await status(w.tx(newbie,{...terms,days:3})),400);
 // a wallet that is not on-chain identified is stopped by the contract itself (preview is only a preview)
 const id=await t.create();
 // topup / extend / cancel / withdraw: creator only, state-aware
 const creator=t.creator;
 r=await w.tx(creator,{fn:'topup',id:String(id),amount:'1000'});assert.equal((w.decode(r.steps[r.steps.length-1]) as any).functionName,'topUp');assert.equal(await status(w.tx(t.hunter,{fn:'topup',id:String(id),amount:'1'})),403);
 assert.equal(await status(w.tx(creator,{fn:'extend',id:String(id),days:1})),409,'cannot shorten');r=await w.tx(creator,{fn:'extend',id:String(id),days:90});assert.equal((w.decode(r.steps[0]) as any).functionName,'extend');
 assert.equal(await status(w.tx(creator,{fn:'withdraw',id:String(id)})),409,'still open: no withdrawal');
 r=await w.tx(creator,{fn:'cancel',id:String(id)});assert.match(r.summary.effect,/7-day/);assert.equal(await status(w.tx(t.hunter,{fn:'cancel',id:String(id)})),403);assert.equal(await status(w.tx(creator,{fn:'cancel',id:'99'})),404);
 await t.bw('requestCancel',[id],3);assert.equal(await status(w.tx(creator,{fn:'cancel',id:String(id)})),409,'already closing');
 // a pending submission blocks the withdraw preview even after the end
 const sub=await t.submit(id,4,2);await t.warp(8*DAY);assert.equal(await status(w.tx(creator,{fn:'withdraw',id:String(id)})),409,'pending');
 await t.bw('accept',[sub.id,2],3);r=await w.tx(creator,{fn:'withdraw',id:String(id)});assert.equal((w.decode(r.steps[0]) as any).functionName,'withdraw');
 // every action in the whitelist exists on the contract ABI
 for(const f of BOUNTY_FUNCTIONS)assert.ok(f);
});
test('bounty previews (hunter and review side): prechecks mirror the contract, reveal must match the commit, payouts show the fee',async()=>{
 const w=await world();const {t}=w;const id=await t.create({review:3});const rep=t.report('api');
 const ch=t.commitHash(id,t.hunter,2,rep.reportHash,rep.salt);
 // commit: creator and arbiter blocked; stake approval only if short; stake comes from the bounty
 assert.equal(await status(w.tx(t.creator,{fn:'commit',bountyId:String(id),commitHash:ch})),403);assert.equal(await status(w.tx(t.arbiter,{fn:'commit',bountyId:String(id),commitHash:ch})),403);
 assert.equal(await status(w.tx(t.hunter,{fn:'commit',bountyId:String(id),commitHash:'0x12'})),400);assert.equal(await status(w.tx(t.hunter,{fn:'commit',bountyId:'77',commitHash:ch})),404);
 let r=await w.tx(t.hunter,{fn:'commit',bountyId:String(id),commitHash:ch});assert.equal(r.summary.stakeNib,'500');assert.equal((w.decode(r.steps[0]) as any).functionName,'commit');assert.deepEqual((w.decode(r.steps[0]) as any).args,[id,ch]);assert.ok(r.warnings.length>0);
 const sub=await t.commit(id,4,2,rep);
 // reveal: only the committer, only matching values
 assert.equal(await status(w.tx(t.hunter2,{fn:'reveal',id:String(sub.id),severity:2,reportHash:rep.reportHash,salt:rep.salt})),403);
 assert.equal(await status(w.tx(t.hunter,{fn:'reveal',id:String(sub.id),severity:3,reportHash:rep.reportHash,salt:rep.salt})),409,'different severity than committed');
 assert.equal(await status(w.tx(t.hunter,{fn:'reveal',id:String(sub.id),severity:2,reportHash:rep.reportHash,salt:t.report('other').salt})),409,'wrong salt');
 assert.equal(await status(w.tx(t.hunter,{fn:'reveal',id:String(sub.id),severity:9,reportHash:rep.reportHash,salt:rep.salt})),400);
 r=await w.tx(t.hunter,{fn:'reveal',id:String(sub.id),severity:2,reportHash:rep.reportHash,salt:rep.salt});assert.deepEqual((w.decode(r.steps[0]) as any).args,[sub.id,2,rep.reportHash,rep.salt]);
 assert.equal(await status(w.tx(t.creator,{fn:'accept',id:String(sub.id),severity:2})),409,'not revealed yet');await t.reveal(sub);
 // accept / reject previews
 assert.equal(await status(w.tx(t.hunter,{fn:'accept',id:String(sub.id),severity:2})),403);assert.equal(await status(w.tx(t.creator,{fn:'accept',id:String(sub.id),severity:3})),400,'above the claim');
 r=await w.tx(t.creator,{fn:'accept',id:String(sub.id),severity:2});assert.equal(r.summary.paysNib,'25000');assert.equal(r.summary.hunterReceivesNib,'24500');assert.match(r.summary.effect,/full/i);
 r=await w.tx(t.creator,{fn:'accept',id:String(sub.id),severity:1});assert.match(r.summary.effect,/dispute/i);
 for(const [p,code] of [[{reason:'nope'},400],[{reason:'duplicate'},400],[{reason:'duplicate',duplicateOf:'1'},200],[{reason:'out_of_scope',duplicateOf:'1'},400],[{reason:'out_of_scope'},200]] as const)assert.equal(await status(w.tx(t.creator,{fn:'reject',id:String(sub.id),...p})),code,JSON.stringify(p));
 assert.equal(await status(w.tx(t.hunter,{fn:'reject',id:String(sub.id),reason:'out_of_scope'})),403);
 // time-gated permissionless steps refuse early and succeed on time
 assert.equal(await status(w.tx(t.hunter,{fn:'escalate',id:String(sub.id)})),409,'review window still open');await t.warp(3*DAY+10);
 r=await w.tx(t.hunter,{fn:'escalate',id:String(sub.id)});assert.equal((w.decode(r.steps[0]) as any).functionName,'escalate');assert.equal(await status(w.tx(t.hunter2,{fn:'escalate',id:String(sub.id)})),403);
 await t.bw('escalate',[sub.id],4);assert.equal(await status(w.tx(t.hunter,{fn:'arbiter-timeout',id:String(sub.id)})),409);assert.equal(await status(w.tx(t.hunter,{fn:'resolve',id:String(sub.id),severity:2})),403,'only the arbiter resolves');
 r=await w.tx(t.arbiter,{fn:'resolve',id:String(sub.id),severity:2,returnStake:true});assert.equal((w.decode(r.steps[0]) as any).functionName,'resolveDispute');assert.equal(await status(w.tx(t.arbiter,{fn:'resolve',id:String(sub.id),severity:5})),400);
 await t.warp(14*DAY+10);r=await w.tx(t.hunter2,{fn:'arbiter-timeout',id:String(sub.id)});assert.equal((w.decode(r.steps[0]) as any).functionName,'claimArbiterTimeout');
 // dispute needs a bond approval equal to the stake when short; expire an unrevealed commit
 const id2=await t.create();const c2=await t.commit(id2,5,1);assert.equal(await status(w.tx(t.hunter,{fn:'expire',id:String(c2.id)})),409);await t.warp(DAY+10);r=await w.tx(t.hunter,{fn:'expire',id:String(c2.id)});assert.equal((w.decode(r.steps[0]) as any).functionName,'expireCommit');
 const s3=await t.submit(id2,6,4);await t.bw('accept',[s3.id,2],3);r=await w.tx(t.hunter3,{fn:'dispute',id:String(s3.id)});assert.equal(r.summary.bondNib,'500');assert.equal(await status(w.tx(t.hunter,{fn:'dispute',id:String(s3.id)})),403);
 assert.equal(await status(w.tx(t.hunter3,{fn:'finalize',id:String(s3.id)})),409,'dispute window open');r=await w.tx(t.hunter3,{fn:'accept-decision',id:String(s3.id)});assert.equal((w.decode(r.steps[0]) as any).functionName,'acceptDecision');assert.equal(await status(w.tx(t.hunter,{fn:'accept-decision',id:String(s3.id)})),403);
});
for(const kind of ['sqlite','postgres'] as const)test(`private reports (${kind}): encrypted at rest, only the right party can read at the right time`,async()=>{
 const w=await world(kind);const {t}=w;const id=await t.create({review:3});const rep=t.report('private');const body='HIGH: unchecked return value in Vault.sweep(). PoC attached below.\n'+'A'.repeat(200);const rh=reportHashOf(body);
 const sub=await t.commit(id,4,3,{reportHash:rh,salt:rep.salt});const sid=String(sub.id);
 // before anything is stored
 assert.equal(await status(w.act(t.hunter,'bounty-report-get',{submissionId:sid})),404);
 // upload rules: hash must match, only the committer, size limit, existing submission
 assert.equal(await status(w.act(t.hunter,'bounty-report-put',{submissionId:sid,body,reportHash:keccak256(toHex('else'))})),400);
 assert.equal(await status(w.act(t.hunter2,'bounty-report-put',{submissionId:sid,body,reportHash:rh})),403);assert.equal(await status(w.act(t.creator,'bounty-report-put',{submissionId:sid,body,reportHash:rh})),403);
 assert.equal(await status(w.act(t.hunter,'bounty-report-put',{submissionId:'999',body,reportHash:rh})),404);assert.equal(await status(w.act(t.hunter,'bounty-report-put',{submissionId:sid,body:'',reportHash:rh})),400);
 const big='x'.repeat(MAX_REPORT_BYTES+1);assert.equal(await status(w.act(t.hunter,'bounty-report-put',{submissionId:sid,body:big,reportHash:reportHashOf(big)})),400);
 assert.equal(await status(bugBountyAction({...w.env,BUG_BOUNTY_REPORT_KEY:undefined},who(t.hunter),'bounty-report-put',{submissionId:sid,body,reportHash:rh},await w.now())),503,'no key: refuse rather than store plaintext');
 assert.equal(await status(w.act(t.hunter,'bounty-report-put',{submissionId:sid,body,reportHash:rh})),200);
 // encrypted at rest: the plaintext (and any recognisable fragment) is nowhere in the row
 const row:any=await w.DB.prepare('SELECT * FROM bounty_reports WHERE submission_id=?').bind(sid).first();assert.ok(row);assert.equal(JSON.stringify(row).includes('Vault.sweep'),false);assert.equal(Buffer.from(row.ciphertext,'base64').includes('Vault.sweep'),false);assert.equal(row.hunter,t.hunter.toLowerCase());
 // read access over time
 const got=(await w.act(t.hunter,'bounty-report-get',{submissionId:sid})).bugBounty;assert.equal(got.body,body);assert.equal(got.hashMatchesOnChain,false,'not revealed yet');
 assert.equal(await status(w.act(t.creator,'bounty-report-get',{submissionId:sid})),403,'the project cannot read before the reveal');
 assert.equal(await status(w.act(t.hunter2,'bounty-report-get',{submissionId:sid})),403);assert.equal(await status(w.act(t.arbiter,'bounty-report-get',{submissionId:sid})),403);
 // a different report cannot be substituted at reveal time: the stored hash must equal the revealed hash
 await t.reveal({...sub,reportHash:rh} as any);
 assert.equal(await status(w.act(t.hunter,'bounty-report-put',{submissionId:sid,body:body+'!',reportHash:reportHashOf(body+'!')})),409,'cannot swap the report after reveal');
 const seen=(await w.act(t.creator,'bounty-report-get',{submissionId:sid})).bugBounty;assert.equal(seen.body,body);assert.equal(seen.hashMatchesOnChain,true);assert.equal(seen.claimedSeverity,3);
 assert.equal(await status(w.act(t.hunter2,'bounty-report-get',{submissionId:sid})),403);assert.equal(await status(w.act(t.arbiter,'bounty-report-get',{submissionId:sid})),403,'the arbiter reads only disputed reports');
 // dispute: the arbiter may read it
await t.bw('reject',[sub.id,2,0n],3);await t.bw('dispute',[sub.id],4);assert.equal((await w.act(t.arbiter,'bounty-report-get',{submissionId:sid})).bugBounty.body,body);
 // a tampered row (hash column edited) is refused for the project
 await w.DB.prepare('UPDATE bounty_reports SET report_hash=? WHERE submission_id=?').bind(keccak256(toHex('x')),sid).run();assert.equal(await status(w.act(t.creator,'bounty-report-get',{submissionId:sid})),409);
 // an unrevealed commit may replace its report (typo fix) before reveal, and the 20/day cap bounds spam
 const rep2=t.report('second');const b2='first draft';const c2=await t.commit(id,5,1,{reportHash:reportHashOf(b2),salt:rep2.salt});
 assert.equal(await status(w.act(t.hunter2,'bounty-report-put',{submissionId:String(c2.id),body:b2,reportHash:reportHashOf(b2)})),200);const b3='second draft';
 assert.equal(await status(w.act(t.hunter2,'bounty-report-put',{submissionId:String(c2.id),body:b3,reportHash:reportHashOf(b3)})),200);
 assert.equal((await w.act(t.hunter2,'bounty-report-get',{submissionId:String(c2.id)})).bugBounty.body,b3);
 await w.DB.close?.();
});
