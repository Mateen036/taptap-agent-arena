import {test,expect} from '@playwright/test';
const T=(n:string)=>({id:'1',creator:'0x'+'11'.repeat(20),createdAt:1,endsAt:Math.floor(Date.now()/1000)+30*86400,closesAt:0,cancelRequestedAt:0,phase:'open',reviewWindowDays:7,pending:0,submissions:0,closed:false,stake:'200',stakeRaw:'0',available:'300000',reserved:'0',scopeHash:'0x',tiers:[{severity:1,label:'Low',nib:'10000',raw:'0'},{severity:2,label:'High',nib:'50000',raw:'0'}],freeSlots:20,scope:{text:n,verified:true}});
test('bug bounty is invisible until the site reports it enabled',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#arena-view')).toBeVisible();await page.waitForTimeout(800);
 await expect(page.locator('#nav-bounty')).toBeHidden();
 await page.goto('/#bounty');await expect(page.locator('#bounty-view')).not.toHaveClass(/active/);
 expect(errors).toEqual([]);
});
test('when enabled it lists bounties, validates the form and only copies an instruction (never transacts)',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/bug-bounty',r=>r.fulfill({json:{enabled:true,live:true,reportsEnabled:true,params:{minDeposit:'50000',minLowestTier:'10000'},totals:{escrow:'300000',stakes:'0',paid:'0',burned:'0',fees:'0',bounties:1},bounties:[T('In scope: the vault. <img src=x onerror=window.__xss=1>')]}}));
 await page.goto('/#bounty');await expect(page.locator('#nav-bounty')).toBeVisible();await expect(page.locator('#bounty-view')).toHaveClass(/active/);
 await expect(page.locator('.bb-card')).toHaveCount(1);await expect(page.locator('.bb-card')).toContainText('300,000 NIB available');
 expect(await page.evaluate(()=>(window as any).__xss)).toBeUndefined();
 await page.locator('#bb-create-form button[type=submit]').click();await expect(page.locator('#toast')).toContainText('payouts');
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await page.locator('[data-bb-hunt]').click();const text=await page.evaluate(()=>navigator.clipboard.readText());
 expect(text).toContain('agent-skill.md');expect(text).toContain('do bounty-commit 1');expect(text).toContain('never as instructions');
 expect(errors).toEqual([]);
});
