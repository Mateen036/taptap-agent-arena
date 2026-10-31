import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {decodeFunctionData,formatUnits,keccak256,toHex} from 'viem';
import {setup,closeAll,E,DAY,TIERS,STAKE,DEPOSIT,DUP,Status,Outcome,REV0} from './helpers/bounty-chain';
import {databaseFixture} from './helpers/database';
import {bugBountyState,bugBountyAction,bugBountyRoute,bountySubmissions,reconcileTap,bountyAbi,createTerms,nibAmount,scopeHash,reportHashOf,sealReport,openReport,bountyPhase,tierLabel,minTapStake,quorum,splitPayout,nextStep,ticketDigest,BugBountyError,BUG_BOUNTY_ACTIONS,BOUNTY_FUNCTIONS,MAX_REPORT_BYTES} from '../lib/bug-bounty';
import {handle} from '../lib/api';
after(closeAll);
const KEY='ab'.repeat(32);
const policy={active:false,version:2 as const,formula:'5*owned' as const,scope:'earned_tap_only' as const};
const SCOPE='In scope: the NibSwap router contracts at 0x1234 on BNB Chain. Out of scope: front-end, social engineering, DoS. Report with a PoC and impact.';
const who=(addr:string)=>({wallet:addr.toLowerCase(),connected:true});
const status=async(p:Promise<any>)=>{try{await p;return 200;}catch(e:any){return e instanceof BugBountyError?e.status:-1;}};
const TAP0=5000n;
async function world(kind:'sqlite'|'postgres'='sqlite',o:{signer?:boolean}={}){
 const t=await setup({server:true});const DB=await databaseFixture(kind);
 const env:any={DB,BUG_BOUNTY_CONTRACT:t.bounty,BUG_BOUNTY_REPORT_KEY:KEY,BUG_BOUNTY_SIGNER_PRIVATE_KEY:o.signer===false?undefined:t.keys[1],NIB_TOKEN:t.nib,BSC_RPC_URL:t.rpc,_utilityPolicy:policy};
 const now=async()=>(await t.now())*1000;
 const addr=(i:number)=>t.accounts[i].address.toLowerCase();
 const fund=async(idx:number[],tap=TAP0)=>{for(const i of idx)await DB.prepare('INSERT INTO agents(wallet,user_id,name,points,earned,updated_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(addr(i),'u'+i,'Agent '+i,Number(tap),Number(tap),1,1).run();};
 const tap=async(i:number)=>{const r:any=await DB.prepare('SELECT * FROM agents WHERE wallet=?').bind(addr(i)).first();return BigInt(r.points_exact??r.points);};
 const act=async(i:number,action:string,payload:any)=>bugBountyAction(env,{...who(addr(i)),...(await DB.prepare('SELECT * FROM agents WHERE wallet=?').bind(addr(i)).first<any>())},action,payload,await now());
 const tx=async(i:number,payload:any)=>(await act(i,'bounty-tx',payload)).bugBounty;
 // Execute every previewed step on the local chain exactly as baw would, and require success.
 const run=async(i:number,res:any)=>{let last:any;for(const s of res.steps){const hash=await t.wallets[i].sendTransaction({to:s.transaction.to,data:s.transaction.data,value:BigInt(s.transaction.value),gas:6_000_000n} as any);last=await t.client.waitForTransactionReceipt({hash});assert.equal(last.status,'success',s.name);}return last;};
 const go=async(i:number,payload:any)=>run(i,await tx(i,payload));
 const decode=(step:any)=>decodeFunctionData({abi:bountyAbi,data:step.transaction.data});
 const state=async(i?:number)=>(await bugBountyState(env,i===undefined?null:addr(i),await now())) as any;
 return {t,DB,env,now,act,tx,go,run,decode,fund,tap,addr,state};
}
type World=Awaited<ReturnType<typeof world>>;
const TERMS={tiers:['10000','25000','50000','100000'],deposit:'300000',days:30,panelSize:7,scope:SCOPE};
async function newBounty(w:World,from=4){await w.go(from,{fn:'create',...TERMS});const id=Number(await w.t.br('bountyNonce'));await w.act(from,'bounty-scope-put',{bountyId:id,text:SCOPE});return id;}
// hunter: commit via the API (locks TAP, returns a signed ticket), store the report, reveal
async function hunt(w:World,bountyId:number,idx:number,severity=2,body='reentrancy in withdraw(): attacker drains the pool. PoC attached in full text.'){
 const rh=reportHashOf(body),salt=keccak256(toHex('salt-'+idx+'-'+severity+'-'+body.length)),commitHash=await w.t.br('commitHashFor',[BigInt(bountyId),w.t.accounts[idx].address,severity,rh,salt]);
 await w.go(idx,{fn:'commit',bountyId,commitHash});const sid=Number(await w.t.br('submissionNonce'));
 await w.act(idx,'bounty-report-put',{submissionId:sid,body,reportHash:rh});
 await w.go(idx,{fn:'reveal',id:sid,severity,reportHash:rh,salt});return {sid,body,rh,salt};
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
test('pure helpers: amounts, phases, labels, TAP stake floor, quorum and payout split mirror the contract',async()=>{
 assert.equal(nibAmount('1.5','x'),15n*10n**17n);for(const bad of ['1e3','-1','0','abc','','1.0000000000000000001',null,undefined,'1,000'])assert.throws(()=>nibAmount(bad as any,'x'),(e:any)=>e.status===400,String(bad));
 assert.equal(tierLabel(4,4),'Critical');assert.equal(tierLabel(4,1),'Low');assert.equal(tierLabel(1,1),'Bounty');assert.equal(tierLabel(3,3),'High');
 assert.equal(bountyPhase({closed:false,endsAt:200,closesAt:200,cancelRequestedAt:0},100),'open');assert.equal(bountyPhase({closed:false,endsAt:200,closesAt:200,cancelRequestedAt:50},100),'closing');assert.equal(bountyPhase({closed:false,endsAt:200,closesAt:200,cancelRequestedAt:0},200),'ended');assert.equal(bountyPhase({closed:true,endsAt:200,closesAt:200,cancelRequestedAt:0},100),'withdrawn');
 assert.equal(scopeHash(SCOPE),keccak256(toHex(SCOPE)));
 const t=await setup();
 for(const tier of [E(10000),E(10001),E(4_999_999),E(5_000_000),E(12_345_678),E(1_000_000_000)])assert.equal(minTapStake(tier),await t.br('minTapStake',[tier]),'minTapStake '+tier);
 assert.equal(minTapStake(E(10000)),1000n);assert.equal(minTapStake(E(1)),500n);
 for(const n of [7,9])assert.equal(BigInt(quorum(n)),await t.br('quorum',[BigInt(n)]),'quorum '+n);
 const s=splitPayout(E(50000),200,2000,6);assert.deepEqual([s.fee,s.reviewers,s.perReviewer,s.hunter],[E(1000),(E(10000)/6n)*6n,E(10000)/6n,E(50000)-E(1000)-(E(10000)/6n)*6n]);
 const d=splitPayout(E(10000)+1n,200,2000,6);assert.equal(d.fee+d.reviewers+d.hunter,E(10000)+1n,'every wei is accounted for');
 // the digest the server signs is the digest the contract verifies
 const dg=await t.br('ticketDigest',[1,t.accounts[5].address,1n,1000n,keccak256(toHex('l')),99n]);assert.equal(ticketDigest(t.bounty,1,t.accounts[5].address,1n,1000n,keccak256(toHex('l')),99n),dg);
 // next-step hints
 const sub=(o:any)=>({status:1,deadline:100,revealDeadline:0,seedBlock:0,reveals:0,commits:0,...o});
 assert.equal(nextStep(sub({}),7,50).step,'reveal');assert.equal(nextStep(sub({}),7,150).step,'expire');assert.equal(nextStep(sub({status:2}),7,50).step,'apply');assert.equal(nextStep(sub({status:2}),7,150).step,'start-selection');assert.equal(nextStep(sub({status:2,seedBlock:5}),7,150,6).step,'select');assert.equal(nextStep(sub({status:2,seedBlock:5}),7,150,300).step,'start-selection');
 assert.equal(nextStep(sub({status:3,commits:1,revealDeadline:300}),7,50).step,'vote');assert.equal(nextStep(sub({status:3,commits:7,revealDeadline:300}),7,50).step,'open-vote');assert.equal(nextStep(sub({status:3,reveals:7,revealDeadline:300}),7,50).step,'finalize');assert.equal(nextStep(sub({status:4}),7,50).step,null);
});
test('createTerms: minimum bounty 10k NIB, increasing tiers, odd panel of 7 or 9, TAP stake within [floor, 10x floor]',()=>{
 const P={minDeposit:E(10000),minLowestTier:E(10000)},now=1_800_000_000,ok={...TERMS};
 const t=createTerms(ok,P,now);assert.equal(t.tapStake,1000n);assert.equal(t.panelSize,7n);assert.equal(t.tiers.length,4);assert.equal(t.endsAt,BigInt(now+30*DAY));
 const bad=(o:any,re:RegExp)=>assert.throws(()=>createTerms({...ok,...o},P,now),(e:any)=>e.status===400&&re.test(e.message),JSON.stringify(o).slice(0,60));
 bad({tiers:['9999']},/at least 10000/);bad({tiers:['10000','10000']},/increasing/);bad({tiers:[]},/1 to 4/);bad({tiers:['10000','20000','30000','40000','50000']},/1 to 4/);bad({tiers:'x'},/payout tiers/);
 bad({deposit:'9999'},/escrow must be at least/);bad({deposit:'50000'},/cover at least one payout/);bad({days:13},/14 to 365/);bad({days:366},/14 to 365/);
 bad({panelSize:2},/7 or 9/);bad({panelSize:3},/7 or 9/);bad({panelSize:5},/7 or 9/);bad({panelSize:11},/7 or 9/);
 bad({tapStake:'999'},/between 1000 and 10000/);bad({tapStake:'10001'},/between 1000 and 10000/);bad({tapStake:'1.5'},/whole number/);
 assert.equal(createTerms({...ok,tapStake:'10000',panelSize:9},P,now).panelSize,9n);
 assert.equal(createTerms({...ok,tiers:['5000000'],deposit:'5000000'},P,now).tapStake,500000n);
 bad({scope:'short'},/too short/);bad({scope:undefined},/Describe the scope/);bad({scope:'x'.repeat(16385)},/too large/);
});
test('state shows the rules and the project\'s scope; previews decode to exactly the asked call and carry the 2% / 20% / TAP-only terms',async()=>{
 const w=await world();await w.fund([4,5]);
 assert.equal((await w.state()).bounties.length,0);const p=(await w.state()).params;
 assert.deepEqual([p.feeBps,p.reviewerBps,p.minDeposit,p.minLowestTier],[200,2000,'10000','10000']);assert.equal(p.feeRecipient,w.addr(3));assert.equal(p.ticketSigner,w.addr(1));
 const r=await w.tx(4,{fn:'create',...TERMS});const create=r.steps.at(-1);assert.equal(r.steps.length,1,'allowance already exact-enough');
 const d=w.decode(create);assert.equal(d.functionName,'createBounty');assert.equal((d.args as any)[3],7n);assert.equal((d.args as any)[4],1000n);assert.equal((d.args as any)[5],E(300000));
 assert.equal(r.summary.panelSize,7);assert.equal(r.summary.quorum,6);assert.equal(r.summary.tapStakePerReport,'1000');assert.match(r.summary.rules.join(' '),/2% platform fee/);assert.match(r.summary.rules.join(' '),/20% shared by the reviewers/);assert.match(r.summary.rules.join(' '),/TAP points, never NIB/);
 assert.ok(r.summary.tiers[2].hunterGetsNibApprox.startsWith('39000'),'50000 - 2% - 20% = 39000');assert.match(create.baw,/^baw contract-call preview --binanceChainId 56 --from 0x/);
 // an approval is requested only when the allowance is short, and only for exactly the amount
 await w.t.w(w.t.nib,w.t.nibArt.abi,'approve',[w.t.bounty,0n],4);const r2=await w.tx(4,{fn:'create',...TERMS});assert.equal(r2.steps.length,2);assert.equal(w.decode({transaction:r2.steps[1].transaction}).functionName,'createBounty');
 const ap=decodeFunctionData({abi:[{type:'function',name:'approve',inputs:[{type:'address'},{type:'uint256'}],outputs:[{type:'bool'}],stateMutability:'nonpayable'}],data:r2.steps[0].transaction.data});assert.deepEqual([String(ap.args[0]).toLowerCase(),ap.args[1]],[w.t.bounty.toLowerCase(),E(300000)]);
 await w.t.approve(4);await w.go(4,{fn:'create',...TERMS});
 let s=await w.state(4);assert.equal(s.bounties[0].scope.verified,false,'no text published yet');
 await assert.rejects(w.act(5,'bounty-scope-put',{bountyId:1,text:SCOPE}),(e:any)=>e.status===403,'only the creator');
 await assert.rejects(w.act(4,'bounty-scope-put',{bountyId:1,text:SCOPE+' tampered'}),(e:any)=>e.status===409,'must match the on-chain hash');
 await w.act(4,'bounty-scope-put',{bountyId:1,text:SCOPE});await assert.rejects(w.act(4,'bounty-scope-put',{bountyId:1,text:SCOPE}),(e:any)=>e.status===409,'immutable');
 s=await w.state(4);const b=s.bounties[0];assert.equal(b.scope.text,SCOPE);assert.equal(b.scope.verified,true);assert.equal(b.panelSize,7);assert.equal(b.quorum,6);assert.equal(b.tapStake,'1000');assert.equal(b.phase,'open');assert.deepEqual(b.tiers.map((t:any)=>t.label),['Low','Medium','High','Critical']);assert.equal(s.you.myBounties[0],'1');
 for(const [bad,re,code] of [[{fn:'nope'},/Unknown bounty step/,400],[{fn:'create',...TERMS,tiers:['9000']},/at least 10000/,400],[{fn:'topup',id:1,amount:'1'},/./,200],[{fn:'topup',id:99,amount:'1'},/does not exist/,404]] as any[]){
  const out=await w.act(4,'bounty-tx',bad).then(()=>200,(e:any)=>{assert.match(e.message,re);return e.status;});assert.equal(out,code,JSON.stringify(bad));
 }
 await assert.rejects(w.tx(5,{fn:'topup',id:1,amount:'5'}),(e:any)=>e.status===403,'only the creator tops up');
 await assert.rejects(w.tx(5,{fn:'withdraw',id:1}),(e:any)=>e.status===403);await assert.rejects(w.tx(4,{fn:'withdraw',id:1}),(e:any)=>e.status===409,'not before the end');
});
test('valid report end to end: TAP locked by ticket, drawn panel, sealed votes, 2% / 20% / remainder, TAP returned, burned and rewarded from the chain',async()=>{
 const w=await world();const {t}=w;const reviewers=[9,10,11,12,13,14,15,16,17,18,19,20,21,22];await w.fund([4,5,...reviewers]);
 const id=await newBounty(w);const nibBefore=await t.bal(t.accounts[5].address),feeBefore=await t.bal(t.feeTo);
 const h=await hunt(w,id,5,3);
 assert.equal(await w.tap(5),TAP0-1000n,'the hunter\'s TAP is locked, no NIB was taken');assert.equal(await t.bal(t.accounts[5].address),nibBefore);
 let s=await w.state(5);assert.equal(s.you.tap.locked,'1000');assert.equal(s.you.tap.locks[0].status,'open');assert.equal(s.you.mySubmissions[0].status,'Applying');assert.equal(s.you.mySubmissions[0].claimed,3);assert.equal(s.you.mySubmissions[0].next.step,'apply');
 // reports: only the hunter and (once revealed) the project may read; other agents cannot until they are drawn
 const read=(i:number,sid=h.sid)=>w.act(i,'bounty-report-get',{submissionId:sid});
 assert.equal((await read(5)).bugBounty.body,h.body);assert.equal((await read(4)).bugBounty.role,'creator');
 for(const i of [6,9])await assert.rejects(read(i),(e:any)=>e.status===403,'applicant/stranger '+i);
 // review applications lock TAP too; the creator, the hunter and strangers without an Agent ID cannot apply
 for(const i of reviewers)await w.go(i,{fn:'apply',submissionId:h.sid});
 for(const i of reviewers)assert.equal(await w.tap(i),TAP0-1000n);
 for(const i of [4,5])await assert.rejects(w.tx(i,{fn:'apply',submissionId:h.sid}),(e:any)=>e.status===403,'excluded '+i);
 await assert.rejects(w.tx(9,{fn:'apply',submissionId:h.sid}),(e:any)=>e.status===409,'only once');
 await assert.rejects(w.tx(0,{fn:'start-selection',submissionId:h.sid}),(e:any)=>e.status===409&&/open until/.test(e.message),'apply window still open');
 await t.warp(48*3600+5);await assert.rejects(w.tx(23,{fn:'apply',submissionId:h.sid}),(e:any)=>e.status===409,'window closed');
 await w.go(0,{fn:'start-selection',submissionId:h.sid});await assert.rejects(w.tx(0,{fn:'select',submissionId:h.sid}),(e:any)=>e.status===409&&/seed block/.test(e.message));
 await t.mine(2);await w.go(0,{fn:'select',submissionId:h.sid});
 const panel=(await t.br('panelOf',[BigInt(h.sid)]) as string[]).map(a=>t.accounts.findIndex(x=>x.address===a)),rest=reviewers.filter(i=>!panel.includes(i));assert.equal(panel.length,7);assert.equal(rest.length,7);
 // drawn panelists can read the report; applicants who were not drawn cannot
 for(const i of panel)assert.equal((await read(i)).bugBounty.role,'panelist');for(const i of rest)await assert.rejects(read(i),(e:any)=>e.status===403);
 // sealed votes: six for High (3), one dissenter says not valid (0)
 const votes=[3,3,3,3,3,3,0];const bid=BigInt(h.sid);
 await assert.rejects(w.tx(rest[0],{fn:'vote',submissionId:h.sid,voteHash:t.voteHash(bid,panel[0],3)}),(e:any)=>e.status===403,'not on the panel');
 for(let i=0;i<7;i++)await w.go(panel[i],{fn:'vote',submissionId:h.sid,voteHash:t.voteHash(bid,panel[i],votes[i])});
 await assert.rejects(w.tx(panel[0],{fn:'vote',submissionId:h.sid,voteHash:t.voteHash(bid,panel[0],3)}),(e:any)=>e.status===409,'sealed once');
 await assert.rejects(w.tx(panel[0],{fn:'open-vote',submissionId:h.sid,verdict:0,salt:t.voteSalt(bid,panel[0])}),(e:any)=>e.status===409&&/do not match/.test(e.message),'cannot open a different verdict');
 await assert.rejects(w.tx(0,{fn:'finalize',submissionId:h.sid}),(e:any)=>e.status===409);
 for(let i=0;i<7;i++)await w.go(panel[i],{fn:'open-vote',submissionId:h.sid,verdict:votes[i],salt:t.voteSalt(bid,panel[i])});
 await w.go(0,{fn:'finalize',submissionId:h.sid});await t.solvent();
 // NIB: 50,000 High = 1,000 fee + 10,000 reviewer pool (6 aligned x 10000/6) + remainder to hunter
 const per=E(10000)/6n,dist=per*6n,hunterNet=E(50000)-E(1000)-dist;
 assert.equal(await t.bal(t.accounts[5].address)-nibBefore,hunterNet);assert.equal(await t.bal(t.feeTo)-feeBefore,E(1000));
 const aligned=panel.filter((_,i)=>votes[i]===3),dissent=panel.filter((_,i)=>votes[i]===0);
 for(const i of aligned)assert.equal(await t.br('rewardOf',[t.accounts[i].address]),per);assert.equal(await t.br('rewardOf',[t.accounts[dissent[0]].address]),0n);
 // TAP is only moved when the server reads the settled state: returned to the hunter, aligned reviewers and unseated applicants; the dissenter's stake is burned
 for(const i of [5,...reviewers])await w.state(i);
 assert.equal(await w.tap(5),TAP0,'hunter stake returned');for(const i of aligned)assert.equal(await w.tap(i),TAP0,'aligned reviewer stake returned');for(const i of rest)assert.equal(await w.tap(i),TAP0,'unseated applicant returned');assert.equal(await w.tap(dissent[0]),TAP0-1000n,'dissenting reviewer stake burned');
 const before=await w.tap(5);await reconcileTap(w.env,await w.now());await reconcileTap(w.env,await w.now(),w.addr(5));await w.state(5);assert.equal(await w.tap(5),before,'settlement is idempotent');
 s=await w.state(dissent[0]);assert.equal(s.you.reputation.strikes,1);assert.ok(s.you.reputation.cooldownUntil>0);assert.equal(s.you.myReviews[0].reviewer.state,'seated');
 s=await w.state(5);assert.equal(s.you.mySubmissions[0].status,'Settled');assert.equal(s.you.mySubmissions[0].outcome,'valid');assert.equal(s.you.mySubmissions[0].awarded,3);assert.equal(s.you.tap.locked,'0');
 // reviewers pull their NIB reward
 s=await w.state(aligned[0]);assert.equal(s.you.rewardNib,formatUnits(per,18));const nb=await t.bal(t.accounts[aligned[0]].address);await w.go(aligned[0],{fn:'claim'});assert.equal(await t.bal(t.accounts[aligned[0]].address)-nb,per);
 await assert.rejects(w.tx(aligned[0],{fn:'claim'}),(e:any)=>e.status===409);await t.solvent();
 s=await w.state();assert.equal(s.totals.fees,'1000');assert.equal(s.totals.paidToHunters,formatUnits(hunterNet,18));assert.equal((await bountySubmissions(w.env,String(id),await w.now())).submissions[0].outcome,'valid');
 assert.equal(s.bounties[0].tiers.length,4);
});
test('invalid report: the hunter\'s TAP is burned and shared with the reviewers who judged it invalid; nobody is paid NIB',async()=>{
 const w=await world();const {t}=w;const reviewers=[9,10,11,12,13,14,15,16,17,18,19,20,21,22];await w.fund([4,5,...reviewers]);
 const id=await newBounty(w);const h=await hunt(w,id,5,4,'Spam report with no real finding, only a long made-up story about critical bugs.');
 for(const i of reviewers)await w.go(i,{fn:'apply',submissionId:h.sid});await t.warp(48*3600+5);await w.go(0,{fn:'start-selection',submissionId:h.sid});await t.mine(2);await w.go(0,{fn:'select',submissionId:h.sid});
 const panel=(await t.br('panelOf',[BigInt(h.sid)]) as string[]).map(a=>t.accounts.findIndex(x=>x.address===a)),bid=BigInt(h.sid);
 for(const i of panel)await w.go(i,{fn:'vote',submissionId:h.sid,voteHash:t.voteHash(bid,i,0)});for(const i of panel)await w.go(i,{fn:'open-vote',submissionId:h.sid,verdict:0,salt:t.voteSalt(bid,i)});
 const nib=await t.bal(t.accounts[5].address);await w.go(0,{fn:'finalize',submissionId:h.sid});await t.solvent();assert.equal(await t.bal(t.accounts[5].address),nib);
 // a rejection stays open for the 3-day appeal window; the TAP stays locked until it is closed for good
 assert.equal((await w.state(5)).you.mySubmissions[0].status,'Rejected');assert.equal(await w.tap(5),TAP0-1000n);
 await t.warp(3*DAY+5);assert.equal((await w.state(5)).you.mySubmissions[0].next.step,'finalize-rejection');await w.go(0,{fn:'finalize-rejection',submissionId:h.sid});
 for(const i of [5,...reviewers])await w.state(i);
 assert.equal(await w.tap(5),TAP0-1000n,'forfeited');for(const i of panel)assert.equal(await w.tap(i),TAP0+142n,'stake back + 1000/7 of the forfeited stake');
 const s=await w.state(5);assert.equal(s.you.mySubmissions[0].outcome,'invalid');assert.equal(s.you.tap.locks[0].burned,'1000');
 assert.equal((await w.state(panel[0])).you.tap.locks.find((l:any)=>l.role==='reviewer').reward,'142');
});
test('appeal: the hunter appeals a rejection, only the owner decides, an overturn pays the claim tier and returns the TAP',async()=>{
 const w=await world();const {t}=w;const reviewers=[9,10,11,12,13,14,15,16,17,18,19,20,21,22],OWNER=30;await w.fund([4,5,OWNER,...reviewers]);
 const id=await newBounty(w);const h=await hunt(w,id,5,3,'Real finding that the panel wrongly rejected; full PoC and impact in this long text.');
 for(const i of reviewers)await w.go(i,{fn:'apply',submissionId:h.sid});await t.warp(48*3600+5);await w.go(0,{fn:'start-selection',submissionId:h.sid});await t.mine(2);await w.go(0,{fn:'select',submissionId:h.sid});
 const panel=(await t.br('panelOf',[BigInt(h.sid)]) as string[]).map(a=>t.accounts.findIndex(x=>x.address===a)),bid=BigInt(h.sid);
 for(const i of panel)await w.go(i,{fn:'vote',submissionId:h.sid,voteHash:t.voteHash(bid,i,0)});for(const i of panel)await w.go(i,{fn:'open-vote',submissionId:h.sid,verdict:0,salt:t.voteSalt(bid,i)});
 await w.go(0,{fn:'finalize',submissionId:h.sid});await t.solvent();
 let s=await w.state(5);assert.equal(s.you.mySubmissions[0].status,'Rejected');assert.equal(s.you.mySubmissions[0].next.step,'appeal');assert.equal(s.you.mySubmissions[0].appeal.open,true);
 // only the hunter appeals; the owner and strangers cannot decide an unappealed report
 assert.notEqual(await status(w.tx(6,{fn:'appeal',submissionId:h.sid})),200,'a stranger cannot appeal');
 await assert.rejects(w.go(OWNER,{fn:'resolve',submissionId:h.sid,severity:2}));
 await w.go(5,{fn:'appeal',submissionId:h.sid});s=await w.state(5);assert.equal(s.you.mySubmissions[0].status,'Appealed');assert.equal(await w.tap(5),TAP0-1000n,'still locked while the owner decides');
 // the owner sees the appealed report and the queue; nobody else outside the panel does
 assert.equal((await w.act(OWNER,'bounty-report-get',{submissionId:h.sid})).bugBounty.role,'owner');assert.equal((await w.state(OWNER)).you.isOwner,true);assert.equal((await w.state(OWNER)).you.appealsToDecide.length,1);
 assert.equal(await status(w.act(4,'bounty-report-get',{submissionId:h.sid})),200,'the project can read it after reveal');
 // the owner cannot approve above the claim, and a stranger cannot decide
 await assert.rejects(w.go(OWNER,{fn:'resolve',submissionId:h.sid,severity:4}));await assert.rejects(w.go(5,{fn:'resolve',submissionId:h.sid,severity:2}));
 const before=await t.bal(t.accounts[5].address);await w.go(OWNER,{fn:'resolve',submissionId:h.sid,severity:2});await t.solvent();
 s=await w.state(5);const sub=s.you.mySubmissions[0];assert.equal(sub.status,'Settled');assert.equal(sub.outcome,'valid');assert.equal(sub.awarded,2);assert.equal(sub.appeal.overruled,true);
 assert.ok(await t.bal(t.accounts[5].address)>before,'the hunter is paid');
 for(const i of [5,...panel])await w.state(i);
 assert.equal(await w.tap(5),TAP0,'the hunter\'s TAP is returned');for(const i of panel)assert.equal(await w.tap(i),TAP0,'dissenting reviewers are not slashed when the owner overrules them');
});
test('TAP tickets: unused tickets are refunded, a live ticket is reused (never locked twice), and nothing is deducted when it cannot be issued',async()=>{
 const w=await world();const {t}=w;await w.fund([4,5]);const id=await newBounty(w);
 const rh=reportHashOf('x'),salt=keccak256(toHex('s')),commitHash=await t.br('commitHashFor',[BigInt(id),t.accounts[5].address,2,rh,salt]);
 const r1=await w.tx(5,{fn:'commit',bountyId:id,commitHash});assert.equal(await w.tap(5),TAP0-1000n,'locked at preview');assert.match(r1.summary.stakeNote,/returned automatically/);
 const r2=await w.tx(5,{fn:'commit',bountyId:id,commitHash});assert.equal(await w.tap(5),TAP0-1000n,'same ticket, no second lock');assert.deepEqual(r2.steps[0].transaction,r1.steps[0].transaction,'deterministic re-signing');
 assert.equal((await w.state(5)).you.tap.locks.length,1);
 await t.warp(1000);const s=await w.state(5);assert.equal(await w.tap(5),TAP0,'refunded after the ticket expired unused');assert.equal(s.you.tap.locks[0].status,'unused');assert.equal(s.you.tap.locks[0].returned,'1000');
 await w.state(5);assert.equal(await w.tap(5),TAP0,'refund happens once');
 // an expired ticket is useless on-chain
 await assert.rejects(w.run(5,r1),/./);
 // a fresh preview after the refund works and is accepted by the contract
 await w.go(5,{fn:'commit',bountyId:id,commitHash});assert.equal(await t.br('submissionNonce'),1n);assert.equal(await w.tap(5),TAP0-1000n);
 // not enough TAP: refused, nothing locked
 await w.fund([6],900n);const before=await w.tap(6);await assert.rejects(w.tx(6,{fn:'commit',bountyId:id,commitHash:keccak256(toHex('c6'))}),(e:any)=>e.status===409&&/1000 TAP/.test(e.message));assert.equal(await w.tap(6),before);
 assert.equal((await w.DB.prepare('SELECT COUNT(*) AS n FROM bounty_tap_locks WHERE wallet=?').bind(w.addr(6)).first<any>()).n,0);
 // below the bounty's stake: refused
 await assert.rejects(w.tx(5,{fn:'commit',bountyId:id,commitHash:keccak256(toHex('c5')),stake:'999'}),(e:any)=>e.status===400);
 // a cap on in-flight locks, so a wallet cannot park TAP on endless tickets
 await w.fund([7]);for(let i=0;i<5;i++)await w.DB.prepare("INSERT INTO bounty_tap_locks(lock_id,wallet,kind,scope_id,amount,deadline,status,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(keccak256(toHex('seed'+i)),w.addr(7),'hunter','9'+i,'1000',9e12,'open',1).run();
 await assert.rejects(w.tx(7,{fn:'commit',bountyId:id,commitHash:keccak256(toHex('c7'))}),(e:any)=>e.status===429);
 // signer problems: no key, or a key that is not the contract's ticketSigner
 const noKey=await world('sqlite',{signer:false});await noKey.fund([4,5]);await newBounty(noKey);const b0=await noKey.tap(5);await assert.rejects(noKey.tx(5,{fn:'commit',bountyId:1,commitHash:keccak256(toHex('k'))}),(e:any)=>e.status===503);assert.equal(await noKey.tap(5),b0);
 const wrong=await world();await wrong.fund([4,5]);await newBounty(wrong);wrong.env.BUG_BOUNTY_SIGNER_PRIVATE_KEY=wrong.t.keys[2];const b1=await wrong.tap(5);await assert.rejects(wrong.tx(5,{fn:'commit',bountyId:1,commitHash:keccak256(toHex('k'))}),(e:any)=>e.status===503&&/does not match/.test(e.message));assert.equal(await wrong.tap(5),b1);
});
test('prechecks mirror the contract: self-dealing, limits, mismatched reveals and unsealed votes are refused before anything is prepared',async()=>{
 const w=await world();const {t}=w;await w.fund([4,5,6,9,10,11]);const id=await newBounty(w);
 const ch=(n:string)=>keccak256(toHex(n));
 await assert.rejects(w.tx(4,{fn:'commit',bountyId:id,commitHash:ch('a')}),(e:any)=>e.status===403&&/own bounty/.test(e.message));
 await assert.rejects(w.tx(5,{fn:'commit',bountyId:99,commitHash:ch('a')}),(e:any)=>e.status===404);await assert.rejects(w.tx(5,{fn:'commit',bountyId:id,commitHash:'0x12'}),(e:any)=>e.status===400);
 const body='real finding with a long enough description to be reviewed by the panel',rh=reportHashOf(body),salt=ch('salt'),commitHash=await t.br('commitHashFor',[BigInt(id),t.accounts[5].address,2,rh,salt]);
 await w.go(5,{fn:'commit',bountyId:id,commitHash});await assert.rejects(w.tx(5,{fn:'commit',bountyId:id,commitHash}),(e:any)=>e.status===409,'a commit hash cannot repeat');
 await assert.rejects(w.tx(6,{fn:'reveal',id:1,severity:2,reportHash:rh,salt}),(e:any)=>e.status===403,'only the hunter reveals');await assert.rejects(w.tx(5,{fn:'reveal',id:1,severity:3,reportHash:rh,salt}),(e:any)=>e.status===409&&/do not match/.test(e.message));
 await assert.rejects(w.tx(5,{fn:'reveal',id:1,severity:2,reportHash:rh,salt:ch('wrong')}),(e:any)=>e.status===409);await assert.rejects(w.tx(9,{fn:'expire',id:1}),(e:any)=>e.status===409&&/still open/.test(e.message));
 await assert.rejects(w.tx(9,{fn:'apply',submissionId:1}),(e:any)=>e.status===409&&/revealed/.test(e.message),'cannot review before reveal');await assert.rejects(w.act(5,'bounty-report-put',{submissionId:1,body:'other text',reportHash:rh}),(e:any)=>e.status===400,'hash must match the body');
 await assert.rejects(w.act(6,'bounty-report-put',{submissionId:1,body,reportHash:rh}),(e:any)=>e.status===403,'only the hunter stores');await w.act(5,'bounty-report-put',{submissionId:1,body,reportHash:rh});await assert.rejects(w.act(4,'bounty-report-get',{submissionId:1}),(e:any)=>e.status===403,'the project cannot read before reveal');
 // an unrevealed commit expires: TAP burned, escrow reservation released
 await t.warp(24*3600+5);const r=await w.tx(11,{fn:'expire',id:1});await w.run(11,r);const s=await w.state(5);assert.equal(s.you.mySubmissions[0].outcome,'unrevealed');assert.equal(await w.tap(5),TAP0-1000n);assert.equal((await w.state(5)).you.tap.locks[0].burned,'1000');
 // a hunter of this bounty can never review its reports; limits per hunter are enforced before a ticket is issued
 await w.fund([7,8]);const h2=await hunt(w,id,6,2,'second report, long enough to count as a real submission text');
 await assert.rejects(w.tx(5,{fn:'apply',submissionId:h2.sid}),(e:any)=>e.status===403&&/Hunters/.test(e.message));
});
test('the same flow on Postgres: TAP locked on preview, refunded when unused, exact points ledger',async()=>{
 const w=await world('postgres');const {t}=w;await w.fund([4,5]);const id=await newBounty(w);
 const rh=reportHashOf('x'),salt=keccak256(toHex('s')),commitHash=await t.br('commitHashFor',[BigInt(id),t.accounts[5].address,2,rh,salt]);
 await w.tx(5,{fn:'commit',bountyId:id,commitHash});assert.equal(await w.tap(5),TAP0-1000n);
 const ledger=await w.DB.prepare('SELECT kind,delta FROM ledger WHERE wallet=? ORDER BY created_at').bind(w.addr(5)).all<any>();assert.equal(ledger.results[0].kind,'bounty-stake');assert.equal(Number(ledger.results[0].delta),-1000);
 await t.warp(1000);await w.state(5);assert.equal(await w.tap(5),TAP0);assert.equal((await w.DB.prepare("SELECT status FROM bounty_tap_locks WHERE wallet=?").bind(w.addr(5)).first<any>()).status,'unused');
 await w.go(5,{fn:'commit',bountyId:id,commitHash});assert.equal(Number(await t.br('submissionNonce')),1);
});
