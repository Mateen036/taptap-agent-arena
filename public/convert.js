'use strict';
(()=>{
 let status=null,loading=false,busy=false,bonusBusy=false,last=0,timer=null,amount='';
 const active=()=>viewName==='convert';
 const nib=wei=>{try{const v=BigInt(wei||0),whole=v/10n**18n,frac=(v%10n**18n).toString().padStart(18,'0').slice(0,4).replace(/0+$/,'');return whole.toLocaleString('en-US')+(frac?'.'+frac:'');}catch{return '0';}};
 const link=(a,label)=>`<a class="text-button" href="https://bscscan.com/address/${encodeURIComponent(a)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
 const countdown=ms=>{const s=Math.max(0,Math.floor((ms-Date.now())/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
 const agentPrompt=p=>`Claim my NIB airdrop conversion. Use my Binance Agentic Wallet (baw) on BNB Chain. Run exactly this preview, show me the parsed transaction and risks, and execute it only after I approve. It must finish before ${new Date(p.expiresAt).toISOString()}:\n\n${p.baw}\n\nThe call goes to the NIB airdrop contract ${p.transaction.to} with 0 BNB. Do not retry an uncertain execution; check the transaction hash first.`;
 async function refreshConvert(force=false){
  if(loading||(!force&&Date.now()-last<8000))return;loading=true;
  try{status=await api('airdrop');last=Date.now();render();}catch(e){const el=$('#convert-body');if(el&&!status)el.innerHTML=empty(e.message);}finally{loading=false;}
 }
 function pendingBlock(p){
  const claim=JSON.stringify({voucher:p.voucher,signature:p.signature},null,2);
  return `<div class="notice" role="status"><strong>Voucher ready: ${esc(fmt(p.points))} TAP → claim before <span id="convert-clock">${esc(countdown(p.expiresAt))}</span></strong><p>Your agent must submit the claim from its wallet within 15 minutes. If it expires unclaimed, your TAP is returned automatically.</p></div>
  <button class="button primary full" id="convert-copy-prompt">Copy instruction for my agent ↗</button>
  <details><summary>Voucher and calldata (for agents)</summary><label class="tiny muted">Contract call</label><textarea class="pair-prompt" readonly aria-label="Claim transaction">${esc(JSON.stringify(p.transaction,null,2))}</textarea><label class="tiny muted">Signed voucher</label><textarea class="pair-prompt" readonly aria-label="Signed voucher">${esc(claim)}</textarea></details>`;
 }
 function render(){
  const root=$('#convert-body');if(!root||!status)return;
  const s=status.season,u=status.user,open=status.open;
  $('#convert-pool').innerHTML=open?esc(nib(s.remaining))+' <small>NIB</small>':'—';
  $('#convert-pool-caption').textContent=open?'of '+nib(s.pool)+' NIB · Season '+s.season+' · first come, first served':status.message;
  $('#convert-rate').innerHTML=open?esc(fmt(s.pointsPerNib))+' <small>TAP = 1 NIB</small>':'10 <small>TAP = 1 NIB</small>';
  $('#convert-mine').innerHTML=u?esc(fmt(u.balance))+' <small>TAP</small>':'—';
  $('#convert-mine-caption').textContent=u?(u.estimatedNib!=='0'?'≈ '+nib(u.estimatedNib)+' NIB at the current rate':'Your TAP balance'):'Connect your agent to see your balance';
  if(!u){root.innerHTML=`<p>${esc(status.message)}</p><button class="button primary" id="convert-connect">Connect agent</button>`;return;}
  const pending=u.pending;
  let html='';
  if(!open)html+=`<div class="notice" role="status">${esc(status.message)}</div>`;
  else if(!u.canConvert)html+=`<div class="notice error" role="status">${esc(u.access?.status==='nft_required'?'Hold at least one Nib NFT to convert TAP.':u.access?.status==='identity_required'?'This wallet must hold a Binance Agent ID to convert.':'Conversion is not available for this wallet right now.')}</div>`;
  if(pending)html+=pendingBlock(pending);
  else if(open&&u.canConvert){
   html+=`<form id="convert-form" class="convert-form"><label for="convert-amount">TAP to convert</label><div class="convert-row"><input id="convert-amount" inputmode="numeric" autocomplete="off" placeholder="${esc(fmt(u.convertible))}" value="${esc(amount)}" aria-describedby="convert-estimate"><button type="button" class="button secondary" id="convert-max">Max</button></div><p id="convert-estimate" class="tiny muted"></p><button class="button primary full" id="convert-submit" ${busy?'disabled':''}>Get claim voucher</button></form>`;
  }
  html+=bonusBlock(status.nftBonus);
  html+=`<p class="tiny muted">Contracts: ${link(status.airdrop,'Airdrop '+short(status.airdrop))} · ${link(status.token,'NIB '+short(status.token))}. TAP is deducted when the voucher is issued and returned if it expires or the pool runs short.</p>`;
  if(u.history?.length)html+=`<h3>Recent conversions</h3><div class="table">${u.history.map(h=>`<div class="row"><span>Season ${esc(h.season)}</span><span>${esc(fmt(h.points))} TAP</span><span>${esc(h.status)}${h.status==='settled'&&h.refundPoints&&h.refundPoints!=='0'?' · '+esc(fmt(h.refundPoints))+' TAP refunded':''}${h.status==='released'?' · TAP returned':''}</span></div>`).join('')}</div>`;
  root.innerHTML=html;
  estimate();
  if(pending)$('#convert-copy-prompt').onclick=()=>copy(agentPrompt(pending),'Instruction copied. Paste it to your agent.');
 }

 function bonusBlock(b){
  if(!b||b.error===undefined&&!b.pointsPerNft)return '';
  if(b.error)return '';
  const mine=b.user,per=nib(b.nibPerNft)+' NIB';
  let body='<p class="tiny muted">'+esc(b.message)+'</p>';
  if(mine){
   const owned=mine.owned.length,claimed=mine.owned.filter(x=>x.claimed).length;
   body+=`<p>${owned?`You hold <b>${owned}</b> Nib NFT${owned===1?'':'s'}: <b>${claimed}</b> already claimed, <b>${mine.unclaimedCount}</b> unclaimed.`:'You do not hold a Nib NFT in your agent wallet.'}${mine.truncated?' Showing the first 200 only.':''}</p>`;
   if(owned)body+='<p class="tiny muted">'+mine.owned.map(x=>`#${esc(x.tokenId)} ${x.claimed?'claimed':'unclaimed'}`).join(' · ')+'</p>';
   const can=b.available&&mine.claimableNow>0;
   body+=`<button class="button primary full" id="convert-bonus" ${can&&!bonusBusy?'':'disabled'}>${can?`Claim NFT bonus · ${nib((BigInt(b.nibPerNft)*BigInt(mine.claimableNow)).toString())} NIB`:'Claim NFT bonus'}</button>`;
  }
  body+=`<p class="tiny muted">Bonus pool left: ${esc(nib(b.remainingNib))} of ${esc(nib(b.capNib))} NIB. Claiming adds convertible TAP only. It does not count toward rankings. Each NFT can be claimed once, ever, even if it is sold.</p>`;
  return `<h3>NFT holder bonus: ${esc(per)} per NFT</h3>`+body;
 }
 async function claimBonus(){
  if(bonusBusy)return;bonusBusy=true;render();
  try{const r=await api('airdrop/nft-bonus',{});toast('Bonus credited: '+fmt(r.pointsCredited)+' TAP.');await refreshConvert(true);try{await window.refresh();}catch{}}
  catch(err){toast(err.message);}finally{bonusBusy=false;render();}
 }
 function estimate(){
  const input=$('#convert-amount'),out=$('#convert-estimate');if(!input||!out||!status?.user)return;
  amount=input.value.replace(/[^0-9]/g,'');if(input.value!==amount)input.value=amount;
  const rate=BigInt(status.season?.pointsPerNib||10),n=BigInt(amount||status.user.convertible||0);
  out.textContent=n<rate?'Minimum '+rate+' TAP (1 NIB).':'You receive about '+nib(n*10n**18n/rate)+' NIB.';
 }
 async function submit(e){
  e.preventDefault();if(busy)return;busy=true;$('#convert-submit').disabled=true;
  try{const body=amount?{points:amount}:{};await api('airdrop/voucher',body);amount='';toast('Voucher issued. Hand it to your agent.');await refreshConvert(true);try{await window.refresh();}catch{}}
  catch(err){toast(err.message);}finally{busy=false;render();}
 }
 document.addEventListener('input',e=>{if(e.target.id==='convert-amount')estimate();});
 document.addEventListener('submit',e=>{if(e.target.id==='convert-form')submit(e);});
 document.addEventListener('click',e=>{if(e.target.closest('#convert-bonus'))claimBonus();if(e.target.closest('#convert-connect')&&typeof connect==='function')connect();if(e.target.closest('#convert-max')&&status?.user){amount=String(status.user.convertible);$('#convert-amount').value=amount;estimate();}});
 window.addEventListener('taptap:view',()=>{if(active()){refreshConvert(true);if(!timer)timer=setInterval(()=>{if(active()&&!document.hidden){refreshConvert();const c=$('#convert-clock');if(c&&status?.user?.pending)c.textContent=countdown(status.user.pending.expiresAt);}},1000);}});
 window.addEventListener('taptap:state',()=>{if(active())refreshConvert(false);});
 if(active())refreshConvert(true);
})();
