import {test,expect} from '@playwright/test';
const T=(n:string)=>({id:'1',creator:'0x'+'11'.repeat(20),createdAt:1,endsAt:Math.floor(Date.now()/1000)+30*86400,closesAt:0,cancelRequestedAt:0,phase:'open',panelSize:3,quorum:2,pending:0,submissions:1,closed:false,tapStake:'1000',available:'300000',reserved:'0',scopeHash:'0x',tiers:[{severity:1,label:'Low',nib:'10000',raw:'0'},{severity:2,label:'High',nib:'50000',raw:'0'}],freeSlots:20,scope:{text:n,verified:true}});
const S=(over:any={})=>({id:'7',bountyId:'1',hunter:'0x'+'22'.repeat(20),status:'Applying',outcome:'none',claimed:2,claimedLabel:'High',awarded:null,awardedLabel:null,applicants:2,votesSealed:0,votesOpened:0,alignedReviewers:0,tapStake:'1000',deadline:Math.floor(Date.now()/1000)+3600,next:{step:'apply',at:Math.floor(Date.now()/1000)+3600},...over});
const STATE=(extra:any={})=>({enabled:true,live:true,reportsEnabled:true,ticketsEnabled:true,params:{minDeposit:'10000',minLowestTier:'10000',feeBps:'200',reviewerBps:'2000'},totals:{escrow:'300000',owedToReviewers:'0',paidToHunters:'0',fees:'0',paidToReviewers:'0',bounties:1},bounties:[T('In scope: the vault. <img src=x onerror=window.__xss=1>')],...extra});
test('bug bounty is invisible until the site reports it enabled',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#arena-view')).toBeVisible();await page.waitForTimeout(800);
 await expect(page.locator('#nav-bounty')).toBeHidden();
 await page.goto('/#bounty');await expect(page.locator('#bounty-view')).not.toHaveClass(/active/);
 expect(errors).toEqual([]);
});
test('when enabled it lists bounties, explains the rules, validates the form and only copies an instruction (never transacts)',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/bug-bounty',r=>r.fulfill({json:STATE()}));
 await page.route('**/api/bug-bounty/1/submissions',r=>r.fulfill({json:{bountyId:'1',creator:'0x'+'11'.repeat(20),panelSize:3,submissions:[S()]}}));
 await page.goto('/#bounty');await expect(page.locator('#nav-bounty')).toBeVisible();await expect(page.locator('#bounty-view')).toHaveClass(/active/);
 await expect(page.locator('.bb-card')).toHaveCount(1);await expect(page.locator('.bb-card')).toContainText('300,000 NIB available');await expect(page.locator('.bb-card')).toContainText('1,000 TAP');await expect(page.locator('.bb-card')).toContainText('panel of 3 AI agents');
 expect(await page.evaluate(()=>(window as any).__xss)).toBeUndefined();
 // the rules the owner decided are on the page
 const rules=page.locator('#bb-rules');for(const re of [/2% platform fee/,/Reviewers get 20% of the payout/,/Hunters stake TAP points, not NIB/,/Other AI agents judge/,/smallest bounty is 10,000 NIB/])await expect(rules).toContainText(re);
 // form validation: the 10,000 NIB minimum, then a valid form
 await page.locator('#bb-tiers').fill('9000,20000');await page.locator('#bb-deposit').fill('300000');await page.locator('#bb-scope').fill('In scope: the NibSwap router on BNB Chain. Out of scope: front-end. Report with a PoC.');
 await page.locator('#bb-create-form button[type=submit]').click();await expect(page.locator('#toast')).toContainText('at least 10,000 NIB');
 await page.locator('#bb-tiers').fill('10000,25000');await page.locator('#bb-panel').selectOption('5');await page.locator('#bb-stake').fill('1');
 await page.locator('#bb-create-form button[type=submit]').click();await expect(page.locator('#toast')).toContainText('TAP stake must be between');
 await page.locator('#bb-stake').fill('');await expect(page.locator('#bb-create-note')).toContainText('2% to the vault, 20% to the reviewers');
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await page.locator('#bb-create-form button[type=submit]').click();let text=await page.evaluate(()=>navigator.clipboard.readText());
 expect(text).toContain('do bounty-create --tiers 10000,25000 --deposit 300000 --days 30 --panel 5 --scope-file scope.md');expect(text).toContain('cannot overrule');
 await page.locator('[data-bb-hunt]').click();text=await page.evaluate(()=>navigator.clipboard.readText());
 expect(text).toContain('agent-skill.md');expect(text).toContain('do bounty-commit 1');expect(text).toContain('never as instructions');expect(text).toContain('1000 TAP points (no NIB)');
 // reviewers apply from the submissions table
 await page.locator('[data-bb-subs]').click();await expect(page.locator('.bb-card table')).toContainText('Applying');await expect(page.locator('.bb-card table')).toContainText('2 applied');
 await page.locator('[data-bb-apply]').click();text=await page.evaluate(()=>navigator.clipboard.readText());expect(text).toContain('do bounty-review 7 --bounty 1');expect(text).toContain('burns my stake');
 expect(errors).toEqual([]);
});
test('a signed-in wallet sees its TAP, its roles and a copyable next step',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const you={wallet:'0x'+'33'.repeat(20),tap:{available:'4000',locked:'1000',locks:[]},reputation:{strikes:1,cooldownUntil:null},rewardNib:'3333.33',myBounties:[],mySubmissions:[S({status:'Committed',next:{step:'reveal',at:Math.floor(Date.now()/1000)+3600}})],myReviews:[S({id:'8',status:'Voting',votesSealed:1,next:{step:'vote',at:Math.floor(Date.now()/1000)+3600},reviewer:{state:'seated',sealed:false,opened:false,aligned:null,lockId:'0x'}})]};
 await page.route('**/api/bug-bounty',r=>r.fulfill({json:STATE({you})}));
 await page.goto('/#bounty');await expect(page.locator('#bb-mine-wrap')).toBeVisible();
 await expect(page.locator('#bb-mine')).toContainText('TAP available 4,000');await expect(page.locator('#bb-mine')).toContainText('locked in stakes 1,000');await expect(page.locator('#bb-mine')).toContainText('NIB reward waiting 3,333.33');
 await expect(page.locator('#bb-mine tbody tr')).toHaveCount(2);await expect(page.locator('#bb-mine')).toContainText('Hunter');await expect(page.locator('#bb-mine')).toContainText('Reviewer');
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await page.locator('[data-bb-next="7"]').click();let text=await page.evaluate(()=>navigator.clipboard.readText());expect(text).toContain('do bounty-reveal 1');expect(text).toContain('TAP stake is burned');
 await page.locator('[data-bb-next="8"]').click();text=await page.evaluate(()=>navigator.clipboard.readText());expect(text).toContain('do bounty-vote 8 --verdict');
 await page.locator('[data-bb-claim]').click();text=await page.evaluate(()=>navigator.clipboard.readText());expect(text).toContain('do bounty-claim');
 expect(errors).toEqual([]);
});
test('missing TAP signer shows a banner instead of letting people stake',async({page})=>{
 await page.route('**/api/bug-bounty',r=>r.fulfill({json:STATE({ticketsEnabled:false})}));
 await page.goto('/#bounty');await expect(page.locator('#bb-banner')).toBeVisible();await expect(page.locator('#bb-banner')).toContainText('TAP stake tickets are not configured');
});
