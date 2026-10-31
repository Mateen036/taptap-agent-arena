'use strict';
(()=>{
 let status=null,loading=false,busy=false,bonusBusy=false,bonusConvBusy=false,last=0,timer=null,amount='',bonusAmount='';
 const maxPts=u=>u.convertible;
 const bonusOnly=x=>!!x&&x.bonusPoints&&x.bonusPoints!=='0'&&x.bonusPoints===x.points;
 const mixed=x=>!!x&&x.bonusPoints&&x.bonusPoints!=='0'&&x.bonusPoints!==x.points;
 const active=()=>viewName==='convert';
 const nib=wei=>{try{const v=BigInt(wei||0),whole=v/10n**18n,frac=(v%10n**18n).toString().padStart(18,'0').slice(0,4).replace(/0+$/,'');return whole.toLocaleString('en-US')+(frac?'.'+frac:'');}catch{return '0';}};
 const link=(a,label)=>`<a class="text-button" href="https://bscscan.com/address/${encodeURIComponent(a)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
 const countdown=ms=>{const s=Math.max(0,Math.floor((ms-Date.now())/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
 const agentPrompt=p=>`Claim my NIB airdrop conversion. Use my Binance Agentic Wallet (baw) on BNB Chain. Run exactly this preview, show me the parsed transaction and risks, and execute it only after I approve. It must finish before ${new Date(p.expiresAt).toISOString()}:\n\n${p.baw}\n\nThe call goes to the NIB airdrop contract ${p.transaction.to} with 0 BNB. Do not retry an uncertain execution; check the transaction hash first.`;
 async function refreshConvert(force=false){
  if(loading||(!force&&Date.now()-last<(status?.user?.pending?10000:30000)))return;loading=true;
  try{status=await api('airdrop');last=Date.now();render();}catch(e){const el=$('#convert-body');if(el&&!status)el.innerHTML=empty(e.message);}finally{loading=false;}
 }
 function pendingBlock(p){
  const claim=JSON.stringify({voucher:p.voucher,signature:p.signature},null,2);
  return `<div class="notice" role="status"><strong>Voucher ready: ${esc(fmt(p.points))} TAP → claim before <span id="convert-clock">${esc(countdown(p.expiresAt))}</span></strong>${mixed(p)?`<p class="tiny muted">${esc(fmt(p.normalPoints))} normal TAP + ${esc(fmt(p.bonusPoints))} NFT bonus TAP.</p>`:''}<p>Your agent must submit the claim from its wallet within 15 minutes. If it expires unclaimed, your TAP is returned automatically.</p></div>
  <button class="button primary full" id="convert-copy-prompt">Copy instruction for my agent ↗</button>
  <details><summary>Voucher and calldata (for agents)</summary><label class="tiny muted">Contract call</label><textarea class="pair-prompt" readonly aria-label="Claim transaction">${esc(JSON.stringify(p.transaction,null,2))}</textarea><label class="tiny muted">Signed voucher</label><textarea class="pair-prompt" readonly aria-label="Signed voucher">${esc(claim)}</textarea></details>`;
 }
 function render(){
  const root=$('#convert-body');if(!root||!status)return;
  const s=status.season,u=status.user,open=status.open;
  $('#convert-pool').innerHTML=open?esc(nib(s.remaining))+' <small>NIB</small>':'—';
  $('#convert-pool-caption').textContent=open?'of '+nib(s.pool)+' NIB · Season '+s.season+' · first come, first served':status.message;
  $('#convert-rate').innerHTML=open?esc(fmt(s.pointsPerNib))+' <small>TAP = 1 NIB</small>':'10 <small>TAP = 1 NIB</small>';
  $('#convert-mine').innerHTML=u?esc(fmt((BigInt(u.balance||0)+BigInt(u.bonusBalance||0)).toString()))+' <small>TAP</small>':'—';
  $('#convert-mine-caption').textContent=u?(open&&u.convertible&&u.convertible!=='0'?'≈ '+nib((BigInt(u.convertible)*10n**18n/BigInt(s.pointsPerNib||10)).toString())+' NIB at the current rate':'Your TAP balance'):'Connect your agent to see your balance';
  if(!u){root.innerHTML=`<p>${esc(status.message)}</p><button class="button primary" id="convert-connect">Connect agent</button>`;renderBonus();return;}
  const pending=u.pending,normalPending=pending;
  let html='';
  if(!open)html+=`<div class="notice" role="status">${esc(status.message)}</div>`;
  else if(!u.canConvert)html+=`<div class="notice error" role="status">${esc(u.access?.status==='nft_required'?'Hold at least one Nib NFT to convert TAP.':u.access?.status==='identity_required'?'This wallet must hold a Binance Agent ID to convert.':u.access?.status==='unavailable'?'Could not verify this wallet on BNB Chain just now. Retrying automatically…':'Conversion is not available for this wallet right now.')}</div>`;
  if(normalPending)html+=pendingBlock(normalPending);
  else if(pending)html+=`<div class="notice" role="status">An NFT bonus voucher is waiting in the NFT Bonus section below. Only one voucher per season can be pending, so claim it or let it expire first.</div>`;
  else if(open&&u.canConvert){
   html+=`<form id="convert-form" class="convert-form"><label for="convert-amount">TAP to convert</label><div class="convert-row"><input id="convert-amount" inputmode="numeric" autocomplete="off" placeholder="${esc(fmt(maxPts(u)))}" value="${esc(amount)}" aria-describedby="convert-estimate"><button type="button" class="button secondary" id="convert-max">Max</button></div><p id="convert-estimate" class="tiny muted"></p><button class="button primary full" id="convert-submit" ${busy?'disabled':''}>Get claim voucher</button></form>`;
  }
  html+=`<p class="tiny muted">Contracts: ${link(status.airdrop,'Airdrop '+short(status.airdrop))} · ${link(status.token,'NIB '+short(status.token))}. TAP is deducted when the voucher is issued and returned if it expires or the pool runs short.</p>`;
  const nh=u.history||[];
  if(nh.length)html+=`<h3>Recent conversions</h3><div class="table">${nh.map(h=>`<div class="row"><span>Season ${esc(h.season)}</span><span>${esc(fmt(h.points))} TAP</span><span>${esc(h.status)}${h.status==='settled'&&h.refundPoints&&h.refundPoints!=='0'?' · '+esc(fmt(h.refundPoints))+' TAP refunded':''}${h.status==='released'?' · TAP returned':''}</span></div>`).join('')}</div>`;
  root.innerHTML=html;
  estimate();
  renderBonus();
  if(normalPending)$('#convert-copy-prompt').onclick=()=>copy(agentPrompt(normalPending),'Instruction copied. Paste it to your agent.');
 }

 function renderBonus(){
  const root=$('#convert-bonus-body');if(!root||!status)return;
  const b=status.nftBonus,u=status.user,s=status.season;
  if(!b||b.error||(b.error===undefined&&!b.pointsPerNft)){root.innerHTML='<p class="tiny muted">'+esc(b?.error||'The NFT bonus is not available right now.')+'</p>';return;}
  const per=nib(b.nibPerNft)+' NIB',rate=BigInt(s?.pointsPerNib||10),mine=b.user;
  let html=`<p><b>${esc(per)} per Nib NFT</b>, claimable once per NFT, ever (even if it is sold). ${esc(b.message)}</p>`;
  if(!u||!mine){html+=`<p class="tiny muted">Connect your agent to see your NFTs and bonus balance.</p><button class="button primary" id="convert-connect">Connect agent</button>`;}
  else{
   const owned=mine.owned.length,claimed=mine.owned.filter(x=>x.claimed).length;
   html+=`<h3>1. Claim the bonus</h3><p>${owned?`You hold <b>${owned}</b> Nib NFT${owned===1?'':'s'}: <b>${claimed}</b> already claimed, <b>${mine.unclaimedCount}</b> unclaimed.`:'You do not hold a Nib NFT in your agent wallet.'}${mine.truncated?' Showing the first 200 only.':''}</p>`;
   if(owned)html+='<p class="tiny muted">'+mine.owned.map(x=>`#${esc(x.tokenId)} ${x.claimed?'claimed':'unclaimed'}`).join(' · ')+'</p>';
   const can=b.available&&mine.claimableNow>0;
   html+=`<button class="button primary full" id="convert-bonus" ${can&&!bonusBusy?'':'disabled'}>${can?`Claim NFT bonus · ${nib((BigInt(b.nibPerNft)*BigInt(mine.claimableNow)).toString())} NIB`:'Claim NFT bonus'}</button>`;
   const bal=BigInt(u.bonusBalance||0),pending=u.pending;
   html+=`<h3>2. Convert the bonus to NIB</h3>`;
   if(u.bonusForfeited)html+=`<div class="notice error" role="status"><strong>Your ${esc(fmt(u.bonusBalance))} bonus TAP is forfeited.</strong><p>NFT bonus TAP converts in airdrop season 1 only. Season 1 has ended, so it can no longer be converted.</p></div>`;
   else html+=`<p><b>NFT bonus balance: ${esc(fmt(u.bonusBalance))} TAP</b>${bal>0n?` (≈ ${esc(nib((bal*10n**18n/rate).toString()))} NIB)`:''}. It is separate from your normal TAP, not spendable in-game and not counted in rankings.</p>`;
   if(pending&&bonusOnly(pending))html+=pendingBlock(pending);
   else if(pending)html+=`<div class="notice" role="status">A normal conversion voucher is pending in the section above. Only one voucher per season can be pending, so claim it or let it expire first.</div>`;
   else if(!u.bonusForfeited&&bal>0n&&u.bonusConvertible!=='0'&&status.open&&u.canConvert)html+=`<form id="bonus-form" class="convert-form"><label for="bonus-amount">Bonus TAP to convert</label><div class="convert-row"><input id="bonus-amount" inputmode="numeric" autocomplete="off" placeholder="${esc(fmt(u.bonusConvertible))}" value="${esc(bonusAmount)}" aria-describedby="bonus-estimate"><button type="button" class="button secondary" id="bonus-max">Max</button></div><p id="bonus-estimate" class="tiny muted"></p><button class="button primary full" id="bonus-submit" ${bonusConvBusy?'disabled':''}>Convert NFT bonus to NIB</button></form>`;
   else if(!u.bonusForfeited)html+=`<p class="tiny muted">${bal>0n?(u.canConvert?'Bonus TAP can be converted only while airdrop season 1 is open.':'Conversion is not available for this wallet right now.'):'Claim the bonus first, then convert it here.'}</p>`;
   const bh=(u.history||[]).filter(h=>h.bonusPoints&&h.bonusPoints!=='0');
   if(bh.length)html+=`<h3>Bonus conversions</h3><div class="table">${bh.map(h=>`<div class="row"><span>Season ${esc(h.season)}</span><span>${esc(fmt(h.points))} TAP${h.bonusPoints!==h.points?' ('+esc(fmt(h.bonusPoints))+' bonus)':''}</span><span>${esc(h.status)}${h.status==='settled'&&h.refundPoints&&h.refundPoints!=='0'?' · '+esc(fmt(h.refundPoints))+' TAP refunded':''}${h.status==='released'?' · TAP returned':''}</span></div>`).join('')}</div>`;
  }
  html+=`<p class="tiny muted"><b>Season 1 only.</b> NFT bonus TAP converts to NIB only while airdrop season 1 is open and is forfeited afterwards (it never carries into seasons 2 to 5). It is not spendable in-game and does not count toward rankings. Unpaid points from an expired voucher return to your bonus balance.</p>`;
  const rv=status.reservedForBonus;if(rv?.enforced)html+=`<p class="tiny muted">Reserved for NFT bonus holders: ${esc(nib(rv.nib))} NIB credited but not yet converted. While season 1 is open, normal conversions cannot dip into it; bonus conversions can use it.</p>`;
  html+=`<p class="tiny muted">Bonus pool left: ${esc(nib(b.remainingNib))} of ${esc(nib(b.capNib))} NIB.</p>`;
  root.innerHTML=html;
  bonusEstimate();
  const bp=u?.pending;if(bp&&bonusOnly(bp)){const el=$('#convert-copy-prompt');if(el)el.onclick=()=>copy(agentPrompt(bp),'Instruction copied. Paste it to your agent.');}
 }
 async function claimBonus(){
  if(bonusBusy)return;bonusBusy=true;renderBonus();
  try{const r=await api('airdrop/nft-bonus',{});toast('Bonus credited: '+fmt(r.pointsCredited)+' bonus TAP (season 1 conversion only).');await refreshConvert(true);try{await window.refresh();}catch{}}
  catch(err){toast(err.message);}finally{bonusBusy=false;renderBonus();}
 }
 function estimate(){
  const input=$('#convert-amount'),out=$('#convert-estimate');if(!input||!out||!status?.user)return;
  amount=input.value.replace(/[^0-9]/g,'');if(input.value!==amount)input.value=amount;
  const rate=BigInt(status.season?.pointsPerNib||10),n=BigInt(amount||maxPts(status.user)||0);
  out.textContent=n<rate?'Minimum '+rate+' TAP (1 NIB).':'You receive about '+nib(n*10n**18n/rate)+' NIB.';
 }
 function bonusEstimate(){
  const input=$('#bonus-amount'),out=$('#bonus-estimate');if(!input||!out||!status?.user)return;
  bonusAmount=input.value.replace(/[^0-9]/g,'');if(input.value!==bonusAmount)input.value=bonusAmount;
  const rate=BigInt(status.season?.pointsPerNib||10),n=BigInt(bonusAmount||status.user.bonusConvertible||0);
  out.textContent=n<rate?'Minimum '+rate+' TAP (1 NIB).':'You receive about '+nib(n*10n**18n/rate)+' NIB.';
 }
 async function submit(e){
  e.preventDefault();if(busy)return;busy=true;$('#convert-submit').disabled=true;
  try{const body={...(amount?{points:amount}:{})};await api('airdrop/voucher',body);amount='';toast('Voucher issued. Hand it to your agent.');await refreshConvert(true);try{await window.refresh();}catch{}}
  catch(err){toast(err.message);}finally{busy=false;render();}
 }
 async function submitBonus(e){
  e.preventDefault();if(bonusConvBusy)return;bonusConvBusy=true;$('#bonus-submit').disabled=true;
  try{const body={source:'bonus',...(bonusAmount?{points:bonusAmount}:{})};await api('airdrop/voucher',body);bonusAmount='';toast('Bonus voucher issued. Hand it to your agent.');await refreshConvert(true);try{await window.refresh();}catch{}}
  catch(err){toast(err.message);}finally{bonusConvBusy=false;renderBonus();}
 }
 document.addEventListener('input',e=>{if(e.target.id==='convert-amount')estimate();if(e.target.id==='bonus-amount')bonusEstimate();});
 document.addEventListener('submit',e=>{if(e.target.id==='convert-form')submit(e);if(e.target.id==='bonus-form')submitBonus(e);});
 document.addEventListener('click',e=>{if(e.target.closest('#convert-bonus'))claimBonus();if(e.target.closest('#convert-connect')&&typeof connect==='function')connect();if(e.target.closest('#convert-max')&&status?.user){amount=String(maxPts(status.user));$('#convert-amount').value=amount;estimate();}if(e.target.closest('#bonus-max')&&status?.user){bonusAmount=String(status.user.bonusConvertible);$('#bonus-amount').value=bonusAmount;bonusEstimate();}});
 window.addEventListener('taptap:view',()=>{if(active()){refreshConvert(true);if(!timer)timer=setInterval(()=>{if(active()&&!document.hidden){refreshConvert();const c=$('#convert-clock');if(c&&status?.user?.pending)c.textContent=countdown(status.user.pending.expiresAt);}},1000);}});
 window.addEventListener('taptap:state',()=>{if(active())refreshConvert(false);});
 if(active())refreshConvert(true);
})();
