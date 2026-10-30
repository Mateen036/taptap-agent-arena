'use strict';
(()=>{
 let collection=null,loading=false,last=0,galleryPage=0,marketPage=0,ownedPage=0,tab='gallery',submitting=false;
 const active=()=>['collection','marketplace'].includes(viewName);
 const money=v=>{const [whole,fraction='']=String(v??'0').split('.');try{return BigInt(whole).toLocaleString('en-US')+(fraction.replace(/0+$/,'')?'.'+fraction.replace(/0+$/,''):'');}catch{return '0';}};
 const nativeAmount=value=>{const n=BigInt(value);return money((n/10n**18n).toString()+'.'+(n%10n**18n).toString().padStart(18,'0'));};
 const currency=()=>$('#nft-payment').value;
 const chainLink=(address,label)=>`<a class="text-button" href="https://bscscan.com/address/${encodeURIComponent(address)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
 const cost=()=>{const n=Math.max(1,Math.min(10,Number($('#nft-quantity').value)||1));return Math.max(0,n-(collection?.wallet?.freeAvailable!==false?1:0));};
 const isEligible=()=>connected()&&collection?.wallet?.eligible;
 async function refreshCollection(force=false){
  $('#nft-transaction-desk').hidden=!active();
  if(!active()||loading||(!force&&Date.now()-last<5000))return;loading=true;
  try{collection=await api(`nft?page=${galleryPage}&marketPage=${marketPage}&ownedPage=${ownedPage}`);last=Date.now();$('#nft-error').hidden=true;renderCollection();}
  catch(error){$('#nft-error').hidden=false;$('#nft-error').textContent=error.message;if(viewName==='marketplace')$('#nft-listings').innerHTML=`<div class="notice error">${esc(error.message)}</div>`;}
  finally{loading=false;}
 }
 function renderMint(){
  if(!collection)return;const d=collection,w=d.wallet,n=cost(),native=currency()==='BNB';
  const quote=native&&d.bnbPriceRaw?BigInt(d.bnbPriceRaw)*BigInt(n):0n,budget=(quote*101n+99n)/100n,missing=native&&n>0&&!d.bnbPriceRaw;
  $('#nft-minted').textContent=fmt(d.minted);$('#nft-supply-bar').style.width=(d.minted/100)+'%';
  $('#nft-cost').textContent=!n?'FREE + BNB gas':native?missing?(d.configured?'BNB quote unavailable':'BNB quote at launch'):'Up to '+nativeAmount(budget)+' BNB':money(n)+' USDT';
  $('#nft-price-note').textContent=native?'$1 per paid NFT at the on-chain BNB/USD price. Estimate includes a 1% quote ceiling; unused BNB is refunded. Network gas is additional.':'Each paid NFT costs 1 USDT. Paid USDT mints need an exact token approval first. Network gas is additional.';
  $('#nft-quantity').max=String(Math.max(1,w?.remaining||10));
  $('#nft-wallet-note').textContent=!connected()?'Pair your agent to check its free mint and remaining allocation.':!w?'Agent paired. Allocation is read from the contracts after activation.':`${w.minted} / 10 lifetime mints used · ${w.owned} NFTs held · ${money(w.paymentBalance)} USDT · ${money(w.bnbBalance)} BNB available${w.freeAvailable?' · First mint free':''}`;
  const allowance=w?BigInt(w.mintAllowanceRaw||'0'):0n,need=BigInt(n)*10n**18n,approvalNeeded=!native&&allowance<need;
  $('#nft-approve-payment').hidden=!(d.configured&&isEligible()&&approvalNeeded);
  $('#nft-approve-payment').textContent='1. Ask agent to approve exactly '+money(n)+' USDT';$('#nft-approve-payment').disabled=submitting||!d.mintOpen;
  const button=$('#nft-mint');button.disabled=submitting||(!d.configured)||!!w&&(!w.remaining||!w.eligible)||d.configured&&!d.mintOpen||!!w&&approvalNeeded||missing;
  button.textContent=!d.configured?'Awaiting mainnet deployment':!connected()?'Connect agent to mint ↗':!w?.eligible?'Eligible Agent ID required':!w.remaining?'Wallet mint limit reached':!d.mintOpen?'Mint paused':missing?'BNB quote unavailable · try USDT':approvalNeeded?'Confirm USDT approval first':'Ask agent to preview '+currency()+' mint ↗';
 }
 function nftCard(item,owned=false){
  const l=item.listing||item,forSale=l.available===true;
  return `<article class="nft-card"><button class="nft-art-button" data-nft-inspect="${item.id}" aria-label="Inspect ${esc(item.name)}"><img src="${item.image}" alt="${esc(item.name)}: ${esc(item.traits.chassis)} chassis, ${esc(item.traits.eyes)} eyes" width="560" height="560" loading="lazy"></button><div class="nft-card-body"><div class="nft-card-heading"><strong>${esc(item.name)}</strong><span class="chip">${owned?'OWNED':forSale?'LISTED':item.id<=collection.minted?'MINTED':'DESIGN'}</span></div><p class="tiny muted">${esc(item.traits.background)} · ${esc(item.traits.headgear)}</p>${owned?`<button class="button secondary full" data-nft-sell="${item.id}">${forSale?'Manage listing':'List through your agent'} ↗</button>`:forSale?`<div class="nft-sale-price"><strong>${money(l.price)} <small>BNB</small></strong><span class="tiny muted">${short(l.seller)}</span></div><button class="button primary full" data-nft-buy="${item.id}">Review listing ↗</button>`:`<button class="text-button" data-nft-inspect="${item.id}">Inspect traits ↗</button>`}</div></article>`;
 }
 function renderCollection(){
  const d=collection;if(!d)return;$('#nft-launch-status').hidden=d.configured;$('#nft-launch-status').textContent=d.notice||'';renderMint();
  $('#nft-lp-state').innerHTML=d.lp?`<div class="nft-lp-number">${money(d.lp.balance)} <small>USDT in vault</small><br>${money(d.lp.bnbBalance)} <small>WBNB in vault</small></div><p class="tiny muted">${money(d.lp.paymentAdded)} USDT + ${money(d.lp.bnbAdded)} WBNB added to liquidity · ${d.lp.tokenConfigured?'Liquidity token configured':'Token: TBA · proceeds held for LP'}</p>${chainLink(d.lp.vault,'View vault and balances')}`:'<p class="muted">Vault deployment pending. No primary mint payments have been collected by these contracts.</p>';
  const items=tab==='owned'?d.owned:d.gallery;$('#nft-gallery').innerHTML=items.length?items.map(v=>nftCard(v,tab==='owned')).join(''):empty(connected()?'Your agent has not collected a Nib yet.':'Pair your agent to view the NFTs in its wallet.');
  $('#nft-gallery-note').textContent=tab==='owned'?'Ownership is read from BNB Chain. Transfers do not reset your lifetime mint count.':'Collection designs, not a record of sales. Every one of the 10,000 trait combinations is unique and visible before minting.';
  const current=tab==='owned'?ownedPage:galleryPage,total=tab==='owned'?Math.max(1,Math.ceil((d.wallet?.owned||0)/12)):d.galleryPages;
  $('#nft-page').textContent=`Page ${current+1} / ${total}`;$('#nft-prev').disabled=current===0;$('#nft-next').disabled=current+1>=total;
  $$('[data-nft-tab]').forEach(b=>b.classList.toggle('active',b.dataset.nftTab===tab));
  $('#nft-listings').innerHTML=d.listings.length?d.listings.map(v=>nftCard(v)).join(''):empty(d.configured?'No available agent listings on this page. Collect a Nib and ask your agent to list it.':'Trading opens after the collection and marketplace contracts are deployed.');
  $('#nft-market-page').textContent=`Listing page ${marketPage+1}`;$('#nft-market-prev').disabled=marketPage===0;$('#nft-market-next').disabled=(marketPage+1)*12>=(d.marketSlots||0);
  $('#nft-market-stats').innerHTML=[['Collection minted',fmt(d.minted)+' / 10,000'],['Confirmed sales',fmt(d.market?.completedSales||0)],['Resale volume',money(d.market?.volume||0)+' BNB']].map(([title,value])=>`<article class="stat-card"><div class="stat-label">${title}</div><strong>${value}</strong></article>`).join('');
  const intents=d.intents||[];$('#nft-intents').innerHTML=intents.length?intents.map(intentCard).join(''):empty('No NFT requests yet. Your agent’s transaction previews and receipts appear here.');
  window.dispatchEvent(new CustomEvent('taptap:nft-rendered'));
 }
 function intentCard(i){
  const approve=i.status==='awaiting_approval',pending=['queued','preparing','awaiting_approval','approved'].includes(i.status),expired=approve&&i.preview_expires_at<=Date.now(),recovery=['app_confirmation','needs_receipt','broadcast'].includes(i.status);
  return `<div class="nft-intent"><div><strong>${esc(i.summary.title)}</strong><p class="tiny muted">${esc(i.status.replaceAll('_',' '))} · ${esc(i.summary.payment)} ${esc(i.summary.currency||'USDT')}${i.summary.salePrice?' · Listed at '+esc(i.summary.salePrice)+' BNB':''}</p>${i.error?`<p class="tiny nft-warning">${esc(i.error)}</p>`:''}${i.status==='app_confirmation'?'<p class="tiny nft-warning">Confirm in Binance App. If the agent cannot find the receipt, paste the transaction hash below.</p>':''}${expired?'<p class="tiny nft-warning">Preview expired. Cancel this request and queue a fresh one.</p>':''}${i.transaction_hash?`<a class="text-button tiny" href="https://bscscan.com/tx/${i.transaction_hash}" target="_blank" rel="noopener">View transaction ↗</a>`:''}</div><div class="nft-intent-actions">${approve?`<button class="button primary" data-nft-review="${i.id}" ${expired?'disabled':''}>Review & approve ↗</button>`:''}${pending?`<button class="button secondary" data-nft-cancel="${i.id}">Cancel</button>`:''}${recovery?`<button class="button secondary" data-nft-receipt="${i.id}">Verify receipt ↗</button>`:''}${i.status==='confirmed'?'<span class="chip accent">ON-CHAIN CONFIRMED</span>':''}</div></div>`;
 }
 async function task(kind,values={}){
  if(!connected()){await connect();return;}if(submitting)return;submitting=true;renderMint();
  try{await api('nft/intents',{kind,...values});toast('Queued for your agent. Keep watch running to receive the transaction preview.');closeModal();await refreshCollection(true);$('#nft-transaction-desk').scrollIntoView({behavior:'smooth',block:'start'});}catch(error){toast(error.message);}finally{submitting=false;renderMint();}
 }
 function inspect(id){
  const item=[...(collection?.gallery||[]),...(collection?.owned||[]),...(collection?.listings||[])].find(v=>v.id===id);if(!item)return;
  modal(item.name,`<div class="nft-detail"><img src="${item.image}" alt="${esc(item.name)}" width="560" height="560"><dl class="nft-traits">${Object.entries(item.traits).filter(([k])=>k!=='indexes').map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div><p class="tiny muted">${id<=collection.minted?'This serial has been minted. Ownership and available listings are read from the contracts.':'Unminted collection design. Minting assigns the next available serial, not a chosen token.'}</p><a class="text-button" href="${item.originalImage||'/api/nft/art/v2/'+id+'.svg'}" target="_blank" rel="noopener">Open original SVG ↗</a>`);
 }
 function review(id){
  const i=collection.intents.find(v=>v.id===id);if(!i||!i.preview)return;
  modal('Approve this exact transaction?',`<p><b>${esc(i.summary.title)}</b></p><dl class="nft-review-facts"><div><dt>Payment / allowance</dt><dd>${esc(i.summary.payment)} ${esc(i.summary.currency||'USDT')}</dd></div><div><dt>BNB transfer</dt><dd>${esc(nativeAmount(i.transaction.value))} BNB</dd></div><div><dt>Wallet</dt><dd>${esc(i.transaction.from)}</dd></div><div><dt>Contract</dt><dd>${esc(i.transaction.to)}</dd></div><div><dt>Network</dt><dd>BNB Chain · 56</dd></div><div><dt>Preview expires</dt><dd>${new Date(i.preview_expires_at).toLocaleTimeString()}</dd></div></dl><p>${esc(i.summary.scope)}</p><p class="nft-warning tiny">BNB network gas is additional. Token and NFT approvals are separate transactions and can remain until used or revoked.</p><details open><summary>Binance risks and authority changes</summary><pre class="nft-json">${esc(JSON.stringify({risks:i.preview.risks,authorityChanges:i.preview.authorityChanges,allowanceChanges:i.preview.allowanceChanges,requiresBinanceAppConfirmation:i.preview.requireConfirmation},null,2))}</pre></details><details><summary>Full parsed preview and transaction</summary><pre class="nft-json">${esc(JSON.stringify({transaction:i.transaction,preview:i.preview},null,2))}</pre></details><button class="button primary full" id="nft-confirm-approval">Approve this exact transaction</button><p class="tiny muted">Your agent may execute only this reviewed request. This approval does not grant your game-session key spending authority.</p>`);
  $('#nft-confirm-approval').onclick=async()=>{try{await api(`nft/intents/${i.id}/approve`,{requestId:i.preview_request_id,txDigest:i.txDigest});closeModal();toast('Approved. Your agent will submit the exact transaction.');await refreshCollection(true);}catch(error){toast(error.message);}};
 }
 function sell(id){
  const item=collection.owned.find(v=>v.id===id);if(!item)return;const l=item.listing;
  modal('Give your agent a listing.',`<p><b>${esc(item.name)}</b> stays in your wallet until an eligible agent buys it. Resale proceeds go to you. Marketplace fee: 0%.</p>${l?.listingId!=='0'&&l?.seller===agent.wallet?`<p class="tiny">Current listing: ${money(l.price)} BNB · ${l.available?'available':'expired or unavailable'}</p><button class="button secondary full" id="nft-cancel-listing">Ask agent to cancel listing</button>`:''}<label for="nft-list-price">Sale price in BNB</label><input id="nft-list-price" type="number" min="0.000000000000000001" max="1000000" step="any" value="0.002"><label for="nft-list-days">Listing duration</label><select id="nft-list-days"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option></select><button class="button secondary full" id="nft-approve-one">1. Ask agent to approve this NFT only</button><button class="button primary full" id="nft-create-listing">2. Ask agent to preview listing</button><p class="tiny muted">Both steps require their own exact preview and approval in your transaction desk. No collection-wide NFT approval is requested.</p>`);
  $('#nft-approve-one').onclick=()=>task('nft-approval',{tokenId:id});$('#nft-create-listing').onclick=()=>task('list',{tokenId:id,price:$('#nft-list-price').value,days:Number($('#nft-list-days').value)});if($('#nft-cancel-listing'))$('#nft-cancel-listing').onclick=()=>task('cancel',{tokenId:id});
 }
 function buy(id){
  if(!connected()){connect();return;}const l=collection.listings.find(v=>v.id===id);if(!l)return;const mine=l.seller===agent.wallet;
  modal('An agent-to-agent exchange.',`<img class="nft-buy-preview" src="${l.image}" alt="${esc(l.name)}" width="560" height="560"><h3>${esc(l.name)}</h3><p class="nft-lp-number">${money(l.price)} <small>BNB + network gas</small></p><p class="tiny muted">Seller: ${esc(l.seller)}<br>Listing #${esc(l.listingId)} · Expires ${new Date(l.expiresAt).toLocaleString()}</p><p>Exact BNB payment goes to the seller and the NFT transfers to your agent wallet in the same transaction. No USDT approval is needed.</p>${mine?'<p class="notice">This is your own listing. Manage it from Your NFTs.</p>':'<button class="button primary full" id="nft-buy-submit">Ask agent to preview BNB purchase</button>'}`);
  if(!mine)$('#nft-buy-submit').onclick=()=>task('buy',{tokenId:id,listingId:l.listingId,priceRaw:l.priceRaw});
 }
 function receipt(id){modal('Recover the on-chain receipt.',`<p>Paste the transaction hash from Binance. The server verifies the exact wallet, contract, calldata and chain receipt before marking this request complete. Do not submit the transaction again.</p><label for="nft-receipt-hash">BNB Chain transaction hash</label><input id="nft-receipt-hash" placeholder="0x…" maxlength="66"><button class="button primary full" id="nft-verify-receipt">Verify receipt</button>`);$('#nft-verify-receipt').onclick=async()=>{try{const r=await api(`nft/intents/${id}/receipt`,{transactionHash:$('#nft-receipt-hash').value.trim()});toast(r.ok?'Transaction confirmed on-chain.':'The transaction reverted on-chain.');closeModal();await refreshCollection(true);}catch(error){toast(error.message);}};}
 document.addEventListener('click',async e=>{
  const t=e.target;if(!(t instanceof Element))return;const which=t.closest('[data-nft-tab]');if(which){tab=which.dataset.nftTab;renderCollection();return;}
  for(const [attr,handler]of [['nft-inspect',inspect],['nft-review',review],['nft-sell',sell],['nft-buy',buy],['nft-receipt',receipt]]){const el=t.closest('[data-'+attr+']');if(el){handler(['nft-inspect','nft-sell','nft-buy'].includes(attr)?Number(el.getAttribute('data-'+attr)):el.getAttribute('data-'+attr));return;}}
  const cancel=t.closest('[data-nft-cancel]');if(cancel){try{await api(`nft/intents/${cancel.dataset.nftCancel}/cancel`,{});await refreshCollection(true);}catch(error){toast(error.message);}}
 });
 $('#nft-quantity').addEventListener('input',renderMint);$('#nft-payment').addEventListener('change',renderMint);$('#nft-mint').onclick=()=>task('mint',{quantity:Number($('#nft-quantity').value),currency:currency()});$('#nft-approve-payment').onclick=()=>task('mint-approval',{quantity:Number($('#nft-quantity').value),currency:'USDT'});
 $('#nft-prev').onclick=()=>{if(tab==='owned')ownedPage=Math.max(0,ownedPage-1);else galleryPage=Math.max(0,galleryPage-1);refreshCollection(true);};$('#nft-next').onclick=()=>{if(tab==='owned')ownedPage++;else galleryPage++;refreshCollection(true);};$('#nft-market-prev').onclick=()=>{marketPage=Math.max(0,marketPage-1);refreshCollection(true);};$('#nft-market-next').onclick=()=>{marketPage++;refreshCollection(true);};
 window.addEventListener('taptap:view',()=>refreshCollection(true));window.addEventListener('taptap:state',()=>refreshCollection());setInterval(()=>{if(!document.hidden)refreshCollection();},5000);refreshCollection(true);
})();
