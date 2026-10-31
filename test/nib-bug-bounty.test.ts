import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {keccak256,toHex} from 'viem';
import {setup,E,DAY,TIERS,STAKE,DEPOSIT,FEE_BPS,REVIEWER_BPS,MIN_DEPOSIT,MIN_TIER,Status,Outcome,DUP,REV0,OWNER,bountyArtifact,closeAll} from './helpers/bounty-chain';
after(closeAll);
const fee=(x:bigint)=>x*FEE_BPS/10000n,pool=(x:bigint)=>x*REVIEWER_BPS/10000n;
const H=3600;

test('NibBugBounty: constructor guards, size limit, the owner can only decide appeals and there is no admin path to escrow (ABI audit)',async()=>{
 const t=await setup();
 assert.equal(await t.br('feeBps'),200n);assert.equal(await t.br('reviewerBps'),2000n);assert.equal(await t.br('minDeposit'),MIN_DEPOSIT);assert.equal(await t.br('minLowestTier'),MIN_TIER);
 assert.equal(MIN_DEPOSIT,E(10000),'the minimum bounty is 10,000 NIB');
 for(const [k,a] of Object.entries({signer:'ticketSigner',guardian:'guardian',feeTo:'feeRecipient'}))assert.equal(((t as any)[k] as string).toLowerCase(),String(await t.br(a)).toLowerCase(),a);
 // The rule constants are internal (they keep the contract under the EIP-170 limit): the other tests pin their behaviour (windows, caps, stakes, panel sizes).
 assert.equal(String(await t.br('owner')).toLowerCase(),t.owner.toLowerCase(),'owner');
 const d=(a:any[])=>t.deploy(t.bb,[t.nib,t.registry,t.signer,t.guardian,t.feeTo,200n,2000n,MIN_DEPOSIT,MIN_TIER,t.owner].map((x,i)=>a[i]??x));
 await t.rejects(d([t.hunter]));await t.rejects(d([undefined,t.hunter]));                       // NIB and registry must be contracts
 await t.rejects(d([undefined,undefined,t.zeroAddress]));await t.rejects(d([undefined,undefined,undefined,t.zeroAddress]));await t.rejects(d([undefined,undefined,undefined,undefined,t.zeroAddress]));
 await t.rejects(d([undefined,undefined,undefined,undefined,undefined,501n]),undefined);        // fee cap 5%
 await t.rejects(d([undefined,undefined,undefined,undefined,undefined,undefined,3001n]),undefined);
 await t.rejects(d([undefined,undefined,undefined,undefined,undefined,undefined,undefined,MIN_TIER-1n]));
 await t.rejects(d([undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,t.zeroAddress]));await t.rejects(d([undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,t.nib]));
 await d([undefined,undefined,undefined,undefined,undefined,0n,0n]);                               // zero fee and share are allowed
 const art=bountyArtifact();
 assert.ok((art.deployedBytecode.length-2)/2<=24576,'under the EIP-170 contract size limit');
 const fns=art.abi.filter((x:any)=>x.type==='function');
 assert.ok(!fns.some((x:any)=>/admin|pause|upgrade|rescue|sweep|recover|setFee|arbiter|emergency|withdrawFees|setToken|initialize|delegate|selfdestruct/i.test(x.name)),'no admin-shaped function');
 const writes=fns.filter((x:any)=>x.stateMutability!=='view'&&x.stateMutability!=='pure').map((x:any)=>x.name).sort();
 assert.deepEqual(writes,['activateSigner','appeal','applyToReview','cancelSignerChange','claimReward','commit','commitVote','createBounty','expireCommit','extend','finalizeJudgment','proposeSigner','requestCancel','resolveRejection','reveal','revealVote','selectPanel','startSelection','topUp','withdraw']);
 assert.ok(!fns.some((x:any)=>x.stateMutability==='payable'),'never accepts BNB');
 assert.equal(art.abi.some((x:any)=>x.type==='receive'||x.type==='fallback'),false);
});

test('createBounty: exact escrow, 10,000 NIB minimum, TAP-only stake scaled to the bounty, odd panel of 7 or 9',async()=>{
 const t=await setup();
 const call=async(o:any={},who=4)=>{const p={scope:t.scopeHash(),tiers:TIERS,ends:BigInt(await t.now()+30*DAY+60),panel:7n,stake:STAKE,deposit:DEPOSIT,...o};return t.bw('createBounty',[p.scope,p.tiers,p.ends,p.panel,p.stake,p.deposit],who);};
 const before=await t.bal(t.creator);
 await call();
 assert.equal(before-await t.bal(t.creator),DEPOSIT,'exactly the deposit leaves the creator');assert.equal(await t.bal(t.bounty),DEPOSIT);
 const b=await t.bnty(1n);
 assert.equal(b.creator.toLowerCase(),t.creator.toLowerCase());assert.equal(b.available,DEPOSIT);assert.equal(b.reserved,0n);assert.equal(b.tierCount,4);assert.deepEqual([...b.tiers],TIERS);assert.equal(b.tapStake,STAKE);assert.equal(b.panelSize,7);assert.equal(b.scopeHash,t.scopeHash());
 await t.solvent();
 await t.rejects(call({},0),/AgentIDRequired/);await t.rejects(call({},1),/AgentIDRequired/);
 await t.idy(t.signer);await t.idy(t.guardian);await t.rejects(call({},1),/RoleHolderCannotCreateBounties/);await t.rejects(call({},2),/RoleHolderCannotCreateBounties/);
 await t.rejects(call({scope:'0x'+'00'.repeat(32)}),/ScopeHashRequired/);
 await t.rejects(call({tiers:[]}),/1To4/);await t.rejects(call({tiers:[E(1e4),E(2e4),E(3e4),E(4e4),E(5e4)]}),/1To4/);
 await t.rejects(call({tiers:[E(10000),E(10000)]}),/StrictlyIncrease/);await t.rejects(call({tiers:[E(20000),E(10000)]}),/StrictlyIncrease/);
 await t.rejects(call({tiers:[E(9999)],deposit:E(10000)}),/LowestTierBelowMinimum/);                   // minimum bounty size 10,000 NIB
 await t.rejects(call({tiers:[E(10000),E(60000)],deposit:E(55000)}),/DepositBelowMinimum/);               // must cover the top tier
 await call({tiers:[E(10000)],deposit:E(10000),stake:1000n});assert.equal((await t.bnty(2n)).tierCount,1);   // a single 10,000 NIB tier is the smallest bounty
 // TAP stake: at least max(500, lowest tier / 10 TAP per NIB / 100) = 1,000 TAP for 10,000 NIB, at most 10x that
 assert.equal(await t.br('minTapStake',[E(10000)]),1000n);assert.equal(await t.br('minTapStake',[E(1000)]),500n);assert.equal(await t.br('minTapStake',[E(100000)]),10000n);
 await t.rejects(call({stake:999n}),/TAPStake/);await t.rejects(call({stake:10001n}),/TAPStake/);await t.rejects(call({stake:0n}),/TAPStake/);
 await call({stake:10000n});
 await call({tiers:[E(100000)],deposit:E(100000),stake:10000n});await t.rejects(call({tiers:[E(100000)],deposit:E(100000),stake:1000n}),/TAPStake/); // stake scales with the bounty
 for(const p of [0n,1n,2n,3n,4n,5n,6n,8n,11n])await t.rejects(call({panel:p}),/Panel/);
 for(const p of [7n,9n])await call({panel:p});
 await t.rejects(call({ends:BigInt(await t.now()+13*DAY)}),/Duration/);await t.rejects(call({ends:BigInt(await t.now()+366*DAY)}),/Duration/);
 const poor=await t.bal(t.creator);await t.approve(4,E(1));await t.rejects(call());await t.approve(4);assert.equal(await t.bal(t.creator),poor,'failed create moves nothing');
 await t.rejects(t.bw('topUp',[1n,E(1)],5),/OnlyTheCreator/);
 await t.solvent();
});

test('TAP tickets: only the server signer can open a TAP lock; wrong wallet/amount/scope, replays, expiry and low stakes all fail',async()=>{
 const t=await setup();const id=await t.create();const rep=t.report();
 const h=(who:number)=>t.commitHash(id,t.accounts[who].address,2,rep.reportHash,rep.salt);
 const go=(who:number,tk:any,tap=tk.tap)=>t.bw('commit',[id,h(who),tap,tk.lockId,tk.deadline,tk.signature],who);
 await t.rejects(go(5,await t.ticket(1,t.hunter,id,STAKE,{signerIdx:6})),/InvalidTAPTicket/);       // signed by a random wallet
 await t.rejects(go(5,await t.ticket(1,t.hunter2,id,STAKE)),/InvalidTAPTicket/);                    // ticket for another wallet
 await t.rejects(go(5,await t.ticket(1,t.hunter,id+1n,STAKE)),/InvalidTAPTicket/);                  // ticket for another bounty
 await t.rejects(go(5,await t.ticket(2,t.hunter,id,STAKE)),/InvalidTAPTicket/);                     // reviewer ticket cannot open a hunter lock
 await t.rejects(go(5,await t.ticket(1,t.hunter,id,STAKE),STAKE+1n),/InvalidTAPTicket/);            // amount is signed
 await t.rejects(go(5,await t.ticket(1,t.hunter,id,STAKE-1n)),/TAPStakeBelowTheBounty/);            // below the bounty's stake even if signed
 await t.rejects(go(5,await t.ticket(1,t.hunter,id,STAKE,{deadline:await t.now()-5})),/TicketExpired/);
 await t.rejects(go(5,{lockId:'0x'+'00'.repeat(32),deadline:BigInt(await t.now()+99),signature:'0x'+'11'.repeat(65),tap:STAKE}),/LockAlreadyUsed/);
 await t.rejects(go(5,{...(await t.ticket(1,t.hunter,id,STAKE)),signature:'0x1234'}),/InvalidTAPTicket|ECDSA/);
 const ok=await t.ticket(1,t.hunter,id,STAKE);await go(5,ok);
 const rep2=t.report();
 await t.rejects(t.bw('commit',[id,t.commitHash(id,t.hunter,2,rep2.reportHash,rep2.salt),ok.tap,ok.lockId,ok.deadline,ok.signature],5),/LockAlreadyUsed/); // one TAP lock = one submission
 const big=await t.ticket(1,t.hunter2,id,STAKE*3n);await t.bw('commit',[id,t.commitHash(id,t.hunter2,2,rep2.reportHash,rep2.salt),big.tap,big.lockId,big.deadline,big.signature],6); // staking more is allowed
 assert.equal((await t.sub(2n)).tapStake,STAKE*3n);
});

test('commit-reveal: hidden severity and report, bound to hunter/bounty/contract, front-running fails, reservations are exact',async()=>{
 const t=await setup();const id=await t.create();const rep=t.report('sqli');
 assert.equal(await t.br('commitHashFor',[id,t.hunter,3,rep.reportHash,rep.salt]),t.commitHash(id,t.hunter,3,rep.reportHash,rep.salt));
 const nibBefore=await t.bal(t.hunter);
 const s=await t.commit(id,5,3,rep);
 assert.equal(await t.bal(t.hunter),nibBefore,'the hunter stakes TAP only: no NIB moves');
 let b=await t.bnty(id);assert.equal(b.reserved,TIERS[3]);assert.equal(b.available,DEPOSIT-TIERS[3]);assert.equal(b.pending,1);
 const sb=await t.sub(s.id);assert.equal(sb.status,Status.Committed);assert.equal(sb.claimed,0);assert.equal(sb.tapStake,STAKE);assert.equal(sb.hunterLock,s.lockId);
 {const tk=await t.ticket(1,t.hunter2,id,STAKE);await t.rejects(t.bw('commit',[id,s.commitHash,STAKE,tk.lockId,tk.deadline,tk.signature],6),/CommitAlreadyUsed/);}
 assert.notEqual(t.commitHash(id,t.hunter2,3,rep.reportHash,rep.salt),s.commitHash);
 await t.rejects(t.bw('reveal',[s.id,3,rep.reportHash,rep.salt],6),/NotYourOpenCommit/);
 await t.rejects(t.bw('reveal',[s.id,2,rep.reportHash,rep.salt],5),/RevealDoesNotMatch/);await t.rejects(t.bw('reveal',[s.id,3,keccak256(toHex('x')),rep.salt],5),/RevealDoesNotMatch/);await t.rejects(t.bw('reveal',[s.id,3,rep.reportHash,keccak256(toHex('y'))],5),/RevealDoesNotMatch/);
 await t.rejects(t.bw('reveal',[s.id,5,rep.reportHash,rep.salt],5));await t.rejects(t.bw('reveal',[s.id,0,rep.reportHash,rep.salt],5));
 await t.reveal(s);
 b=await t.bnty(id);assert.equal(b.reserved,TIERS[2]);assert.equal(b.available,DEPOSIT-TIERS[2]);
 assert.equal((await t.sub(s.id)).status,Status.Applying);
 await t.rejects(t.reveal(s),/NotYourOpenCommit/);
 // a commit not revealed in time: anyone closes it, escrow is released, the hunter's TAP is forfeited and a strike applies
 const s2=await t.commit(id,6,2);
 await t.rejects(t.bw('expireCommit',[s2.id],0),/RevealWindowStillOpen/);
 await t.warp(25*H);await t.rejects(t.reveal(s2),/RevealWindowPassed/);
 await t.bw('expireCommit',[s2.id],0);
 b=await t.bnty(id);assert.equal(b.pending,1);assert.equal(b.reserved,TIERS[2]);
 assert.equal((await t.sub(s2.id)).outcome,Outcome.Unrevealed);
 const tr=await t.br('tapResult',[s2.lockId]);assert.deepEqual([tr[0],tr[1],tr[2],tr[3]],[true,0n,0n,STAKE],'forfeited TAP is burned');
 assert.equal(await t.br('strikes',[t.hunter2]),1n);assert.ok((await t.br('cooldownUntil',[t.hunter2]))>BigInt(await t.now()));
 await t.rejects(t.commit(id,6,2),/CoolingDown/);
 await t.solvent();
});

test('hunter limits: per-bounty, overall, open-submission caps; creator, guardian and signer cannot submit; no escrow = no commit',async()=>{
 const t=await setup();const id=await t.create({deposit:E(400000)});
 await t.commit(id,5);await t.commit(id,5);await t.commit(id,5);
 await t.rejects(t.commit(id,5),/TooManyOfYourSubmissions/);
 await t.rejects(t.commit(id,4),/NotAllowedToSubmit/);
 await t.idy(t.guardian);await t.idy(t.signer);await t.rejects(t.commit(id,2),/NotAllowedToSubmit/);await t.rejects(t.commit(id,1),/NotAllowedToSubmit/);
 await t.rejects(t.commit(id,0),/AgentIDRequired/);
 // the escrow must cover another top-tier payout
 await t.commit(id,6);await t.rejects(t.commit(id,6),/EscrowCannotBackAnotherTop/);   // 4 top-tier slots of 100k: all taken
});

test('hunter overall cap: 5 open submissions across bounties',async()=>{
 const t=await setup();const ids=[await t.create(),await t.create({scope:'b'}),await t.create({scope:'c'})];
 await t.commit(ids[0],5);await t.commit(ids[0],5);await t.commit(ids[1],5);await t.commit(ids[1],5);await t.commit(ids[2],5);
 await t.rejects(t.commit(ids[2],5),/TooManyOpenSubmissionsOverall/);
});

test('reviewer eligibility: no conflict of interest, no hunters of the bounty, Agent ID, TAP ticket, one application each, caps',async()=>{
 const t=await setup();const id=await t.create();const s=await t.submit(id,5,2);const s2=await t.submit(id,6,2);
 for(const i of [1,2,3])await t.idy(t.accounts[i].address);
 await t.rejects(t.apply(s.id,4),/ConflictOfInterest/);          // the creator
 await t.rejects(t.apply(s.id,5),/ConflictOfInterest/);          // the hunter themself
 await t.rejects(t.apply(s.id,6),/HuntersOfThisBountyCannot/);   // another hunter of the same bounty
 await t.rejects(t.apply(s.id,3),/ConflictOfInterest/);          // the fee recipient
 await t.rejects(t.apply(s.id,1),/ConflictOfInterest/);  // the ticket signer
 await t.rejects(t.apply(s.id,2),/ConflictOfInterest/);  // the guardian
 await t.rejects(t.apply(s.id,REV0,STAKE-1n),/TAPStakeBelowTheBounty/);
 await t.rejects(t.apply(s.id,REV0,STAKE,await t.ticket(1,t.accounts[REV0].address,s.id,STAKE)),/InvalidTAPTicket/);   // hunter ticket cannot be used to review
 await t.rejects(t.apply(s.id,REV0,STAKE,await t.ticket(2,t.accounts[REV0].address,s.id,STAKE,{signerIdx:7})),/InvalidTAPTicket/);
 await t.apply(s.id,REV0);await t.rejects(t.apply(s.id,REV0),/AlreadyApplied/);
 await t.apply(s2.id,REV0);
 // open reviews are capped at 5 per wallet
 const more=[];for(let i=0;i<3;i++)more.push(await t.submit(await t.create({scope:'m'+i}),7,2));
 for(const m of more)await t.apply(m.id,REV0);
 await t.rejects(t.apply((await t.submit(await t.create({scope:'last'}),8,2)).id,REV0),/TooManyOpenReviews|ConflictOfInterest/);
 await t.idy(t.accounts[28].address,0n);await t.rejects(t.apply(s.id,28),/AgentIDRequired/);
});

test('full valid flow: 2% fee to the vault, 20% to reviewers who voted with the outcome, the rest to the hunter; TAP results per lock',async()=>{
 const t=await setup();const id=await t.create();
 const s=await t.submit(id,5,2);
 const {panel,rest,locks}=await t.seat(s.id);
 assert.equal(panel.length,7);assert.equal(rest.length,7);
 let sb=await t.sub(s.id);assert.equal(sb.status,Status.Voting);
 for(const a of panel)assert.equal((await t.br('getReviewer',[s.id,t.accounts[a].address])).state,2);
 for(const a of rest)assert.equal((await t.br('getReviewer',[s.id,t.accounts[a].address])).state,3);
 // five vote severity 2 (aligned), two vote severity 1 (still within one step: aligned), the median is severity 2
 const hunterBefore=await t.bal(t.hunter),feeBefore=await t.bal(t.feeTo),held=await t.bal(t.bounty);
 await t.judge(s.id,panel,[2,2,2,2,2,1,1]);
 sb=await t.sub(s.id);assert.equal(sb.status,Status.Settled);assert.equal(sb.outcome,Outcome.Valid);assert.equal(sb.awarded,2);assert.equal(sb.aligned,7);
 const pay=TIERS[1],f=fee(pay),p=pool(pay),per=p/7n,dist=per*7n;
 assert.equal(await t.bal(t.feeTo)-feeBefore,f,'2% platform fee goes to the NibVaultV2 fee recipient');
 assert.equal(await t.bal(t.hunter)-hunterBefore,pay-f-dist,'the hunter keeps the remainder');
 assert.equal(await t.br('totalOwed'),dist);await t.solvent();
 for(const a of panel){assert.equal(await t.br('rewardOf',[t.accounts[a].address]),per);}
 const a0=t.accounts[panel[0]].address,b0=await t.bal(a0);await t.bw('claimReward',[],panel[0]);assert.equal(await t.bal(a0)-b0,per);
 await t.rejects(t.bw('claimReward',[],panel[0]),/NothingToClaim/);
 assert.equal(await t.br('totalOwed'),dist-per);await t.solvent();
 const b=await t.bnty(id);assert.equal(b.reserved,0n);assert.equal(b.available,DEPOSIT-pay);assert.equal(b.pending,0);
 // TAP: the hunter's lock is returned, every aligned reviewer is returned, unseated applicants are returned
 const tr=(l:string)=>t.br('tapResult',[l]).then((x:any)=>[x[0],x[1],x[2],x[3]]);
 assert.deepEqual(await tr(s.lockId),[true,STAKE,0n,0n]);
 for(const a of panel)assert.deepEqual(await tr(locks[a]),[true,STAKE,0n,0n]);
 for(const a of rest)assert.deepEqual(await tr(locks[a]),[true,STAKE,0n,0n]);
 assert.equal(await t.br('hunterActiveTotal',[t.hunter]),0n);assert.equal(await t.br('reviewerActive',[t.accounts[panel[0]].address]),0n);
});

test('a valid vote at a LOWER severity pays the median tier; reviewers who say invalid are slashed and struck; the hunter is capped at the claim',async()=>{
 const t=await setup();const id=await t.create();const s=await t.submit(id,5,2);const {panel,locks}=await t.seat(s.id);
 await t.judge(s.id,panel,[1,1,1,1,1,1,0]);
 const sb=await t.sub(s.id);assert.equal(sb.outcome,Outcome.Valid);assert.equal(sb.awarded,1);assert.equal(sb.aligned,6);
 const pay=TIERS[0];assert.equal(await t.br('totalOwed'),pool(pay)/6n*6n);await t.solvent();
 const tr=await t.br('tapResult',[locks[panel[6]]]);assert.deepEqual([tr[0],tr[1],tr[2],tr[3]],[true,0n,0n,STAKE],'the dissenting reviewer loses the TAP');
 assert.equal(await t.br('strikes',[t.accounts[panel[6]].address]),1n);assert.ok((await t.br('cooldownUntil',[t.accounts[panel[6]].address]))>0n);
 assert.equal(await t.br('rewardOf',[t.accounts[panel[6]].address]),0n);
 // votes above the claim are capped at the claim
 const s2=await t.submit(id,6,1);const seated=await t.seat(s2.id,{from:REV0+14});await t.judge(s2.id,seated.panel,[4,3,2,2,2,2,2]);
 const sb2=await t.sub(s2.id);assert.equal(sb2.outcome,Outcome.Valid);assert.equal(sb2.awarded,1);await t.solvent();
});

test('invalid report: nothing is paid, escrow returns, the hunter forfeits the TAP (burned) and the aligned reviewers split it; dissenters are slashed',async()=>{
 const t=await setup();const id=await t.create();const s=await t.submit(id,5,3);const {panel,rest,locks}=await t.seat(s.id);
 const hunterBefore=await t.bal(t.hunter);
 await t.judge(s.id,panel,[0,0,0,0,0,0,2]);
 let sb=await t.sub(s.id);assert.equal(sb.status,Status.Rejected,'a rejection is provisional while the hunter may appeal');assert.equal(sb.outcome,Outcome.Invalid);
 assert.deepEqual([...(await t.br('tapResult',[s.lockId]))],[false,0n,0n,0n],'TAP stays locked during the appeal window');assert.equal((await t.bnty(id)).reserved,TIERS[2],'the claimed tier stays reserved');
 await t.rejects(t.bw('resolveRejection',[s.id,0],0),/AppealWindowStillOpen/);
 await t.closeRejection(s.id);
 sb=await t.sub(s.id);assert.equal(sb.status,Status.Settled);assert.equal(sb.outcome,Outcome.Invalid);assert.equal(sb.aligned,6);
 assert.equal(await t.bal(t.hunter),hunterBefore,'no NIB to the hunter');assert.equal(await t.br('totalOwed'),0n,'no NIB reviewer reward on an invalid report');
 const b=await t.bnty(id);assert.equal(b.available,DEPOSIT);assert.equal(b.reserved,0n);await t.solvent();
 let tr=await t.br('tapResult',[s.lockId]);assert.deepEqual([tr[0],tr[1],tr[2],tr[3]],[true,0n,0n,STAKE]);
 for(const i of [0,1,2,3,4,5]){tr=await t.br('tapResult',[locks[panel[i]]]);assert.deepEqual([tr[0],tr[1],tr[2],tr[3]],[true,STAKE,STAKE/6n,0n],'aligned reviewer: stake back + 1/6 the forfeited hunter stake');}
 tr=await t.br('tapResult',[locks[panel[6]]]);assert.deepEqual([tr[0],tr[1],tr[2],tr[3]],[true,0n,0n,STAKE]);
 for(const a of rest){tr=await t.br('tapResult',[locks[a]]);assert.deepEqual([tr[0],tr[1],tr[2],tr[3]],[true,STAKE,0n,0n]);}
 assert.equal(await t.br('strikes',[t.hunter]),1n);await t.rejects(t.commit(id,5,2),/CoolingDown/);
 await t.warp(8*DAY);await t.commit(id,5,2);                                                         // the cooldown ends
});

test('duplicates: a good-faith duplicate gets the TAP back with no strike; only the earliest valid report is paid',async()=>{
 const t=await setup();const id=await t.create();
 const first=await t.submit(id,5,2);const sf=await t.seat(first.id,{from:REV0});await t.judge(first.id,sf.panel,[2,2,2,2,2,2,2]);
 assert.equal((await t.sub(first.id)).outcome,Outcome.Valid);
 const owedAfterFirst=await t.br('totalOwed');
 // a duplicate vote must point at an earlier live submission of the same bounty from ANOTHER hunter: self-reference and the future are refused
 const dup=await t.submit(id,6,2);const sd=await t.seat(dup.id,{from:REV0+14});
 await t.castVote(dup.id,sd.panel[0],DUP,dup.id);await t.castVote(dup.id,sd.panel[1],DUP,first.id+99n);for(let i=2;i<7;i++)await t.castVote(dup.id,sd.panel[i],DUP,first.id);
 await t.rejects(t.openVote(dup.id,sd.panel[0],DUP,dup.id),/DuplicateMustReference/);await t.rejects(t.openVote(dup.id,sd.panel[1],DUP,first.id+99n),/DuplicateMustReference/);
 for(let i=2;i<7;i++)await t.openVote(dup.id,sd.panel[i],DUP,first.id);
 await t.warp(49*H);await t.bw('finalizeJudgment',[dup.id],0);                                           // 5 of 7 revealed (< 6 quorum): no quorum
 assert.equal((await t.sub(dup.id)).outcome,Outcome.NoQuorum);
 const s3=await t.submit(id,7,2);const s3s=await t.seat(s3.id,{from:REV0+28});
 await t.judge(s3.id,s3s.panel,[DUP,DUP,DUP,DUP,DUP,DUP,DUP],first.id);await t.closeRejection(s3.id);
 const sb=await t.sub(s3.id);assert.equal(sb.outcome,Outcome.Duplicate);assert.equal(sb.duplicateOf,first.id);assert.equal(sb.awarded,0);
 const tr=await t.br('tapResult',[s3.lockId]);assert.deepEqual([tr[0],tr[1],tr[2],tr[3]],[true,STAKE,0n,0n],'good-faith duplicate: TAP returned');
 assert.equal(await t.br('strikes',[t.hunter3]),0n);
 for(const a of s3s.panel){const r=await t.br('tapResult',[s3s.locks[a]]);assert.deepEqual([r[0],r[1],r[2],r[3]],[true,STAKE,0n,0n],'aligned reviewers get the TAP back; no NIB for a duplicate');}
 assert.equal(await t.br('totalOwed'),owedAfterFirst,'only the first, valid report generated reviewer NIB');
 await t.solvent();
});

test('inconclusive, no quorum and no panel: nobody is paid, honest parties are made whole, no-shows are slashed',async()=>{
 const t=await setup();const id=await t.create();
 const first=await t.submit(id,5,2);const sf=await t.seat(first.id,{from:REV0});await t.judge(first.id,sf.panel,[2,2,2,2,2,2,2]);
 // inconclusive: 5 valid, 1 invalid, 1 duplicate -> fewer than 6 reviewers agree on the outcome
 const b=await t.submit(id,6,2);const sb=await t.seat(b.id,{from:REV0+14});
 const owed=await t.br('totalOwed');
 for(const [i,v,d] of [[0,2,0n],[1,2,0n],[2,2,0n],[3,2,0n],[4,2,0n],[5,0,0n],[6,DUP,first.id]] as const)await t.castVote(b.id,sb.panel[i],v,d);
 for(const [i,v,d] of [[0,2,0n],[1,2,0n],[2,2,0n],[3,2,0n],[4,2,0n],[5,0,0n],[6,DUP,first.id]] as const)await t.openVote(b.id,sb.panel[i],v,d);
 await t.bw('finalizeJudgment',[b.id],0);
 assert.equal((await t.sub(b.id)).outcome,Outcome.Inconclusive);assert.equal(await t.br('totalOwed'),owed);
 for(const a of sb.panel){const r=await t.br('tapResult',[sb.locks[a]]);assert.deepEqual([r[0],r[1],r[2],r[3]],[true,STAKE,0n,0n],'no verdict, no slashing');}
 assert.deepEqual([...(await t.br('tapResult',[b.lockId]))],[true,STAKE,0n,0n]);assert.equal(await t.br('strikes',[t.hunter2]),0n);
 // no quorum: only 5 of 7 reveal (< 6 minimum)
 const c=await t.submit(id,7,2);const sc=await t.seat(c.id,{from:REV0+28});
 await t.judge(c.id,sc.panel,[2,2,2,2,2,null,null]);
 assert.equal((await t.sub(c.id)).outcome,Outcome.NoQuorum);
 const trs=await Promise.all(sc.panel.map(i=>t.br('tapResult',[sc.locks[i]])));
 assert.deepEqual([trs[0][1],trs[0][3]],[STAKE,0n],'the ones who revealed get the TAP back');
 assert.deepEqual([trs[5][1],trs[5][3]],[0n,STAKE],'no-shows are slashed');
 assert.equal(await t.br('strikes',[t.accounts[sc.panel[5]].address]),1n);
 assert.deepEqual([...(await t.br('tapResult',[c.lockId]))],[true,STAKE,0n,0n],'the hunter is made whole when the panel failed');
 await t.solvent();
});

test('selection: window extension, too few applicants, randomness, seed-block rules, expiry',async()=>{
 const t=await setup();const id=await t.create();
 const s=await t.submit(id,5,2);
 await t.rejects(t.bw('startSelection',[s.id],0),/NotReadyForSelection/);
 for(let i=0;i<8;i++)await t.apply(s.id,REV0+i);   // 8 < 2x panel (14)
 await t.rejects(t.bw('selectPanel',[s.id],0),/NoSelectionRunning/);
 await t.warp(49*H);await t.bw('startSelection',[s.id],0);                                           // first call only extends the window once
 assert.equal((await t.sub(s.id)).extended,true);assert.equal((await t.sub(s.id)).seedBlock,0n);
 await t.rejects(t.apply(s.id,REV0+8,STAKE).then(()=>t.bw('startSelection',[s.id],0)),/NotReadyForSelection/);
 await t.warp(49*H);await t.bw('startSelection',[s.id],0);                                           // 9 >= panel size (7): the draw starts
 const sb=await t.sub(s.id);assert.ok(sb.seedBlock>0n);
 await t.rejects(t.bw('selectPanel',[s.id],0),/WaitForTheSeedBlock/);   // the seed block is not mined yet: nobody can pre-compute the draw
 await t.rejects(t.apply(s.id,REV0+9),/ApplicationsClosed/);
 await t.rejects(t.bw('startSelection',[s.id],0),/SelectionAlreadyRunning/);
 await t.mine(1);
 await t.bw('selectPanel',[s.id],0);
 const panel=await t.br('panelOf',[s.id]);assert.equal(panel.length,7);assert.equal(new Set(panel).size,7);
 const pool=[0,1,2,3,4,5,6,7,8].map(i=>t.accounts[REV0+i].address);for(const p of panel)assert.ok(pool.includes(p));
 await t.rejects(t.bw('selectPanel',[s.id],0),/NoSelectionRunning/);
 // a stale seed block (>200 blocks) cannot be used (the draw would be predictable): start again
 const s2=await t.submit(id,6,2);for(let i=0,k=REV0+10;i<14;k++){if(k===OWNER)continue;await t.apply(s2.id,k);i++;}
 await t.warp(49*H);await t.bw('startSelection',[s2.id],0);await t.mine(205);
 await t.rejects(t.bw('selectPanel',[s2.id],0),/SeedBlockExpired/);
 await t.bw('startSelection',[s2.id],0);await t.mine(1);await t.bw('selectPanel',[s2.id],0);
 // different seeds give different draws (not a fixed order)
 const draws=new Set<string>();
 for(let k=0;k<4;k++){const sk=await t.submit(await t.create({scope:'r'+k}),k%2?7:8,2);const r=await t.seat(sk.id,{n:16,from:REV0});draws.add(r.panel.join(','));}
 assert.ok(draws.size>1,'the draw varies');
 // too few applicants: after the extension the report is released without a verdict and nobody is penalised
 const s3=await t.submit(id,7,2);for(let i=0;i<6;i++)await t.apply(s3.id,REV0+31+i);
 await t.warp(49*H);await t.bw('startSelection',[s3.id],0);await t.warp(49*H);await t.bw('startSelection',[s3.id],0);
 assert.equal((await t.sub(s3.id)).outcome,Outcome.NoPanel);
 assert.equal(await t.br('strikes',[t.hunter3]),0n);
 const tr=await t.br('tapResult',[s3.lockId]);assert.deepEqual([tr[0],tr[1],tr[2],tr[3]],[true,STAKE,0n,0n]);
 assert.equal(await t.br('reviewerActive',[t.accounts[REV0+31].address]),0n);
 await t.solvent();
});

test('sealed votes: only seated reviewers, commit-reveal, wrong preimage rejected, reveal only after the vote window, finalize only when complete',async()=>{
 const t=await setup();const id=await t.create();const s=await t.submit(id,5,2);const {panel,rest}=await t.seat(s.id);
 await t.rejects(t.castVote(s.id,rest[0],2),/NotASeatedReviewer/);await t.rejects(t.castVote(s.id,5,2),/NotASeatedReviewer/);await t.rejects(t.castVote(s.id,4,2),/NotASeatedReviewer/);
 await t.rejects(t.bw('commitVote',[s.id,'0x'+'00'.repeat(32)],panel[0]),/NotASeatedReviewer/);
 await t.castVote(s.id,panel[0],2);await t.rejects(t.castVote(s.id,panel[0],0),/NotASeatedReviewer/);
 await t.rejects(t.openVote(s.id,panel[0],2),/NotTheRevealPhase/);                                       // votes stay sealed while voting is open
 await t.castVote(s.id,panel[1],2);
 await t.rejects(t.bw('finalizeJudgment',[s.id],0),/VotesAreStillOpen/);
 await t.warp(73*H);
 await t.rejects(t.castVote(s.id,panel[2],2),/VotingClosed/);
 await t.rejects(t.openVote(s.id,panel[0],1),/VoteDoesNotMatch/);await t.rejects(t.openVote(s.id,panel[2],2),/NoSealedVoteToOpen/);await t.rejects(t.openVote(s.id,panel[0],9),/VoteDoesNotMatch/);
 await t.openVote(s.id,panel[0],2);await t.rejects(t.openVote(s.id,panel[0],2),/NoSealedVoteToOpen/);
 await t.rejects(t.bw('finalizeJudgment',[s.id],0),/VotesAreStillOpen/);
 // an out-of-range verdict can be committed but never opened
 const t2=await setup();const i2=await t2.create();const s2=await t2.submit(i2,5,2);const p2=await t2.seat(s2.id);
 for(let i=0;i<7;i++)await t2.castVote(s2.id,p2.panel[i],i===0?9:2);
 await t2.rejects(t2.openVote(s2.id,p2.panel[0],9),/InvalidVerdict/);
 for(let i=1;i<7;i++)await t2.openVote(s2.id,p2.panel[i],2);await t2.warp(49*H);await t2.bw('finalizeJudgment',[s2.id],0);
 assert.equal((await t2.sub(s2.id)).outcome,Outcome.Valid,'6 of 7 is the quorum and >= 6 agreed: the vote that can never be opened counts as absent');
 assert.equal(await t2.br('strikes',[t2.accounts[p2.panel[0]].address]),1n);
});

test('reviewers are paid in NIB only on a valid report: split among aligned reviewers only, dust to the hunter, pull-payment',async()=>{
 const t=await setup({reviewerBps:2000n});const tiers=[E(10001)];const id=await t.create({tiers,deposit:E(30003),panel:9,stake:1000n});
 const s=await t.submit(id,5,1);const {panel}=await t.seat(s.id,{panel:9});
 const hunterBefore=await t.bal(t.hunter);
 await t.judge(s.id,panel,[1,1,1,1,1,1,0,0,null]);
 const sb=await t.sub(s.id);assert.equal(sb.outcome,Outcome.Valid);assert.equal(sb.aligned,6);
 const pay=tiers[0],f=fee(pay),per=pool(pay)/6n;
 assert.equal(await t.bal(t.hunter)-hunterBefore,pay-f-per*6n,'rounding dust and the unaligned share go to the hunter');
 assert.equal(await t.br('rewardOf',[t.accounts[panel[0]].address]),per);assert.equal(await t.br('rewardOf',[t.accounts[panel[6]].address]),0n);assert.equal(await t.br('rewardOf',[t.accounts[panel[8]].address]),0n);
 assert.equal(await t.br('strikes',[t.accounts[panel[8]].address]),1n);await t.solvent();
 for(const i of [0,1,2,3,4,5])await t.bw('claimReward',[],panel[i]);assert.equal(await t.br('totalOwed'),0n);await t.solvent();assert.equal(await t.br('totalReviewerPaid'),per*6n);
});

test('creator side: topUp, extend, cancel cooldown, withdraw only when nothing is pending; nobody else can touch the escrow',async()=>{
 const t=await setup();const id=await t.create();
 await t.bw('topUp',[id,E(1000)],4);assert.equal((await t.bnty(id)).available,DEPOSIT+E(1000));
 await t.rejects(t.bw('topUp',[id,E(1)],5),/OnlyTheCreator/);await t.rejects(t.bw('topUp',[id,0n],4),/InvalidAmount/);
 await t.rejects(t.bw('withdraw',[id],4),/BountyStillOpen/);await t.rejects(t.bw('withdraw',[id],5),/OnlyTheCreator/);
 const e=(await t.bnty(id)).endsAt;await t.bw('extend',[id,e+BigInt(DAY)],4);await t.rejects(t.bw('extend',[id,e],4),/InvalidEndTime/);
 const s=await t.commit(id,5,2);
 await t.bw('requestCancel',[id],4);await t.rejects(t.bw('requestCancel',[id],4),/BountyNotOpenOrAlready/);
 await t.rejects(t.bw('topUp',[id,1n],4),/BountyNotOpen/);
 await t.warp(8*DAY);
 await t.rejects(t.commit(id,6,2),/BountyNotOpen/);
 await t.rejects(t.bw('withdraw',[id],4),/SubmissionsStillPending/);
 await t.bw('expireCommit',[s.id],0);
 const before=await t.bal(t.creator);const avail=(await t.bnty(id)).available;
 await t.bw('withdraw',[id],4);assert.equal(await t.bal(t.creator)-before,avail);assert.equal(await t.bal(t.bounty),0n);
 await t.rejects(t.bw('withdraw',[id],4),/AlreadyWithdrawn/);await t.solvent();
});

test('signer rotation: guardian only, public 7-day delay, anyone activates, old tickets stop working',async()=>{
 const t=await setup();const id=await t.create();
 await t.rejects(t.bw('proposeSigner',[t.hunter],5),/OnlyTheGuardian/);await t.rejects(t.bw('proposeSigner',[t.signer],2),/InvalidSigner/);await t.rejects(t.bw('proposeSigner',[t.zeroAddress],2),/InvalidSigner/);
 await t.bw('proposeSigner',[t.accounts[10].address],2);
 await t.rejects(t.bw('activateSigner',[],0),/NotReady/);
 const old=await t.ticket(1,t.hunter,id,STAKE);
 await t.warp(7*DAY+5);await t.bw('activateSigner',[],0);
 assert.equal((await t.br('ticketSigner')).toLowerCase(),t.accounts[10].address.toLowerCase());
 const rep=t.report();await t.rejects(t.bw('commit',[id,t.commitHash(id,t.hunter,2,rep.reportHash,rep.salt),old.tap,old.lockId,BigInt(await t.now()+999),old.signature],5),/InvalidTAPTicket|TicketExpired/);
 await t.commit(id,5,2,rep,STAKE,await t.ticket(1,t.hunter,id,STAKE,{signerIdx:10}));
 await t.bw('proposeSigner',[t.accounts[11].address],2);await t.bw('cancelSignerChange',[],2);await t.warp(8*DAY);await t.rejects(t.bw('activateSigner',[],0),/NotReady/);
 // the guardian can never touch escrow
 await t.rejects(t.bw('withdraw',[id],2),/OnlyTheCreator/);
});

test('NIB safety: fee-on-transfer tokens are refused; a reentrant token cannot double-claim or unbalance the books',async()=>{
 const tax=await setup({token:'TaxToken'});await tax.rejects(tax.create(),/FeeOnTransfer/);
 const t=await setup({token:'HookToken'});const id=await t.create();
 const s=await t.submit(id,5,2);const {panel}=await t.seat(s.id);await t.judge(s.id,panel,[2,2,2,2,2,2,2]);
 const per=pool(TIERS[1])/7n;
 await t.w(t.nib,t.nibArt.abi,'arm',[t.bounty,(await import('viem')).encodeFunctionData({abi:t.bb.abi,functionName:'claimReward',args:[]})]);
 await t.bw('claimReward',[],panel[0]);
 assert.equal(await t.br('rewardOf',[t.accounts[panel[0]].address]),0n);
 assert.equal(await t.r(t.nib,t.nibArt.abi,'reentrySucceeded'),false,'reentrant claim is blocked');
 assert.equal(await t.bal(t.accounts[panel[0]].address)>=per,true);await t.solvent();
});

test('solvency across a mixed run: balance always equals escrow plus unclaimed reviewer rewards',async()=>{
 const t=await setup();const id=await t.create({panel:7});
 const flows=[[5,[2,2,2,2,2,2,2]],[6,[0,0,0,0,0,0,0]],[7,[1,1,1,1,1,1,0]]] as const;let from=REV0;
 for(const [h,votes] of flows){const s=await t.submit(id,h,2);const seated=await t.seat(s.id,{from});await t.judge(s.id,seated.panel,[...votes]);from+=15;await t.solvent('after '+h);}
 const open=await t.commit(id,5,2);await t.warp(25*H);await t.bw('expireCommit',[open.id],0);await t.solvent('after expiry');
 assert.ok((await t.br('totalFees'))>0n);
 assert.equal((await t.br('totalPaid'))+(await t.br('totalFees'))+(await t.br('totalOwed'))+(await t.br('totalReviewerPaid'))>0n,true);
});

// ---------------------------------------------------------------- appeals and the owner's final decision
const tr4=async(t:any,lock:string)=>{const r=await t.br('tapResult',[lock]);return [r[0],r[1],r[2],r[3]];};

test('appeal: the owner overrules a rejection and approves it: paid from the reserved escrow, hunter TAP back, no slashing of the dissenters',async()=>{
 const t=await setup();const id=await t.create();const s=await t.submit(id,5,3);const {panel,locks}=await t.seat(s.id);
 await t.judge(s.id,panel,[0,0,0,0,0,0,3]);
 await t.rejects(t.bw('appeal',[s.id],6),/OnlyTheHunter/);await t.rejects(t.bw('appeal',[s.id],OWNER),/OnlyTheHunter/);
 await t.bw('appeal',[s.id],5);
 assert.equal((await t.sub(s.id)).status,Status.Appealed);assert.equal((await t.bnty(id)).reserved,TIERS[2],'the claimed tier stays reserved during the appeal');
 await t.rejects(t.bw('appeal',[s.id],5),/NotRejected/);
 await t.rejects(t.bw('resolveRejection',[s.id,3],0),/OwnerStillDeciding/);await t.rejects(t.bw('resolveRejection',[s.id,3],5),/OwnerStillDeciding/);   // not even the hunter
 await t.rejects(t.bw('resolveRejection',[s.id,4],OWNER),/SeverityAboveTheClaim/);
 const pay=TIERS[2],h0=await t.bal(t.hunter),f0=await t.bal(t.feeTo);
 await t.bw('resolveRejection',[s.id,3],OWNER);
 const sb=await t.sub(s.id);assert.equal(sb.status,Status.Settled);assert.equal(sb.outcome,Outcome.Valid);assert.equal(sb.awarded,3);assert.equal(sb.overruled,true);assert.equal(sb.aligned,1);
 assert.equal(await t.bal(t.feeTo)-f0,fee(pay),'2% platform fee');
 assert.equal(await t.br('rewardOf',[t.accounts[panel[6]].address]),pool(pay),'the reviewers who reviewed (and voted with the final outcome) share 20% of THIS payout');
 assert.equal(await t.bal(t.hunter)-h0,pay-fee(pay)-pool(pay));
 const b=await t.bnty(id);assert.equal(b.reserved,0n);assert.equal(b.available,DEPOSIT-pay);
 assert.deepEqual(await tr4(t,s.lockId),[true,STAKE,0n,0n],'the hunter gets the TAP back');
 for(const i of [0,1,2,3,4,5,6])assert.deepEqual(await tr4(t,locks[panel[i]]),[true,STAKE,0n,0n],'nobody is slashed when the owner overrules the panel, nobody is paid TAP either');
 for(const i of [0,1,2,3,4,5,6])assert.equal(await t.br('strikes',[t.accounts[panel[i]].address]),0n);assert.equal(await t.br('strikes',[t.hunter]),0n);
 await t.rejects(t.bw('resolveRejection',[s.id,3],OWNER),/NotRejected/);await t.rejects(t.bw('appeal',[s.id],5),/NotRejected/);
 await t.solvent();
});

test('appeal: the owner rejects for good: the panel verdict is scored as usual (hunter TAP burned, one strike, dissenters struck)',async()=>{
 const t=await setup();const id=await t.create();const s=await t.submit(id,5,3);const {panel,locks}=await t.seat(s.id);
 await t.judge(s.id,panel,[0,0,0,0,0,0,2]);await t.bw('appeal',[s.id],5);
 await t.bw('resolveRejection',[s.id,0],OWNER);
 const sb=await t.sub(s.id);assert.equal(sb.status,Status.Settled);assert.equal(sb.outcome,Outcome.Invalid);assert.equal(sb.awarded,0);assert.equal(sb.overruled,false);assert.equal(sb.aligned,6);
 assert.equal(await t.br('totalOwed'),0n);const b=await t.bnty(id);assert.equal(b.available,DEPOSIT);assert.equal(b.reserved,0n);
 assert.deepEqual(await tr4(t,s.lockId),[true,0n,0n,STAKE]);assert.equal(await t.br('strikes',[t.hunter]),1n);
 assert.deepEqual(await tr4(t,locks[panel[0]]),[true,STAKE,STAKE/6n,0n]);assert.deepEqual(await tr4(t,locks[panel[6]]),[true,0n,0n,STAKE]);
 await t.solvent();
});

test('appeal: windows are bounded; nobody but the hunter can appeal, nobody but the owner can decide, a lapsed appeal closes with the panel verdict',async()=>{
 const t=await setup();const id=await t.create();
 await t.rejects(t.bw('appeal',[1n],5),/NotRejected/);await t.rejects(t.bw('resolveRejection',[1n,0],OWNER),/NotRejected/);   // nothing there yet
 // a valid verdict cannot be appealed
 const v=await t.settleValid(id,5,2);await t.rejects(t.bw('appeal',[v.s.id],5),/NotRejected/);
 // 1) the appeal window passes unused: anyone closes the rejection, the owner cannot reopen it
 const a=await t.submit(id,6,2);const sa=await t.seat(a.id,{from:REV0+15});await t.judge(a.id,sa.panel,[0,0,0,0,0,0,0]);
 await t.rejects(t.bw('resolveRejection',[a.id,0],0),/AppealWindowStillOpen/);await t.rejects(t.bw('resolveRejection',[a.id,2],OWNER),/AppealWindowStillOpen/);   // no appeal filed: the owner has nothing to decide
 await t.warp(3*DAY+5);await t.rejects(t.bw('appeal',[a.id],6),/AppealWindowPassed/);
 await t.bw('resolveRejection',[a.id,2],5);       // anyone; the severity is ignored
 assert.equal((await t.sub(a.id)).outcome,Outcome.Invalid);assert.equal((await t.sub(a.id)).awarded,0);assert.equal((await t.sub(a.id)).status,Status.Settled);
 // 2) an appeal the owner never answers lapses after 14 days: the panel's verdict stands, the owner can no longer force a payment
 const c=await t.submit(id,7,2);const sc=await t.seat(c.id,{from:REV0+31});await t.judge(c.id,sc.panel,[0,0,0,0,0,0,0]);await t.bw('appeal',[c.id],7);
 await t.warp(13*DAY);await t.rejects(t.bw('resolveRejection',[c.id,0],0),/OwnerStillDeciding/);
 await t.warp(DAY+10);
 const paid0=await t.br('totalPaid');await t.bw('resolveRejection',[c.id,2],OWNER);
 assert.equal((await t.sub(c.id)).outcome,Outcome.Invalid);assert.equal(await t.br('totalPaid'),paid0,'a late owner cannot force a payment');
 assert.deepEqual(await tr4(t,c.lockId),[true,0n,0n,STAKE]);
 await t.solvent();
});

test('appeal: the creator cannot withdraw while a rejection is open; the owner holds no other role and cannot touch escrow',async()=>{
 const t=await setup();const id=await t.create({days:14});const s=await t.submit(id,5,2);const {panel}=await t.seat(s.id);await t.judge(s.id,panel,[0,0,0,0,0,0,0]);
 await t.warp(14*DAY);await t.rejects(t.bw('withdraw',[id],4),/SubmissionsStillPending/);          // reserved for the appeal window
 await t.warp(3*DAY);await t.bw('resolveRejection',[s.id,0],0);await t.bw('withdraw',[id],4);
 // the owner is a role holder: no bounty, no report, no review
 await t.idy(t.owner);
 await t.rejects(t.bw('createBounty',[t.scopeHash('x'),TIERS,BigInt(await t.now()+30*DAY+60),7n,STAKE,DEPOSIT],OWNER),/RoleHolderCannotCreateBounties/);
 const id2=await t.create();
 await t.rejects(t.commit(id2,OWNER,2),/NotAllowedToSubmit/);
 const s2=await t.submit(id2,6,2);await t.rejects(t.apply(s2.id,OWNER),/ConflictOfInterest/);
 for(const [fn,args] of [['topUp',[id2,1n]],['extend',[id2,1n]],['withdraw',[id2]],['requestCancel',[id2]]] as const)await t.rejects(t.bw(fn,[...args],OWNER),/OnlyTheCreator/);
 await t.rejects(t.bw('claimReward',[],OWNER),/NothingToClaim/);
 await t.solvent();
});

test('reviewers share 20% of EACH payout (split among the reviewers who voted with the outcome), not 20% of the pool',async()=>{
 const t=await setup();const id=await t.create();
 const a=await t.settleValid(id,5,2);const b=await t.settleValid(id,6,4,undefined);
 const owed=await t.br('totalOwed') as bigint;
 const expect=pool(TIERS[1])+pool(TIERS[3]);
 assert.ok(owed<=expect&&expect-owed<=14n,'two payouts of 25,000 and 100,000 NIB credit 20% of each to their own panels: '+owed+' vs '+expect);
 assert.ok(owed<DEPOSIT*REVIEWER_BPS/10000n,'never 20% of the whole pool');
 await t.solvent();
});

test('consensus rule: verdict needs >= 6 reviewer agents agreeing; only those agreeing reviewers split the 20% pool',async()=>{
 const t=await setup();const id=await t.create({panel:7});
 // 1) 5 Valid, 2 Invalid -> fewer than 6 agreeing -> Inconclusive
 const s1=await t.submit(id,5,3);const p1=await t.seat(s1.id,{from:REV0});
 await t.judge(s1.id,p1.panel,[3,3,3,3,3,0,0]);
 assert.equal((await t.sub(s1.id)).outcome,Outcome.Inconclusive,'5 agreeing valid is not enough: needs >= 6');
 assert.equal(await t.br('totalOwed'),0n);
 // 2) 5 Invalid, 2 Valid -> fewer than 6 agreeing -> Inconclusive
 const s2=await t.submit(id,6,3);const p2=await t.seat(s2.id,{from:REV0+15});
 await t.judge(s2.id,p2.panel,[0,0,0,0,0,3,3]);
 assert.equal((await t.sub(s2.id)).outcome,Outcome.Inconclusive,'5 agreeing invalid is not enough: needs >= 6');
 // 3) 6 vote Valid, but 3 vote tier 1 and 3 vote tier 4 -> only 3 within ±1 tier of median -> Inconclusive
 const s3=await t.submit(id,7,4);const p3=await t.seat(s3.id,{from:REV0+31});
 await t.judge(s3.id,p3.panel,[1,1,1,4,4,4,0]);
 assert.equal((await t.sub(s3.id)).outcome,Outcome.Inconclusive,'6 valid votes split between tier 1 and tier 4 have only 3 agreeing with median');
 // 4) 6 agree on Valid (within ±1 of median 2: five vote 2, one votes 1), while the 7th votes tier 4 (2 tiers away) -> Valid at tier 2, only the 6 agreeing split the 20%
 const s4=await t.submit(id,5,4);const p4=await t.seat(s4.id,{from:REV0});
 await t.judge(s4.id,p4.panel,[2,2,2,2,2,1,4]);
 const sb4=await t.sub(s4.id);assert.equal(sb4.outcome,Outcome.Valid);assert.equal(sb4.awarded,2);assert.equal(sb4.aligned,6);
 const per=pool(TIERS[1])/6n;
 for(let i=0;i<6;i++)assert.equal(await t.br('rewardOf',[t.accounts[p4.panel[i]].address]),per,'each of the 6 agreeing reviewers gets 1/6 of the 20% pool');
 assert.equal(await t.br('rewardOf',[t.accounts[p4.panel[6]].address]),0n,'the 7th reviewer whose severity disagreed by 2 tiers gets nothing');
 assert.equal(await t.br('strikes',[t.accounts[p4.panel[6]].address]),1n);
 await t.solvent();
});
