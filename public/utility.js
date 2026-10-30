'use strict';
(()=>{
 const access=()=>agent?.gameAccess||data?.gameAccess;
 window.taptapUtilityBlocked=()=>!!access()?.required&&!access().canPlay;
 function exactDialog(title,value,note){modal(title,`<p>${esc(note)}</p><textarea class="pair-prompt exact-amount" readonly aria-label="Exact decimal value">${esc(value)}</textarea><button class="button secondary full" id="copy-exact-amount">Copy exact value ↗</button>`);$('#copy-exact-amount').onclick=()=>copy(String(value),'Exact value copied.');}
 function calculate(){
  const input=$('#utility-count');if(!input)return;
  const n=Number(input.value),valid=Number.isSafeInteger(n)&&n>=0&&n<=10000;
  if(!valid){$('#utility-factor').textContent='—';$('#utility-example').textContent='Enter whole NFTs from 0 to 10,000.';$('#utility-exact').disabled=true;return;}
  const factor=5n*BigInt(n);$('#utility-factor').textContent=fmt(factor)+'×';
  $('#utility-example').textContent=n===0?'No gameplay access':'100 base TAP → '+fmt(100n*factor)+' earned TAP';
  $('#utility-exact').disabled=false;$$('[data-utility-count]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.utilityCount)===n)));
 }
 function renderAccess(){
  const a=access(),banner=$('#utility-access');if(!banner)return;
  banner.hidden=!a?.required;
  const label=$('#utility-launch-label');if(label)label.textContent=a?.required?'UTILITY LIVE':'UTILITY AT LAUNCH';
  if(!a?.required)return;
  const locked=!a.canPlay;
  banner.classList.toggle('unlocked',!locked);
  const unavailable=a.status==='unavailable',identity=a.status==='identity_required';
  const title=!locked?`${fmt(a.owned)} Nib${a.owned===1?'':'s'} · ${fmt(a.multiplier)}× earned TAP`:unavailable?'Ownership check unavailable':identity?'Binance Agent ID required':connected()?'Your agent needs a Nib pass.':'A Nib is your agent’s pass.';
  const detail=!locked?'New earnings use your current holdings. Competitive scores stay on base points.':unavailable?'Gameplay pauses until holdings can be verified. Your points are preserved.':identity?'This wallet must currently hold an eligible Agent ID as well as a Nib NFT.':'Hold at least one Nib in your eligible agent wallet to play. First mint is free + BNB gas.';
  const key=JSON.stringify([a.status,a.owned,a.multiplier,connected()]);
  if(banner.dataset.accessKey!==key){banner.dataset.accessKey=key;banner.innerHTML=`<span class="utility-symbol" aria-hidden="true">${locked?'◈':'ϟ'}</span><div><strong>${esc(title)}</strong><p>${esc(detail)}</p>${a.block?`<small aria-live="off" data-utility-block>Checked at BNB Chain block ${esc(a.block)}</small>`:''}</div><button class="button ${locked?'primary':'secondary'}" ${unavailable?'data-utility-retry':!connected()?'data-connect':'data-go="mint"'}>${unavailable?'Retry check ↗':!connected()?'Connect agent ↗':locked?'Mint your pass ↗':'Manage Nibs ↗'}</button>`;}
  const block=banner.querySelector('[data-utility-block]');if(block)block.textContent='Checked at BNB Chain block '+a.block;
  if(locked){$$('#run-agent,#join-season,#join-daily,#create-challenge,[data-upgrade],[data-claim],[data-accept],[data-rematch]').forEach(b=>{b.disabled=true;b.title='Hold a Nib NFT in an eligible Agent ID wallet to play.';});$('#command-note').textContent=unavailable?'Waiting for an on-chain ownership check.':identity?'Your wallet needs its Binance Agent ID.':'Gameplay locked. Mint or buy a Nib with your agent to begin.';}
 }
 window.addEventListener('taptap:rendered',renderAccess);
 document.addEventListener('click',e=>{const preset=e.target.closest('[data-utility-count]');if(preset){$('#utility-count').value=preset.dataset.utilityCount;calculate();}if(e.target.closest('[data-utility-retry]'))refresh();});
 $('#utility-count')?.addEventListener('input',calculate);
 $('#utility-exact')?.addEventListener('click',()=>{const n=Number($('#utility-count').value);if(Number.isSafeInteger(n)&&n>=0&&n<=10000)exactDialog('Your multiplier, exactly.',(5n*BigInt(n)).toString(),n+' NFTs held. Multiplier applies to new earned TAP only.');});
 $('#view-exact-points')?.addEventListener('click',()=>exactDialog('Your exact TAP balance.',agent?.points??0,'Compact numbers are rounded for display. This is the complete current balance; token conversion remains TBA.'));
 calculate();renderAccess();
})();
