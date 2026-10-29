import {test,expect} from '@playwright/test';
const fixtureHeaders={'x-taptap-test':'local-browser-fixture'};
async function fixture(request:any,endpoint:string,body:any){const r=await request.post('/__test/'+endpoint,{headers:fixtureHeaders,data:body});expect(r.ok()).toBeTruthy();return r.json();}
test('mobile and desktop spectator pages have functional navigation and no horizontal overflow',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto('/');await expect(page.locator('#service-error')).toBeHidden();await expect(page.locator('body')).toHaveCSS('background-color','rgb(16, 17, 15)');await page.evaluate(()=>document.fonts.ready);await expect(page.locator('body')).toHaveCSS('font-family',/DM Sans/);await expect(page.locator('#rule-title')).not.toHaveText('A fresh challenge, every day.');
  for(const view of ['wars','challenges','leaderboard','profile','docs','arena']){await page.locator('.nav-item[data-view="'+view+'"]').click();await expect(page.locator('#'+view+'-view')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();}
  await page.screenshot({path:'docs/verification/'+(viewport.width<700?'mobile':'desktop')+'-season-0.png',fullPage:true,animations:'disabled'});
 }
 expect(errors).toEqual([]);
});
test('browser pairs, earns signed points, edits profile, queues a round and creates a shareable challenge',async({page,request})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('#rule-title')).not.toHaveText('A fresh challenge, every day.');
 await page.locator('.connect-button').click();await page.locator('#begin-pair').click();const prompt=await page.locator('#agent-prompt').inputValue();const code=prompt.match(/pairing code ([0-9a-f]{64})/)?.[1];expect(code).toBeTruthy();
 const p=await fixture(request,'pair',{code});await expect(page.locator('#pair-status')).toContainText('Agent paired',{timeout:15000});await page.locator('#close-modal').click();
 await page.locator('#join-season').click();let state=await fixture(request,'act',{wallet:p.wallet,action:'state'});const enrollment=state.body.competition.jobs.find((j:any)=>j.kind==='season-join');expect(enrollment).toBeTruthy();
 await fixture(request,'act',{wallet:p.wallet,action:'job-start',payload:{jobId:enrollment.id}});await fixture(request,'act',{wallet:p.wallet,action:'season-join',payload:{jobId:enrollment.id}});await fixture(request,'act',{wallet:p.wallet,action:'job-complete',payload:{jobId:enrollment.id}});
 await page.locator('#prompt').fill('Tap 100 times');await page.locator('#run-agent').click();state=await fixture(request,'act',{wallet:p.wallet,action:'state'});const command=state.body.agent.commands.find((c:any)=>c.status==='queued');expect(command.target).toBe(100);
 await fixture(request,'act',{wallet:p.wallet,action:'start',payload:{commandId:command.id}});
 for(let i=0;i<4;i++){await fixture(request,'time',{ms:5000});const tick=await fixture(request,'act',{wallet:p.wallet,action:'tap',payload:{commandId:command.id,taps:25}});expect(tick.status).toBe(200);}
 await expect(page.locator('#total-points')).toContainText('100',{timeout:15000});await expect(page.locator('#season-score')).toHaveText('100');
 await page.locator('[data-share-kind="run"]').click();await expect(page.locator('.share-preview')).toBeVisible();const image=await page.locator('.share-preview').getAttribute('src');const png=await request.get(image!);expect(png.status()).toBe(200);expect(png.headers()['content-type']).toContain('image/png');expect((await png.body()).length).toBeGreaterThan(1000);await page.locator('#close-modal').click();
 await page.locator('.nav-item[data-view="profile"]').click();await page.locator('#profile-name').fill('Nib Browser Pilot');await page.locator('#profile-bio').fill('Verified local test.');await page.locator('#profile-form button[type="submit"]').click();await expect(page.locator('.profile-banner h2')).toHaveText('Nib Browser Pilot');
 await page.locator('.nav-item[data-view="wars"]').click();await page.locator('#join-daily').click();state=await fixture(request,'act',{wallet:p.wallet,action:'state'});const daily=state.body.competition.jobs.find((j:any)=>j.kind==='daily-join');
 await fixture(request,'act',{wallet:p.wallet,action:'job-start',payload:{jobId:daily.id}});const joined=await fixture(request,'act',{wallet:p.wallet,action:'arena-join',payload:{...daily.payload,jobId:daily.id}});expect(joined.status).toBe(200);await fixture(request,'act',{wallet:p.wallet,action:'job-complete',payload:{jobId:daily.id}});
 await fixture(request,'time',{ms:5000});await fixture(request,'act',{wallet:p.wallet,action:'arena-tap',payload:{entryId:joined.body.entry.id,taps:25}});await expect(page.locator('#my-round')).toContainText('25',{timeout:15000});
 await fixture(request,'time',{ms:120000});await page.locator('.nav-item[data-view="challenges"]').click();await page.locator('#create-challenge').click();state=await fixture(request,'act',{wallet:p.wallet,action:'state'});const duel=state.body.competition.jobs.find((j:any)=>j.kind==='duel-create');
 await fixture(request,'act',{wallet:p.wallet,action:'job-start',payload:{jobId:duel.id}});const created=await fixture(request,'act',{wallet:p.wallet,action:'duel-create',payload:{...duel.payload,jobId:duel.id}});expect(created.status).toBe(200);await fixture(request,'act',{wallet:p.wallet,action:'job-complete',payload:{jobId:duel.id}});
 await page.goto('/matches/'+created.body.match.id);await expect(page.locator('#public-match')).toContainText('Nib Browser Pilot');await expect(page.locator('#public-match')).toContainText('Your next rival');
 await page.goto('/agents/'+p.wallet);await expect(page.locator('.profile-banner h2')).toHaveText('Nib Browser Pilot');await expect(page.locator('#public-profile')).toContainText('100');expect(errors).toEqual([]);
});
