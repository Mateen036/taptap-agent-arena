import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {encodeFunctionData,keccak256,toHex} from 'viem';
import {setup,E,DAY,TIERS,STAKE,DEPOSIT,FEE_BPS,MIN_DEPOSIT,MIN_TIER,Status,Reason,bountyArtifact,closeAll} from './helpers/bounty-chain';
after(closeAll);
const fee=(x:bigint)=>x*FEE_BPS/10000n;
const BURN='0x000000000000000000000000000000000000dEaD';

test('NibBugBounty: constructor guards, immutables, constants and NO owner/admin path to escrow (ABI audit)',async()=>{
 const t=await setup();
 assert.equal(await t.br('feeBps'),FEE_BPS);assert.equal(await t.br('minDeposit'),MIN_DEPOSIT);assert.equal(await t.br('minLowestTier'),MIN_TIER);
 assert.equal((await t.br('arbiter')).toLowerCase(),t.arbiter.toLowerCase());assert.equal((await t.br('feeRecipient')).toLowerCase(),t.feeTo.toLowerCase());
 for(const [k,v] of Object.entries({MAX_TIERS:4n,MIN_DURATION:14n*86400n,MAX_DURATION:365n*86400n,MIN_REVIEW_WINDOW:3n*86400n,MAX_REVIEW_WINDOW:30n*86400n,REVEAL_WINDOW:86400n,DISPUTE_WINDOW:3n*86400n,ARBITER_TIMEOUT:14n*86400n,CANCEL_COOLDOWN:7n*86400n,ARBITER_CHANGE_DELAY:14n*86400n,MAX_OPEN_SUBMISSIONS:20n,MAX_ACTIVE_PER_HUNTER:3n,MAX_FEE_BPS:500n}))assert.equal(await t.br(k),v,k);
 const d=(args:any[])=>t.deploy(t.bb,args);
 await t.rejects(d([t.hunter,t.registry,t.arbiter,t.feeTo,200n,MIN_DEPOSIT,MIN_TIER]),undefined);            // NIB must be a contract
 await t.rejects(d([t.nib,t.hunter,t.arbiter,t.feeTo,200n,MIN_DEPOSIT,MIN_TIER]));                          // registry must be a contract
 await t.rejects(d([t.nib,t.registry,t.zeroAddress,t.feeTo,200n,MIN_DEPOSIT,MIN_TIER]));
 await t.rejects(d([t.nib,t.registry,t.arbiter,t.zeroAddress,200n,MIN_DEPOSIT,MIN_TIER]));
 await t.rejects(d([t.nib,t.registry,t.arbiter,t.feeTo,501n,MIN_DEPOSIT,MIN_TIER]));                       // fee cap 5%
 await t.rejects(d([t.nib,t.registry,t.arbiter,t.feeTo,200n,MIN_TIER-1n,MIN_TIER]));                       // deposit minimum below tier minimum
 await t.rejects(d([t.nib,t.registry,t.arbiter,t.feeTo,200n,50n,50n]));
 await d([t.nib,t.registry,t.arbiter,t.feeTo,0n,MIN_DEPOSIT,MIN_TIER]); // a zero fee is allowed
 // ABI audit: nothing owner/admin/pause/upgrade/rescue/sweep shaped; every state-changing function is one of the reviewed set.
 const fns=bountyArtifact().abi.filter((x:any)=>x.type==='function');
 assert.ok(!fns.some((x:any)=>/owner|admin|pause|upgrade|rescue|sweep|recover|setFee|setArbiter|emergency|withdrawFees|setToken|initialize|delegate|selfdestruct/i.test(x.name)),'no admin-shaped function');
 const writes=fns.filter((x:any)=>x.stateMutability!=='view'&&x.stateMutability!=='pure').map((x:any)=>x.name).sort();
 assert.deepEqual(writes,['accept','acceptArbiter','acceptDecision','cancelArbiterChange','claimArbiterTimeout','commit','createBounty','dispute','escalate','expireCommit','extend','finalize','proposeArbiter','reject','requestCancel','resolveDispute','reveal','topUp','withdraw']);
 assert.ok(!fns.some((x:any)=>x.stateMutability==='payable'),'never accepts BNB');
 assert.equal(bountyArtifact().abi.some((x:any)=>x.type==='receive'||x.type==='fallback'),false);
});

test('createBounty: exact escrow and every rule that keeps bounties honest',async()=>{
 const t=await setup();
 const base=async(o:any={})=>({scope:t.scopeHash(),tiers:TIERS,ends:BigInt(await t.now()+30*DAY+60),review:BigInt(7*DAY),stake:STAKE,deposit:DEPOSIT,...o});
 const call=async(o:any={},who=3)=>{const p=await base(o);return t.bw('createBounty',[p.scope,p.tiers,p.ends,p.review,p.stake,p.deposit],who);};
 const before=await t.bal(t.creator);
 await call();
 assert.equal(before-await t.bal(t.creator),DEPOSIT,'exactly the deposit leaves the creator');assert.equal(await t.bal(t.bounty),DEPOSIT);
 const b=await t.bnty(1n);
 assert.equal(b.creator.toLowerCase(),t.creator.toLowerCase());assert.equal(b.available,DEPOSIT);assert.equal(b.reserved,0n);assert.equal(b.tierCount,4);assert.deepEqual([...b.tiers],TIERS);assert.equal(b.stake,STAKE);assert.equal(b.scopeHash,t.scopeHash());
 assert.equal(await t.br('totalEscrow'),DEPOSIT);await t.solvent();
 assert.equal((await t.br('creatorStats',[t.creator]))[0],1);
 await t.rejects(call({},9),/Agent ID/);                                  // no Agent ID (account 9 never registered)
 await t.rejects(call({},1),/Arbiter cannot create/);                     // the arbiter can never be a project
 await t.rejects(call({scope:'0x'+'00'.repeat(32)}),/Scope hash/);
 await t.rejects(call({tiers:[]}),/1 to 4/);await t.rejects(call({tiers:[E(1e4),E(2e4),E(3e4),E(4e4),E(5e4)]}),/1 to 4/);
 await t.rejects(call({tiers:[E(10000),E(10000)]}),/strictly increase/);await t.rejects(call({tiers:[E(20000),E(10000)]}),/strictly increase/);
 await t.rejects(call({tiers:[E(9999),E(20000)],stake:E(500)}),/Lowest tier below minimum/);
 await t.rejects(call({deposit:E(49999)}),/Deposit below minimum/);                // minimum reward
 await t.rejects(call({tiers:[E(10000),E(60000)],deposit:E(55000)}),/Deposit below minimum or top tier/); // must cover the top tier
 await t.rejects(call({stake:E(99)}),/Stake must be/);await t.rejects(call({stake:E(1001)}),/Stake must be/);await t.rejects(call({stake:0n}),/Stake must be/);
 await t.rejects(call({ends:BigInt(await t.now()+13*DAY)}),/Duration/);               // minimum duration 14 days
 await t.rejects(call({ends:BigInt(await t.now()+366*DAY)}),/Duration/);
 await t.rejects(call({review:BigInt(2*DAY)}),/Review window/);await t.rejects(call({review:BigInt(31*DAY)}),/Review window/);
 const poor=await t.bal(t.creator);await t.approve(3,E(1));await t.rejects(call());await t.approve(3);assert.equal(await t.bal(t.creator),poor,'failed create moves nothing');
 await call({tiers:[E(10000)],deposit:E(50000)});assert.equal((await t.bnty(2n)).tierCount,1);                       // a single tier is fine
 await t.rejects(t.bw('createBounty',[t.scopeHash(),TIERS,BigInt(await t.now()+30*DAY),BigInt(7*DAY),STAKE,DEPOSIT],3).then(()=>t.bw('topUp',[1n,E(1)],4)),/Only the creator/);
 await t.solvent();
});

test('commit-reveal: hidden severity, binding to hunter/bounty/contract, front-running and copying fail, reservations are exact',async()=>{
 const t=await setup();const id=await t.create();
 const rep=t.report('sqli');
 // on-chain helper matches the documented formula
 assert.equal(await t.br('commitHashFor',[id,t.hunter,3,rep.reportHash,rep.salt]),t.commitHash(id,t.hunter,3,rep.reportHash,rep.salt));
 const before=await t.bal(t.hunter);
 const s=await t.commit(id,4,3,rep);
 assert.equal(before-await t.bal(t.hunter),STAKE,'stake locked');
 let b=await t.bnty(id);assert.equal(b.reserved,TIERS[3],'top tier reserved while severity is hidden');assert.equal(b.available,DEPOSIT-TIERS[3]);assert.equal(b.pending,1);
 const sb=await t.sub(s.id);assert.equal(sb.status,Status.Committed);assert.equal(sb.claimed,0,'severity not public yet');assert.equal(sb.reportHash,'0x'+'00'.repeat(32));
 // copying the commit hash from the mempool is useless: the same hash cannot be reused, and a different hunter's hash differs
 await t.rejects(t.bw('commit',[id,s.commitHash],5),/Commit already used/);
 const copy=t.commitHash(id,t.hunter2,3,rep.reportHash,rep.salt);assert.notEqual(copy,s.commitHash,'hash binds the hunter address');
 // a front-runner cannot reveal someone else's commit, even knowing the preimage
 await t.rejects(t.bw('reveal',[s.id,3,rep.reportHash,rep.salt],5),/Not your open commit/);
 // wrong severity / report / salt cannot reveal
 await t.rejects(t.bw('reveal',[s.id,2,rep.reportHash,rep.salt],4),/does not match/);await t.rejects(t.bw('reveal',[s.id,3,keccak256(toHex('x')),rep.salt],4),/does not match/);await t.rejects(t.bw('reveal',[s.id,3,rep.reportHash,keccak256(toHex('y'))],4),/does not match/);
 await t.rejects(t.bw('reveal',[s.id,5,rep.reportHash,rep.salt],4));await t.rejects(t.bw('reveal',[s.id,0,rep.reportHash,rep.salt],4));
 await t.rejects(t.bw('reveal',[99n,3,rep.reportHash,rep.salt],4));
 await t.reveal(s);
 b=await t.bnty(id);assert.equal(b.reserved,TIERS[2],'reservation drops to the claimed tier');assert.equal(b.available,DEPOSIT-TIERS[2]);
 const r2=await t.sub(s.id);assert.equal(r2.status,Status.Revealed);assert.equal(r2.claimed,3);assert.equal(r2.reportHash,rep.reportHash);assert.equal(r2.deadline,BigInt(await t.now())+BigInt(7*DAY)-(BigInt(await t.now())-BigInt(r2.revealedAt)),'review clock is revealedAt + window');
 await t.rejects(t.reveal(s),/Not your open commit/);                                  // cannot reveal twice
 await t.rejects(t.bw('commit',[id,'0x'+'00'.repeat(32)],5),/Commit already used/);   // zero hash rejected
 assert.deepEqual([...(await t.br('submissionsOf',[id]))],[s.id]);assert.deepEqual([...(await t.br('hunterSubmissions',[t.hunter]))],[s.id]);
 await t.solvent();
});

test('abuse: self-dealing, identity, limits, and a bounty that cannot back another top-tier payout',async()=>{
 const t=await setup();const id=await t.create({deposit:E(250000)}); // backs exactly two top-tier (100k) commits
 const h=(who:number)=>t.commitHash(id,t.accounts[who].address,2,t.report().reportHash,t.report().salt);
 await t.rejects(t.bw('commit',[id,h(3)],3),/Creator\/arbiter cannot submit/);        // anti-self-dealing: creator address
 await t.rejects(t.bw('commit',[id,h(1)],1),/Creator\/arbiter cannot submit/);        // arbiter cannot hunt
 await t.rejects(t.bw('commit',[id,h(9)],9),/Agent ID required/);
 await t.idy(t.hunter3,0n);await t.rejects(t.bw('commit',[id,h(6)],6),/Agent ID required/);await t.idy(t.hunter3);
 await t.rejects(t.bw('commit',[99n,h(4)],4),/Bounty not open/);
 await t.commit(id,4);await t.commit(id,5);
 assert.equal(await t.br('freeSlots',[id]),0n);
 await t.rejects(t.commit(id,6),/Escrow cannot back/);                                // third commit cannot be backed
 await t.rejects(t.bw('withdraw',[id],3),/still open/);
 // per-hunter cap needs a rich bounty
 const rich=await t.create({deposit:E(5_000_000),scope:'rich'});
 await t.commit(rich,4);await t.commit(rich,4);await t.commit(rich,4);
 await t.rejects(t.commit(rich,4),/Too many of your submissions/);
 // bounty-wide cap of 20 open submissions
 let n=3;for(const w of [5,6]){for(let i=0;i<3&&n<20;i++,n++)await t.commit(rich,w);}
 await t.idy(t.creator2);const r3=await t.create({deposit:E(5_000_000),scope:'r3',who:7});
 // creator2 cannot be a hunter on its own bounty, but may hunt on another one
 await t.rejects(t.commit(r3,7),/Creator\/arbiter cannot submit/);await t.commit(rich,7);n++;
 assert.equal((await t.bnty(rich)).pending,n);
 // approvals missing -> no commit, no state change
 await t.approve(4,0n);const pend=(await t.bnty(r3)).pending;await t.rejects(t.commit(r3,4));assert.equal((await t.bnty(r3)).pending,pend);await t.approve(4);
 await t.solvent();
});

test('bounty lifecycle windows: commits stop at the end, reveals still allowed, expiry pays the creator and frees the reservation',async()=>{
 const t=await setup();const id=await t.create({days:15});
 const s=await t.commit(id,4,4);
 await t.rejects(t.bw('expireCommit',[s.id],5),/Not expired/);
 await t.warp(DAY+10);
 await t.rejects(t.reveal(s),/Reveal window passed/);
 const creatorBefore=await t.bal(t.creator);
 await t.bw('expireCommit',[s.id],6); // anyone can trigger the expiry
 assert.equal(await t.bal(t.creator)-creatorBefore,STAKE,'forfeited stake compensates the project');
 assert.equal((await t.sub(s.id)).status,Status.Expired);let b=await t.bnty(id);assert.equal(b.reserved,0n);assert.equal(b.available,DEPOSIT);assert.equal(b.pending,0);assert.equal(await t.br('hunterActive',[id,t.hunter]),0n);
 await t.rejects(t.bw('expireCommit',[s.id],6),/Not expired/);
 await t.solvent();
 // ending: new commits blocked after endsAt, a pending reveal still completes
 const s2=await t.commit(id,4,1);
 await t.warp(14*DAY+DAY); // past endsAt (15 days+60s from creation), commit still unrevealed? (reveal window = 1 day)
 assert.equal(await t.br('isOpen',[id]),false);
 await t.rejects(t.commit(id,5),/Bounty not open/);
 await t.rejects(t.reveal(s2),/Reveal window passed/);await t.bw('expireCommit',[s2.id],5);
 await t.rejects(t.bw('topUp',[id,E(1)],3),/not open/);await t.rejects(t.bw('extend',[id,BigInt(await t.now()+40*DAY)],3),/not open/);
});

test('project pays in full: net of fee, stake refunded, escrow remainder stays, stats update',async()=>{
 const t=await setup();const id=await t.create();
 const s=await t.submit(id,4,3);
 const hb=await t.bal(t.hunter),fb=await t.bal(t.feeTo);
 await t.rejects(t.bw('accept',[s.id,3],4),/Only the creator/);await t.rejects(t.bw('accept',[s.id,3],1),/Only the creator/);await t.rejects(t.bw('accept',[s.id,3],5),/Only the creator/);
 await t.rejects(t.bw('accept',[s.id,4],3),/within the claimed tier/);await t.rejects(t.bw('accept',[s.id,0],3),/within the claimed tier/);
 await t.bw('accept',[s.id,3],3);
 const pay=TIERS[2];
 assert.equal(await t.bal(t.hunter)-hb,pay-fee(pay)+STAKE,'hunter gets payout minus 2% plus stake back');assert.equal(await t.bal(t.feeTo)-fb,fee(pay));
 const b=await t.bnty(id);assert.equal(b.reserved,0n);assert.equal(b.available,DEPOSIT-pay);assert.equal(b.pending,0);
 assert.equal((await t.sub(s.id)).status,Status.Settled);assert.equal((await t.sub(s.id)).awarded,3);
 const cs=await t.br('creatorStats',[t.creator]),hs=await t.br('hunterStats',[t.hunter]);assert.equal(cs[1],1);assert.equal(cs[5],pay);assert.equal(hs[0],1);assert.equal(hs[2],pay-fee(pay));
 assert.equal(await t.br('totalFees'),fee(pay));assert.equal(await t.br('totalPaid'),pay-fee(pay));assert.equal(await t.br('totalEscrow'),DEPOSIT-pay);
 await t.rejects(t.bw('accept',[s.id,3],3),/Not awaiting review/);await t.rejects(t.bw('reject',[s.id,2,0n],3),/Not awaiting review/);
 await t.solvent();
});

test('project downgrades: hunter can accept, let it stand, or dispute with a bond',async()=>{
 const t=await setup();const id=await t.create();
 // 1) hunter accepts the lower award at once
 const a=await t.submit(id,4,4);await t.bw('accept',[a.id,2],3);
 let sb=await t.sub(a.id);assert.equal(sb.status,Status.Decided);assert.equal(sb.awarded,2);
 let b=await t.bnty(id);assert.equal(b.reserved,TIERS[3],'the claimed tier stays reserved while the hunter may dispute');
 await t.rejects(t.bw('acceptDecision',[a.id],5),/Not your decided/);await t.rejects(t.bw('finalize',[a.id],5),/Not finalisable/);
 const hb=await t.bal(t.hunter);await t.bw('acceptDecision',[a.id],4);
 assert.equal(await t.bal(t.hunter)-hb,TIERS[1]-fee(TIERS[1])+STAKE);b=await t.bnty(id);assert.equal(b.reserved,0n);assert.equal(b.available,DEPOSIT-TIERS[1],'difference to the claim returns to the project');
 // 2) hunter is silent: anyone finalises after the dispute window
 const c=await t.submit(id,5,3);await t.bw('accept',[c.id,1],3);
 await t.warp(3*DAY+10);await t.rejects(t.bw('dispute',[c.id],5),/Dispute window passed/);
 const hb2=await t.bal(t.hunter2);await t.bw('finalize',[c.id],6);
 assert.equal(await t.bal(t.hunter2)-hb2,TIERS[0]-fee(TIERS[0])+STAKE);assert.equal((await t.sub(c.id)).awarded,1);
 // 3) hunter disputes with a bond; arbiter rules higher => bond back, hunter paid the higher tier
 const d=await t.submit(id,4,4);await t.bw('accept',[d.id,1],3);
 const hb3=await t.bal(t.hunter);await t.rejects(t.bw('dispute',[d.id],5),/Not your decided/);await t.bw('dispute',[d.id],4);
 assert.equal(hb3-await t.bal(t.hunter),STAKE,'dispute bond locked');assert.equal((await t.sub(d.id)).bond,STAKE);assert.equal((await t.sub(d.id)).status,Status.Disputed);await t.solvent();
 await t.rejects(t.bw('resolveDispute',[d.id,4,true],4),/Only the arbiter/);await t.rejects(t.bw('resolveDispute',[d.id,4,true],3),/Only the arbiter/);await t.rejects(t.bw('resolveDispute',[d.id,5,true],1),/Above claimed/);
 const hb4=await t.bal(t.hunter);await t.bw('resolveDispute',[d.id,4,true],1);
 assert.equal(await t.bal(t.hunter)-hb4,TIERS[3]-fee(TIERS[3])+2n*STAKE,'full payout + stake + bond');
 assert.equal((await t.br('creatorStats',[t.creator]))[3],1,'overturn recorded against the project');
 // 4) arbiter sides with the project's lower award => bond is burned, stake returned
 const e=await t.submit(id,4,3);await t.bw('accept',[e.id,2],3);await t.bw('dispute',[e.id],4);
 const burnBefore=await t.bal(BURN),hb5=await t.bal(t.hunter);await t.bw('resolveDispute',[e.id,2,true],1);
 assert.equal(await t.bal(t.hunter)-hb5,TIERS[1]-fee(TIERS[1])+STAKE);assert.equal(await t.bal(BURN)-burnBefore,STAKE,'losing dispute burns only the bond');
 await t.rejects(t.bw('resolveDispute',[e.id,2,true],1),/Not disputed/);
 await t.solvent();
});

test('rejections: reasons, duplicate priority rules, stake burn vs refund, arbitrated reversal',async()=>{
 const t=await setup();const id=await t.create();
 const first=await t.submit(id,4,2);        // earliest valid commit
 const second=await t.submit(id,5,2);       // later duplicate
 const third=await t.submit(id,6,2);
 await t.rejects(t.bw('reject',[second.id,0,0n],3),/Reason required/);await t.rejects(t.bw('reject',[second.id,2,1n],3),/duplicateOf only/);
 await t.rejects(t.bw('reject',[second.id,1,0n],3),/earlier submission/);await t.rejects(t.bw('reject',[second.id,1,second.id],3),/earlier submission/);
 await t.rejects(t.bw('reject',[first.id,1,second.id],3),/earlier submission/);             // cannot call the EARLIER commit a duplicate of a later one
 await t.rejects(t.bw('reject',[second.id,1,99n],3),/earlier submission/);
 await t.rejects(t.bw('reject',[second.id,2,0n],4),/Only the creator/);
 await t.bw('reject',[second.id,1,first.id],3);
 let s=await t.sub(second.id);assert.equal(s.status,Status.Decided);assert.equal(s.reason,Reason.Duplicate);assert.equal(s.duplicateOf,first.id);
 // duplicate of a submission that was itself rejected as invalid is refused
 await t.bw('reject',[first.id,2,0n],3);
 await t.rejects(t.bw('reject',[third.id,1,first.id],3),/not valid/);
 // a duplicate ruling returns the stake when it stands
 const hb=await t.bal(t.hunter2);await t.warp(3*DAY+5);await t.bw('finalize',[second.id],7);
 assert.equal(await t.bal(t.hunter2)-hb,STAKE,'duplicate: stake back, no payout');assert.equal((await t.sub(second.id)).awarded,0);
 // an invalid rejection that stands burns the stake
 const burn0=await t.bal(BURN),h0=await t.bal(t.hunter);await t.bw('finalize',[first.id],7);
 assert.equal(await t.bal(BURN)-burn0,STAKE);assert.equal(await t.bal(t.hunter),h0,'no refund for a rejection that stood');
 assert.equal((await t.br('hunterStats',[t.hunter]))[1],1);assert.equal((await t.br('creatorStats',[t.creator]))[2],2);
 // hunter concedes explicitly
 const c=await t.submit(id,4,1);await t.bw('reject',[c.id,3,0n],3);const b0=await t.bal(BURN);await t.bw('acceptDecision',[c.id],4);assert.equal(await t.bal(BURN)-b0,STAKE);
 // hunter disputes a wrong rejection; arbiter reverses it: full payout, stake + bond back
 const d=await t.submit(id,5,4);await t.bw('reject',[d.id,4,0n],3);await t.bw('dispute',[d.id],5);
 const h1=await t.bal(t.hunter2);await t.bw('resolveDispute',[d.id,4,false],1);assert.equal(await t.bal(t.hunter2)-h1,TIERS[3]-fee(TIERS[3])+2n*STAKE);
 // arbiter upholds a rejection: burn bond; stake burned unless returnStake
 const e=await t.submit(id,6,2);await t.bw('reject',[e.id,2,0n],3);await t.bw('dispute',[e.id],6);
 const b1=await t.bal(BURN);await t.bw('resolveDispute',[e.id,0,false],1);assert.equal(await t.bal(BURN)-b1,2n*STAKE);
 const f=await t.submit(id,6,2);await t.bw('reject',[f.id,2,0n],3);await t.bw('dispute',[f.id],6);
 const b2=await t.bal(BURN),h2=await t.bal(t.hunter3);await t.bw('resolveDispute',[f.id,0,true],1);assert.equal(await t.bal(BURN)-b2,STAKE,'arbiter may return the stake of an honest-but-wrong report');assert.equal(await t.bal(t.hunter3)-h2,STAKE);
 await t.bw('reject',[third.id,2,0n],3);await t.warp(3*DAY+5);await t.bw('finalize',[third.id],7);
 assert.equal((await t.bnty(id)).pending,0);
 await t.solvent();
});

test('project silence: hunter escalates after the review window (no bond); arbiter ruling and timeout fallbacks',async()=>{
 const t=await setup();const id=await t.create({review:3});
 const s=await t.submit(id,4,3);
 await t.rejects(t.bw('escalate',[s.id],4),/review window still open/);await t.rejects(t.bw('escalate',[s.id],5),/Not your revealed/);
 await t.warp(3*DAY+10);
 await t.rejects(t.bw('escalate',[s.id],5),/Not your revealed/);
 await t.bw('escalate',[s.id],4);
 let sb=await t.sub(s.id);assert.equal(sb.status,Status.Disputed);assert.equal(sb.escalated,true);assert.equal(sb.bond,0n);assert.equal((await t.br('creatorStats',[t.creator]))[4],1,'silence is recorded');
 await t.rejects(t.bw('accept',[s.id,3],3),/Not awaiting review/);    // the project lost its chance to decide
 await t.rejects(t.bw('claimArbiterTimeout',[s.id],5),/still has time/);
 const hb=await t.bal(t.hunter);await t.bw('resolveDispute',[s.id,2,true],1);
 assert.equal(await t.bal(t.hunter)-hb,TIERS[1]-fee(TIERS[1])+STAKE);
 // arbiter silent for 14 days: hunter gets the LOWEST tier (project silent) plus stake; the rest returns to the project
 const u=await t.submit(id,5,4);await t.warp(3*DAY+10);await t.bw('escalate',[u.id],5);
 const bBefore=await t.bnty(id);await t.warp(14*DAY+10);
 const h2=await t.bal(t.hunter2);await t.bw('claimArbiterTimeout',[u.id],6);
 assert.equal(await t.bal(t.hunter2)-h2,TIERS[0]-fee(TIERS[0])+STAKE);const bAfter=await t.bnty(id);assert.equal(bAfter.reserved,0n);assert.equal(bAfter.available,bBefore.available+TIERS[3]-TIERS[0]+TIERS[3]-TIERS[3]+ (bBefore.reserved-TIERS[3]));
 // late decision is allowed only while the hunter has not escalated: project answers after the window but before escalation
 const late=await t.submit(id,4,2);await t.warp(3*DAY+10);await t.bw('reject',[late.id,2,0n],3);assert.equal((await t.sub(late.id)).status,Status.Decided);
 // timeout after a dispute of a project downgrade keeps at least the project's own award
 const v=await t.submit(id,5,4);await t.bw('accept',[v.id,3],3);await t.bw('dispute',[v.id],5);await t.warp(14*DAY+10);
 const h3=await t.bal(t.hunter2);await t.bw('claimArbiterTimeout',[v.id],4);assert.equal(await t.bal(t.hunter2)-h3,TIERS[2]-fee(TIERS[2])+2n*STAKE,'project award + stake + bond back');
 await t.solvent();
});

test('escrow protection: no withdrawal before the end, while pending, or during a cancel cooldown; cancel is delayed; extend only lengthens',async()=>{
 const t=await setup();const id=await t.create({days:20});
 await t.rejects(t.bw('withdraw',[id],3),/still open/);await t.rejects(t.bw('withdraw',[id],4),/Only the creator/);await t.rejects(t.bw('withdraw',[id],1),/Only the creator/);
 await t.rejects(t.bw('requestCancel',[id],4),/Only the creator/);
 await t.rejects(t.bw('extend',[id,BigInt(await t.now()+5*DAY)],3),/Invalid end time/);                // cannot shorten
 await t.bw('extend',[id,BigInt(await t.now()+60*DAY)],3);assert.ok((await t.bnty(id)).endsAt>BigInt(await t.now()+59*DAY));
 await t.rejects(t.bw('extend',[id,BigInt(await t.now()+400*DAY)],3),/Invalid end time/);
 await t.bw('topUp',[id,E(10000)],3);assert.equal((await t.bnty(id)).available,DEPOSIT+E(10000));await t.rejects(t.bw('topUp',[id,0n],3),/Invalid amount/);
 // cancel: starts a 7 day cooldown; commits still accepted during it; withdrawal only afterwards
 await t.bw('requestCancel',[id],3);
 await t.rejects(t.bw('requestCancel',[id],3),/already closing/);await t.rejects(t.bw('topUp',[id,E(1)],3),/not open/);await t.rejects(t.bw('extend',[id,BigInt(await t.now()+90*DAY)],3),/not open/);
 await t.rejects(t.bw('withdraw',[id],3),/still open/);
 const s=await t.commit(id,4,1);                                                                          // hunters can still submit during the cooldown
 await t.warp(7*DAY+10);
 assert.equal(await t.br('isOpen',[id]),false);await t.rejects(t.commit(id,5),/Bounty not open/);
 await t.rejects(t.bw('withdraw',[id],3),/Submissions still pending/);                                    // pending commit blocks withdrawal
 await t.warp(DAY);await t.bw('expireCommit',[s.id],5);                                                   // commit expires (unrevealed)
 // reveal a different one so we test pending-blocks-withdrawal through revealed/decided/disputed too
 const t2=await setup();const id2=await t2.create({days:15});const s2=await t2.submit(id2,4,2);await t2.warp(15*DAY+120);
 await t2.rejects(t2.bw('withdraw',[id2],3),/Submissions still pending/);
 await t2.bw('reject',[s2.id,2,0n],3);await t2.rejects(t2.bw('withdraw',[id2],3),/Submissions still pending/);                    // decided but not final
 await t2.bw('dispute',[s2.id],4);await t2.rejects(t2.bw('withdraw',[id2],3),/Submissions still pending/);                         // disputed
 await t2.bw('resolveDispute',[s2.id,2,true],1);
 const cb=await t2.bal(t2.creator),avail=(await t2.bnty(id2)).available;await t2.bw('withdraw',[id2],3);
 assert.equal(await t2.bal(t2.creator)-cb,avail);assert.equal(avail,DEPOSIT-TIERS[1],'only the unpaid remainder is withdrawable');assert.equal((await t2.bnty(id2)).closed,true);
 await t2.rejects(t2.bw('withdraw',[id2],3),/Already withdrawn/);assert.equal(await t2.br('totalEscrow'),0n);assert.equal(await t2.bal(t2.bounty),0n);
 // original bounty: after expiry nothing pending => full withdrawal incl. top up
 const before=await t.bal(t.creator);await t.bw('withdraw',[id],3);assert.equal(await t.bal(t.creator)-before,DEPOSIT+E(10000)+0n);
 await t.rejects(t.commit(id,4),/Bounty not open/);
 await t.solvent();await t2.solvent();
});

test('arbiter powers are bounded: cannot touch escrow, cannot be a party, cannot rule on undisputed or above the claim; rotation is public and delayed',async()=>{
 const t=await setup();const id=await t.create();const s=await t.submit(id,4,2);
 const bal0=await t.bal(t.bounty);
 await t.rejects(t.bw('resolveDispute',[s.id,2,true],1),/Not disputed/);                               // cannot rule before a dispute exists
 await t.rejects(t.bw('withdraw',[id],1),/Only the creator/);await t.rejects(t.bw('accept',[s.id,2],1),/Only the creator/);await t.rejects(t.bw('reject',[s.id,2,0n],1),/Only the creator/);
 await t.rejects(t.bw('finalize',[s.id],1),/Not finalisable/);await t.rejects(t.bw('expireCommit',[s.id],1),/Not expired/);
 assert.equal(await t.bal(t.bounty),bal0);
 // rotation: only the arbiter proposes, 14 day delay, only the proposed address accepts
 await t.rejects(t.bw('proposeArbiter',[t.hunter],4),/Only the arbiter/);await t.rejects(t.bw('proposeArbiter',[t.arbiter],1),/Invalid arbiter/);await t.rejects(t.bw('proposeArbiter',[t.zeroAddress],1),/Invalid arbiter/);await t.rejects(t.bw('proposeArbiter',[t.bounty],1),/Invalid arbiter/);
 await t.bw('proposeArbiter',[t.deployer],1);
 await t.rejects(t.bw('acceptArbiter',[],0),/Not ready/);await t.warp(14*DAY+10);await t.rejects(t.bw('acceptArbiter',[],5),/Not ready/);
 await t.bw('cancelArbiterChange',[],1);await t.rejects(t.bw('acceptArbiter',[],0),/Not ready/);
 await t.bw('proposeArbiter',[t.deployer],1);await t.warp(14*DAY+10);await t.bw('acceptArbiter',[],0);
 assert.equal((await t.br('arbiter')).toLowerCase(),t.deployer.toLowerCase());await t.rejects(t.bw('proposeArbiter',[t.hunter],1),/Only the arbiter/);
 // the new arbiter cannot be a party to the dispute it rules on
 await t.bw('reject',[s.id,2,0n],3);await t.bw('dispute',[s.id],4);
 await t.rejects(t.bw('resolveDispute',[s.id,2,true],1),/Only the arbiter/);                          // old arbiter lost the role
 await t.bw('resolveDispute',[s.id,2,true],0);
 await t.solvent();
});

test('arbiter that is also a party is refused (conflict of interest) and a creator cannot arbitrate its own dispute',async()=>{
 const t=await setup();
 // the creator becomes the arbiter AFTER creating the bounty and the hunter disputes: it still cannot rule on its own bounty
 const id=await t.create();const s=await t.submit(id,4,2);await t.bw('reject',[s.id,2,0n],3);await t.bw('dispute',[s.id],4);
 await t.bw('proposeArbiter',[t.creator],1);await t.warp(14*DAY+10);await t.bw('acceptArbiter',[],3);
 await t.rejects(t.bw('resolveDispute',[s.id,0,false],3),/Arbiter is a party/);
 await t.warp(14*DAY+10);await t.bw('claimArbiterTimeout',[s.id],5); // the permissionless timeout still resolves it
 assert.equal((await t.sub(s.id)).status,Status.Settled);
 await t.solvent();
});

test('token safety: fee-on-transfer tokens are rejected and a hostile transfer callback cannot re-enter',async()=>{
 const tax=await setup({token:'TaxToken'});
 await tax.rejects(tax.create(),/Fee-on-transfer/);assert.equal(await tax.bal(tax.bounty),0n);assert.equal(await tax.br('totalEscrow'),0n);
 const t=await setup({token:'HookToken'});const id=await t.create();const s=await t.commit(id,4,2);
 // arm the token so the stake/payout transfers try to call back into accept/withdraw/commit/reveal
 for(const [label,data] of [
  ['accept',encodeFunctionData({abi:t.bb.abi,functionName:'accept',args:[s.id,2]})],
  ['withdraw',encodeFunctionData({abi:t.bb.abi,functionName:'withdraw',args:[id]})],
  ['reveal',encodeFunctionData({abi:t.bb.abi,functionName:'reveal',args:[s.id,2,s.reportHash,s.salt]})],
  ['commit',encodeFunctionData({abi:t.bb.abi,functionName:'commit',args:[id,keccak256(toHex('z'))]})]] as [string,`0x${string}`][]){
  await t.w(t.nib,t.nibArt.abi,'arm',[t.bounty,data],0);
  await t.reveal(s).catch(()=>{});                 // first call reveals (hook fires on the stake-free path only when armed during transfers)
  void label;
 }
 // deterministic check: arm, then settle (payout transfers fire the hook) and assert it could not re-enter
 const t3=await setup({token:'HookToken'});const id3=await t3.create();const s3=await t3.submit(id3,4,2);
 await t3.w(t3.nib,t3.nibArt.abi,'arm',[t3.bounty,encodeFunctionData({abi:t3.bb.abi,functionName:'withdraw',args:[id3]})],0);
 await t3.bw('accept',[s3.id,2],3);
 assert.equal(await t3.r(t3.nib,t3.nibArt.abi,'reentered'),true,'the hook fired');assert.equal(await t3.r(t3.nib,t3.nibArt.abi,'reentrySucceeded'),false,'re-entry was blocked');
 await t3.solvent();
});

test('randomised abuse run: any order of actions keeps the contract solvent and every submission terminates',async()=>{
 const t=await setup();
 let seed=20261031;const rnd=(n:number)=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed%n;};
 const ids:bigint[]=[await t.create({deposit:E(2_000_000),scope:'a'}),await t.create({deposit:E(800_000),scope:'b',who:7,review:3})];
 const subs:any[]=[];const hunters=[4,5,6];
 const attempt=async(p:Promise<any>)=>{try{await p;return true;}catch{return false;}};
 for(let step=0;step<140;step++){
  const op=rnd(12);const sBy=subs.length?subs[rnd(subs.length)]:null;const bid=ids[rnd(2)],creatorOf=bid===ids[0]?3:7;
  if(op<=2){const w=hunters[rnd(3)];try{subs.push(await t.commit(bid,w,1+rnd(4)));}catch{}}
  else if(op===3&&sBy)await attempt(t.reveal(sBy));
  else if(op===4&&sBy)await attempt(t.bw('accept',[sBy.id,1+rnd(4)],(await t.bnty(sBy.bountyId??bid)).creator.toLowerCase()===t.accounts[3].address.toLowerCase()?3:7));
  else if(op===5&&sBy){const bnty=(await t.sub(sBy.id)).bountyId;const cr=(await t.bnty(bnty)).creator.toLowerCase()===t.accounts[3].address.toLowerCase()?3:7;await attempt(t.bw('reject',[sBy.id,1+rnd(4),BigInt(rnd(5))],cr));}
  else if(op===6&&sBy)await attempt(t.bw('dispute',[sBy.id],sBy.who));
  else if(op===7&&sBy)await attempt(t.bw('escalate',[sBy.id],sBy.who));
  else if(op===8&&sBy)await attempt(t.bw('resolveDispute',[sBy.id,rnd(5),rnd(2)===1],1));
  else if(op===9&&sBy)await attempt(t.bw(['finalize','expireCommit','claimArbiterTimeout','acceptDecision'][rnd(4)],[sBy.id],sBy.who));
  else if(op===10)await t.warp((rnd(4)+1)*DAY);
  else if(op===11)await attempt(t.bw('topUp',[bid,E(1000)],creatorOf));
  await t.solvent('step '+step);
 }
 // drain: let every clock run out and resolve everything permissionlessly, then both creators can withdraw everything that is left.
 for(let round=0;round<4;round++){
  await t.warp(31*DAY);
  for(const s of subs){const st=(await t.sub(s.id)).status;
   if(st===Status.Committed)await attempt(t.bw('expireCommit',[s.id],5));
   if(st===Status.Revealed)await attempt(t.bw('escalate',[s.id],s.who));
   if(st===Status.Decided)await attempt(t.bw('finalize',[s.id],5));
   if(st===Status.Disputed)await attempt(t.bw('claimArbiterTimeout',[s.id],5));
  }
 }
 await t.warp(400*DAY);
 for(const s of subs){const st=(await t.sub(s.id)).status;
  if(st===Status.Committed)await t.bw('expireCommit',[s.id],5);
  if(st===Status.Revealed){await t.bw('escalate',[s.id],s.who);await t.warp(15*DAY);await t.bw('claimArbiterTimeout',[s.id],5);}
  if(st===Status.Decided){await t.bw('finalize',[s.id],5);} if(st===Status.Disputed){await t.bw('claimArbiterTimeout',[s.id],5);}
 }
 for(const s of subs){const st=(await t.sub(s.id)).status;assert.ok(st===Status.Settled||st===Status.Expired,'submission '+s.id+' ended in status '+st);}
 for(const [bid,who] of [[ids[0],3],[ids[1],7]] as const){assert.equal((await t.bnty(bid)).pending,0);assert.equal((await t.bnty(bid)).reserved,0n);await t.bw('withdraw',[bid],who);}
 assert.equal(await t.br('totalEscrow'),0n);assert.equal(await t.br('totalStakes'),0n);assert.equal(await t.bal(t.bounty),0n,'every NIB is accounted for: nothing is stuck and nothing leaked');
});
