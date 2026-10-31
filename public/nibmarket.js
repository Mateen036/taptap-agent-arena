'use strict';
(()=>{
 // NIB pre-market (bids only), shown as the "Pre-market bids" tab of the NIB Token page. Reads GET /api/nib-market; every action is handed to the user's agent as an instruction (signed agent actions return baw previews).
 let data=null,loading=false,last=0,timer=null;
 const active=()=>viewName==='nibtoken'&&!$('#nibt-pane-market')?.hidden;
 const trim=v=>{const [w,f='']=String(v??'0').split('.');const t=f.replace(/0+$/,'');return w+(t?'.'+t:'');};
 const num=v=>{const [w,f='']=trim(v).split('.');try{return BigInt(w).toLocaleString('en-US')+(f?'.'+f:'');}catch{return '0';}};
 const price=v=>{const s=trim(v);const [w,f='']=s.split('.');return w+(f?'.'+f.slice(0,12).replace(/0+$/,''):'');};
 const short=a=>a?a.slice(0,6)+'…'+a.slice(-4):'';
 const link=a=>`<a class="text-button" href="https://bscscan.com/address/${encodeURIComponent(a)}" target="_blank" rel="noopener" title="${esc(a)}">${esc(short(a))}</a>`;
 const agoText=ms=>{if(!ms)return 'time pending';const s=Math.max(0,Math.round((Date.now()-ms)/1000));return s<60?'just now':s<3600?Math.floor(s/60)+' min ago':s<86400?Math.floor(s/3600)+' h ago':Math.floor(s/86400)+' d ago';};
 const expiry=s=>s?new Date(s*1000).toLocaleString():'No expiry';
 const read=()=>'Read '+location.origin+'/agent-skill.md (section "NIB pre-market"). ';
 const tail=' Show me the baw preview (parsed call, gas, risks) and only execute after I approve. Never re-execute an uncertain transaction.';
 const prompts={
  bid:(nib,p,hours)=>`${read()}Place a NIB pre-market bid for me with the signed action nib-bid-place and payload ${JSON.stringify({nib,price:p,...(hours?{expiresInHours:hours}:{})})}.${tail}`,
  top:()=>`${read()}Sell my NIB into the highest open bid: signed action nib-bid-accept with payload {"id":"top","nib":"max"}. Tell me the price, the BNB I receive after the 2% fee, and whether it is a partial fill before I approve.${tail}`,
  topAmount:(n)=>`${read()}Sell ${n} NIB into the highest open bid: signed action nib-bid-accept with payload ${JSON.stringify({id:'top',nib:n})}.${tail}`,
  accept:(id)=>`${read()}Accept NIB bid #${id} with the signed action nib-bid-accept and payload ${JSON.stringify({id:String(id),nib:'max'})}.${tail}`,
  cancel:(id)=>`${read()}Cancel my NIB bid #${id} with the signed action nib-bid-cancel and payload ${JSON.stringify({id:String(id)})}. It refunds the full unfilled BNB.${tail}`
 };
 async function refresh(force=false){
  if(loading||(!force&&Date.now()-last<30000))return;loading=true;
  try{data=await api('nib-market');last=Date.now();render();}catch(e){const el=$('#nibm-book');if(el&&!data)el.innerHTML=empty(e.message);}finally{loading=false;}
 }
 function bookRow(l,max){
  const w=max>0?Number(l.cumulativeBnb)/max*100:0;
  return `<tr><td class="num"><strong>${esc(price(l.priceBnb))}</strong></td><td class="num">${esc(num(l.nib))}</td><td class="num">${esc(num(l.bnb))}</td><td class="num muted">${esc(num(l.cumulativeNib))}</td><td class="depth-cell"><span class="depth-bar" style="width:${Math.min(100,Math.max(2,w))}%"></span><span class="tiny muted">${l.bids} bid${l.bids===1?'':'s'}</span></td></tr>`;
 }
 function render(){
  if(!data||!$('#nibm-book'))return;
  const banner=$('#nibm-banner');
  if(!data.deployed){
   banner.hidden=false;banner.innerHTML='<strong>The NIB pre-market is not live yet.</strong> '+esc(data.message||'Bids open once the contract is deployed.');
   $('#nibm-best').textContent='—';$('#nibm-open').textContent='—';$('#nibm-volume').textContent='—';$('#nibm-depth-caption').textContent='Not live yet';
   $('#nibm-book').innerHTML=empty('No order book yet. Check back soon.');$('#nibm-fills').innerHTML='';$('#nibm-fills-note').textContent='';$('#nibm-sell').innerHTML='<p class="tiny muted">Selling opens together with the market.</p>';
   $('#nibm-copy-bid').disabled=true;return;
  }
  $('#nibm-copy-bid').disabled=false;
  banner.hidden=!data.paused;if(data.paused)banner.innerHTML='<strong>New bids are paused.</strong> You can still accept and cancel bids.';
  $('#nibm-best').innerHTML=data.bestBid?esc(price(data.bestBid.priceBnb))+' <small>BNB</small>':'—';
  $('#nibm-best-caption').textContent=data.bestBid?'per NIB · '+num(data.bestBid.nib)+' NIB wanted':'No open bids yet';
  $('#nibm-open').textContent=String(data.openBids);$('#nibm-depth-caption').textContent=data.openBids?num(data.depth.totalBnb)+' BNB · '+num(data.depth.totalNib)+' NIB wanted':'Be the first to bid';
  $('#nibm-volume').innerHTML=esc(num(data.stats.volumeBnb))+' <small>BNB</small>';$('#nibm-volume-caption').textContent=data.stats.fills+' fills · '+num(data.stats.volumeNib)+' NIB';
  $('#nibm-updated').textContent='Updated '+new Date().toLocaleTimeString();
  const levels=data.levels||[],max=Number(levels.length?levels[levels.length-1].cumulativeBnb:0);
  $('#nibm-book').innerHTML=levels.length?`<div class="table-wrap"><table class="book"><thead><tr><th class="num">Price (BNB/NIB)</th><th class="num">NIB wanted</th><th class="num">BNB locked</th><th class="num">Depth (NIB)</th><th>Depth</th></tr></thead><tbody>${levels.map(l=>bookRow(l,max)).join('')}</tbody></table></div><details><summary class="tiny muted">Individual bids (${data.bids.length})</summary><div class="table-wrap"><table class="book"><thead><tr><th>#</th><th class="num">Price</th><th class="num">NIB</th><th class="num">You get after 2%</th><th>Expires</th><th>Bidder</th><th></th></tr></thead><tbody>${data.bids.map(b=>`<tr><td>#${esc(b.id)}</td><td class="num">${esc(price(b.priceBnb))}</td><td class="num">${esc(num(b.nib))}</td><td class="num">${esc(num(b.sellerReceivesBnb))} BNB</td><td class="tiny">${esc(expiry(b.expiresAt))}</td><td>${link(b.bidder)}</td><td><button class="text-button" data-nibm-accept="${esc(b.id)}">Sell into this bid ↗</button></td></tr>`).join('')}</tbody></table></div></details>`:empty('No open bids yet. Place the first one.');
  const top=data.bestBid;
  $('#nibm-sell').innerHTML=`<button class="button primary full" id="nibm-copy-top" ${top?'':'disabled'}>Copy: “accept the top bid” ↗</button><p class="tiny muted">${top?`Top bid pays ${esc(price(top.priceBnb))} BNB per NIB, up to ${esc(num(top.nib))} NIB. You'd receive ${esc(price(top.priceBnb))} × amount minus 2%.`:'There are no bids to accept yet.'}</p>${data.user&&!data.user.error?`<p class="tiny muted">Your NIB: <strong>${esc(num(data.user.nib))}</strong></p>`:''}`;
  const mine=data.user?.myBids||[];$('#nibm-mine-wrap').hidden=!data.user;
  if(data.user)$('#nibm-mine').innerHTML=(mine.length?`<div class="table-wrap"><table class="book"><thead><tr><th>#</th><th class="num">Price</th><th class="num">NIB still wanted</th><th class="num">BNB locked</th><th>Expires</th><th></th></tr></thead><tbody>${mine.map(b=>`<tr><td>#${esc(b.id)}</td><td class="num">${esc(price(b.priceBnb))}</td><td class="num">${esc(num(b.nib))}</td><td class="num">${esc(num(b.bnb))}</td><td class="tiny">${esc(expiry(b.expiresAt))}${b.live?'':' · expired'}</td><td><button class="text-button" data-nibm-cancel="${esc(b.id)}">Cancel (agent) ↗</button></td></tr>`).join('')}</tbody></table></div>`:empty('You have no open bids.'))+(Number(data.user.creditBnb)>0?`<p class="notice">${esc(data.user.creditBnb)} BNB is waiting to be withdrawn from the contract (a payout could not be sent directly). Ask your agent to call withdrawCredit.</p>`:'');
  const f=data.fills||{items:[],index:{}};
  $('#nibm-fills-note').textContent=f.items.length?'':(f.index?.error?'Fill history is temporarily unavailable.':f.index?.complete===false?'Indexing recent fills…':'No fills yet. The first accepted bid will show up here.');
  $('#nibm-fills').innerHTML=f.items.map(s=>`<article class="sale-row nibm-fill"><div class="sale-main"><div class="sale-title"><strong>${esc(num(s.nib))} NIB</strong><span class="chip accent">BID #${esc(s.bidId)} FILLED</span></div><p class="tiny muted">Seller ${link(s.seller)} → Buyer ${link(s.bidder)} · at ${esc(price(s.priceBnb))} BNB per NIB</p></div><div class="sale-price"><strong>${esc(num(s.bnb))} <small>BNB</small></strong><span class="tiny muted">${esc(agoText(s.timestamp))}</span><a class="text-button tiny" href="${esc(s.url)}" target="_blank" rel="noopener">BscScan ↗</a></div></article>`).join('');
  quote();
 }
 function quote(){
  const out=$('#nibm-quote'),n=$('#nibm-nib')?.value.trim(),p=$('#nibm-price')?.value.trim();if(!out)return;
  if(!/^\d+(\.\d{1,18})?$/.test(n||'')||!/^\d+(\.\d{1,18})?$/.test(p||'')||Number(p)<=0||Number(n)<=0){out.textContent='Enter a quantity and a price.';return;}
  const bnb=Number(n)*Number(p),total=bnb*1.02;
  out.textContent=bnb<0.001?`That is only ${bnb.toPrecision(3)} BNB. The minimum bid is 0.001 BNB.`:`You lock about ${total.toPrecision(6)} BNB (${bnb.toPrecision(6)} for the NIB + 2% fee). Unfilled BNB is refundable any time.`;
 }
 document.addEventListener('input',e=>{if(e.target.id==='nibm-nib'||e.target.id==='nibm-price')quote();});
 document.addEventListener('submit',e=>{
  if(e.target.id!=='nibm-bid-form')return;e.preventDefault();
  const n=$('#nibm-nib').value.trim(),p=$('#nibm-price').value.trim(),h=$('#nibm-expiry').value.trim();
  if(!/^\d+(\.\d{1,18})?$/.test(n)||!/^\d+(\.\d{1,18})?$/.test(p)||Number(n)<=0||Number(p)<=0)return toast('Enter a NIB quantity and a price in BNB per NIB.');
  if(Number(n)*Number(p)<0.001)return toast('The minimum bid is 0.001 BNB.');
  if(h&&!(Number(h)>0&&Number(h)<=8760))return toast('Expiry must be between 1 and 8760 hours, or empty.');
  copy(prompts.bid(n,p,h||undefined),'Instruction copied. Paste it to your agent.');
 });
 document.addEventListener('click',e=>{
  if(e.target.closest('#nibm-copy-top'))copy(prompts.top(),'Instruction copied. Paste it to your agent.');
  const a=e.target.closest('[data-nibm-accept]');if(a)copy(prompts.accept(a.dataset.nibmAccept),'Instruction copied. Paste it to your agent.');
  const c=e.target.closest('[data-nibm-cancel]');if(c)copy(prompts.cancel(c.dataset.nibmCancel),'Instruction copied. Paste it to your agent.');
 });
 // 'nibt:tab' fires whenever the NIB Token page or one of its tabs is shown (see the NIB Token script below).
 window.addEventListener('nibt:tab',()=>{if(active()){refresh(true);if(!timer)timer=setInterval(()=>{if(active()&&!document.hidden)refresh();},15000);}});
 window.addEventListener('taptap:state',()=>{if(active())refresh(false);});
 if(active())refresh(true);
})();

(()=>{
 // NIB Token page: static facts live in the HTML; only the pool numbers are fetched (GET /api/nib-token, CDN-cached ~20 s), and only while the Token info tab is open.
 let data=null,loading=false,last=0,timer=null,tab='token';
 const active=()=>viewName==='nibtoken'&&tab==='token';
 const grp=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:d}):'—';};
 // Tiny prices need leading zeros kept (0.000000243), not exponent notation.
 const small=(n,digits=3)=>{if(!(n>0))return '—';if(n>=1)return n.toLocaleString('en-US',{maximumFractionDigits:2});const dp=Math.min(20,Math.max(2,digits-1-Math.floor(Math.log10(n))));return n.toFixed(dp).replace(/0+$/,'');};
 const money=n=>n==null?'—':n>=1000?'$'+grp(n):'$'+(n>=1?n.toFixed(2):small(n));
 function show(which){
  tab=which==='market'?'market':'token';
  $$('[data-nibt-tab]').forEach(b=>b.classList.toggle('active',b.dataset.nibtTab===tab));
  $('#nibt-pane-token').hidden=tab!=='token';$('#nibt-pane-market').hidden=tab!=='market';
 }
 function render(){
  if(!data)return;const t=data.token||{},p=data.pool;
  if(t.name)$('#nibt-name').textContent=t.name;if(t.symbol)$('#nibt-symbol').textContent=t.symbol;if(t.decimals!=null)$('#nibt-decimals').textContent=String(t.decimals);
  if(!p){$('#nibt-pool-note').textContent='Pool data is temporarily unavailable.';return;}
  $('#nibt-price').innerHTML=p.priceUsd!=null?esc('$'+small(p.priceUsd)):esc(small(p.priceBnb))+' <small>BNB</small>';
  $('#nibt-price-caption').textContent=(p.priceBnb?small(p.priceBnb)+' BNB per NIB':'')+(p.bnbUsd?' · BNB ≈ $'+grp(p.bnbUsd,2):'');
  $('#nibt-liq').textContent=p.liquidityUsd!=null?money(p.liquidityUsd):grp(p.liquidityBnb,4)+' BNB';
  $('#nibt-liq-caption').textContent='Both sides of the pool'+(p.liquidityUsd!=null?' · '+grp(p.liquidityBnb,4)+' BNB':'');
  $('#nibt-res-nib').textContent=grp(p.reserveNib);$('#nibt-res-bnb').textContent=grp(p.reserveBnb,6);
  $('#nibt-lp').textContent=p.lpBurnedPct!=null?(p.lpBurnedPct>=99.995?'100%':(Math.floor(p.lpBurnedPct*100)/100)+'%'):'—';
  $('#nibt-updated').textContent='Updated '+new Date(data.updatedAt||Date.now()).toLocaleTimeString();
  $('#nibt-pool-note').textContent='Price and reserves are read from the pair contract and refresh about every 20 seconds. Prices are in BNB; the dollar figures use the Chainlink BNB/USD feed and are estimates.';
 }
 async function refresh(force=false){
  if(loading||(!force&&Date.now()-last<20000))return;loading=true;
  try{data=await api('nib-token');last=Date.now();render();}catch{if(!data)$('#nibt-pool-note').textContent='Live pool data is temporarily unavailable. The pool is still readable on BscScan and DexScreener.';}finally{loading=false;}
 }
 function enter(){
  if(viewName!=='nibtoken')return;
  if(location.pathname==='/nibmarket'||location.hash==='#nibmarket')show('market');else if(location.pathname==='/nibtoken'||location.hash==='#nibtoken')show('token');
  if(active()){refresh(false);if(!timer)timer=setInterval(()=>{if(active()&&!document.hidden)refresh();},30000);}
  window.dispatchEvent(new CustomEvent('nibt:tab'));
 }
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-nibt-tab]');
  if(b){show(b.dataset.nibtTab);history.replaceState({},'','/'+(tab==='market'?'nibmarket':'nibtoken'));enter();return;}
  const c=e.target.closest('[data-nibt-copy]');if(c)copy(c.dataset.nibtCopy,'Address copied.');
 });
 window.addEventListener('taptap:view',enter);
 if(viewName==='nibtoken')enter();
})();
