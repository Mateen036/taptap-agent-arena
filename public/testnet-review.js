"use strict";
(() => {
  const $ = (s) => document.querySelector(s),
    $$ = (s) => [...document.querySelectorAll(s)],
    esc = (s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
      ),
    amount = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 8 }),
    short = (w) => (w ? w.slice(0, 6) + "…" + w.slice(-4) : "");
  let role = "alpha",
    page = 0,
    state = null,
    loading = false,
    busy = false,
    toastTimer;
  const historyKey = "nib-testnet97-receipts-v1";
  let records = [];
  try {
    records = JSON.parse(localStorage.getItem(historyKey) || "[]");
  } catch {}
  const save = () => localStorage.setItem(historyKey, JSON.stringify(records.slice(0, 40)));
  function toast(t) {
    $("#toast").textContent = t;
    $("#toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 7000);
  }
  async function api(path = "", body) {
    const r = await fetch("/api/review" + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    let d;
    try {
      d = await r.json();
    } catch {
      throw Error("The testnet server returned an unreadable response.");
    }
    if (!r.ok) throw Error(d.error || "Testnet request failed.");
    return d;
  }
  function modal(title, html) {
    $("#test-modal-body").innerHTML =
      '<span class="modal-eyebrow">TESTNET 97 / NO REAL FUNDS</span><h2 id="test-modal-title">' +
      esc(title) +
      "</h2>" +
      html;
    if (!$("#test-modal").open) $("#test-modal").showModal();
  }
  const close = () => $("#test-modal").close();
  function view(name) {
    if (!["mint", "market", "wallet", "lp", "plan"].includes(name)) name = "mint";
    $$(".test-view").forEach((v) => (v.hidden = v.id !== "test-" + name));
    $$("[data-test-view]").forEach((v) =>
      v.classList.toggle("active", v.dataset.testView === name),
    );
    $("#test-breadcrumb").textContent = {
      mint: "Mint review",
      market: "Market review",
      wallet: "Owned NFTs",
      lp: "LP vault",
      plan: "Test plan",
    }[name];
    history.replaceState({}, "", "#" + name);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function card(x, type) {
    const l = x.listing || x;
    return `<article class="nft-card"><button class="nft-art-button" data-inspect="${x.id}" aria-label="Inspect ${esc(x.name)}"><img src="${x.image}" alt="${esc(x.name)}" width="560" height="560" loading="lazy"></button><div class="nft-card-body"><div class="nft-card-heading"><strong>${esc(x.name)}</strong><span class="chip">${type === "owned" ? "OWNED" : type === "market" ? "LISTED" : x.id <= state.minted ? "MINTED" : "DESIGN"}</span></div><p class="tiny muted">${esc(x.traits.chassis)} · ${esc(x.traits.headgear)}</p>${type === "owned" ? `<button class="button secondary full" data-sell="${x.id}">${l.available ? "Manage listing" : "Ask agent to list"} ↗</button>` : type === "market" ? `<p class="nft-sale-price"><strong>${amount(l.price)} <small>tUSDT</small></strong><span class="tiny muted">${short(l.seller)}</span></p><button class="button primary full" data-buy="${x.id}">Review purchase ↗</button>` : `<button class="text-button" data-inspect="${x.id}">Inspect traits ↗</button>`}</div></article>`;
  }
  function mintCost() {
    const quantity = Math.max(1, Math.min(10, Number($("#test-quantity").value) || 1));
    return Math.max(0, quantity - (state?.wallet?.freeAvailable ? 1 : 0));
  }
  function renderMint() {
    if (!state) return;
    const w = state.wallet,
      cost = mintCost(),
      allow = BigInt(w?.mintAllowance || "0") >= BigInt(cost) * 10n ** 18n;
    $("#test-minted").textContent = state.configured ? amount(state.minted) : "—";
    $("#test-cost").textContent = state.configured
      ? cost
        ? cost + " tUSDT"
        : "FREE + test gas"
      : "Test funds only";
    $("#test-wallet-note").textContent = w
      ? `${role.toUpperCase()} · ${w.minted}/10 lifetime mints · ${amount(w.paymentBalance)} tUSDT · ${amount(w.testBNB)} tBNB`
      : "Test agent balances appear after deployment.";
    $("#test-mint-approval").hidden = !state.configured || cost === 0 || allow;
    $("#test-mint-approval").disabled = busy;
    $("#test-mint-request").disabled =
      busy || !state.configured || !state.mintOpen || w?.remaining === 0 || !allow;
    $("#test-mint-request").textContent = !state.configured
      ? "Awaiting testnet deployment"
      : !state.mintOpen
        ? "Mint paused"
        : w?.remaining === 0
          ? "Wallet mint limit reached"
          : !allow
            ? "Approve exact test payment first"
            : "Ask " + role.toUpperCase() + " to preview mint ↗";
  }
  function render() {
    if (!state) return;
    $("#test-funding").hidden = state.configured;
    if (!state.configured) {
      $("#test-funding-address").textContent = state.funding?.address || "Preparing test deployer";
      $("#test-funding-balance").textContent =
        "Current balance: " + amount(state.funding?.testBNB) + " tBNB";
    }
    renderMint();
    $("#test-gallery").innerHTML = state.gallery.map((x) => card(x, "design")).join("");
    $("#test-page").textContent = `Page ${page + 1} / ${state.pages}`;
    $("#test-prev").disabled = page === 0;
    $("#test-next").disabled = page + 1 >= state.pages;
    $("#test-owned").innerHTML = state.owned?.length
      ? state.owned.map((x) => card(x, "owned")).join("")
      : '<div class="empty-state">No NFTs held by this test agent yet.</div>';
    $("#test-wallet-address").textContent = state.wallet?.address || state.wallets?.[role] || "";
    $("#test-listings").innerHTML = state.listings?.length
      ? state.listings.map((x) => card(x, "market")).join("")
      : '<div class="empty-state">No available test listings. Mint and list from Alpha, then switch to Beta.</div>';
    const stats = (target, items) => {
      $(target).innerHTML = items
        .map(
          ([label, value]) =>
            `<article class="stat-card"><div class="stat-label">${label}</div><strong>${esc(value)}</strong></article>`,
        )
        .join("");
    };
    stats("#test-market-stats", [
      ["Test sales", state.market?.sales || 0],
      ["Test volume", amount(state.market?.volume) + " tUSDT"],
      ["Marketplace fee", "0%"],
    ]);
    stats("#test-wallet-stats", [
      ["NFTs held", state.wallet?.owned || 0],
      ["Lifetime mints", (state.wallet?.minted || 0) + " / 10"],
      ["Test balance", amount(state.wallet?.paymentBalance) + " tUSDT"],
    ]);
    const lp = state.lp;
    $("#test-lp-state").innerHTML = lp
      ? `<div class="nft-lp-number">${amount(lp.balance)} <small>tUSDT in vault</small></div><p>Payment added to test liquidity: ${amount(lp.paymentAdded)} tUSDT</p><p>LP tokens locked (raw units): ${esc(lp.lockedRaw)}</p><p class="test-wallet">Vault: ${esc(lp.vault)}</p><p>${lp.tokenConfigured ? "Test token activated." : `Activation available ${new Date(lp.readyAt).toLocaleString()} (${new Date(lp.readyAt).toISOString()})`}</p><div class="test-actions"><button class="button secondary" id="test-lp-activate" ${role !== "deployer" || lp.tokenConfigured || Date.now() < lp.readyAt ? "disabled" : ""}>Operator: preview token activation</button><button class="button primary" id="test-lp-add" ${role !== "deployer" || !lp.tokenConfigured || Number(lp.balance) <= 0 ? "disabled" : ""}>Operator: preview test LP addition</button></div><p class="tiny muted">Select Operator to test the owner-only LP operations.</p>`
      : "<h2>LP vault awaits testnet deployment.</h2>";
    if ($("#test-lp-activate")) $("#test-lp-activate").onclick = () => quote("lp-activate");
    if ($("#test-lp-add")) $("#test-lp-add").onclick = () => quote("lp-add");
    $("#test-status").textContent = state.configured
      ? "Chain97 connected · " + new Date().toLocaleTimeString()
      : "Awaiting faucet funding / deployment";
    renderRecords();
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      state = await api(`?role=${role}&page=${page}`);
      $("#test-error").hidden = true;
      render();
    } catch (e) {
      $("#test-error").hidden = false;
      $("#test-error").textContent = e.message;
    } finally {
      loading = false;
    }
  }
  async function quote(kind, values = {}) {
    if (busy) return;
    busy = true;
    renderMint();
    try {
      const q = await api("/quote", { role, kind, chainId: 97, ...values });
      review(q);
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
      renderMint();
    }
  }
  function review(q) {
    modal(
      "Approve this test transaction?",
      `<p><b>${esc(q.summary.title)}</b> · Agent ${esc(q.role)}</p><dl class="nft-review-facts"><div><dt>Network</dt><dd>BNB TESTNET 97</dd></div><div><dt>Payment / allowance</dt><dd>${esc(q.summary.payment)} tUSDT (no value)</dd></div><div><dt>Estimated maximum test gas fee</dt><dd>${esc(q.estimatedFee)} tBNB</dd></div><div><dt>Test agent wallet</dt><dd>${esc(q.from)}</dd></div><div><dt>Contract</dt><dd>${esc(q.to)}</dd></div><div><dt>Nonce / expires</dt><dd>${q.nonce} / ${new Date(q.expiresAt).toLocaleTimeString()}</dd></div></dl><p class="tiny nft-warning">This is a disposable test agent, not Binance signing. No real BNB or real USDT is used. The agent will sign exactly this chain97 transaction once.</p><details><summary>Exact simulated transaction</summary><pre class="review-json">${esc(JSON.stringify({ ...q, reviewToken: undefined }, null, 2))}</pre></details><button class="button primary full" id="test-quote-approve">Approve this testnet transaction</button>`,
    );
    $("#test-quote-approve").onclick = async () => {
      const button = $("#test-quote-approve");
      button.disabled = true;
      try {
        const r = await api("/execute", { reviewToken: q.reviewToken, approve: true });
        records.unshift({
          id: q.id,
          role: q.role,
          summary: q.summary,
          hash: r.hash,
          reviewToken: q.reviewToken,
          status: "submitted",
          at: new Date().toISOString(),
        });
        records = records.filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);
        save();
        close();
        toast("Test transaction submitted. Waiting for its chain receipt.");
        renderRecords();
        await checkReceipts();
      } catch (e) {
        toast(e.message);
        button.disabled = false;
      }
    };
  }
  async function checkReceipts() {
    let changed = false;
    for (const r of records.filter((x) => !["confirmed", "reverted"].includes(x.status))) {
      try {
        const d = await api("/receipt", { reviewToken: r.reviewToken, hash: r.hash });
        r.status = d.status;
        r.block = d.block;
        changed = true;
      } catch (e) {
        r.error = e.message;
      }
    }
    if (changed) {
      save();
      renderRecords();
      await refresh();
    }
  }
  function renderRecords() {
    $("#test-records").innerHTML = records
      .map(
        (r) =>
          `<div class="review-receipt"><strong>${esc(r.summary.title)} · ${esc(r.role)}</strong><p class="tiny ${r.status === "confirmed" ? "muted" : "nft-warning"}">${esc(r.status)}${r.block ? " · block " + esc(r.block) : ""}</p><a class="text-button" href="https://testnet.bscscan.com/tx/${r.hash}" target="_blank" rel="noopener">${esc(r.hash)} ↗</a>${r.error ? `<p class="tiny nft-warning">${esc(r.error)}</p>` : ""}</div>`,
      )
      .join("");
  }
  function inspect(id) {
    const x = [...state.gallery, ...(state.owned || []), ...(state.listings || [])].find(
      (x) => x.id === id,
    );
    if (!x) return;
    modal(
      x.name,
      `<img class="review-modal-image" src="${x.image}" alt="${esc(x.name)}" width="560" height="560"><dl class="review-traits">${Object.entries(
        x.traits,
      )
        .filter(([k]) => k !== "indexes")
        .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
        .join(
          "",
        )}</dl><p class="tiny muted">Test collection design. Serial IDs are assigned sequentially when minting.</p>`,
    );
  }
  function sell(id) {
    const x = state.owned.find((x) => x.id === id);
    if (!x) return;
    modal(
      "Prepare a test listing.",
      `<p><b>${esc(x.name)}</b> stays with ${role.toUpperCase()} until purchased.</p><label for="test-sale-price">Sale price (test tUSDT)</label><input id="test-sale-price" type="number" min="0.000001" max="1000000" step="0.000001" value="1"><p class="tiny muted">Each step gets its own exact approval. No collection-wide NFT approval is used.</p><div class="result-links"><button class="button secondary" id="test-approve-nft">1. Preview individual NFT approval</button><button class="button primary" id="test-list-nft">2. Preview listing</button>${x.listing?.listingId !== "0" ? '<button class="button secondary" id="test-cancel-listing">Preview cancellation</button>' : ""}</div>`,
    );
    $("#test-approve-nft").onclick = () => quote("nft-approval", { tokenId: id });
    $("#test-list-nft").onclick = () =>
      quote("list", { tokenId: id, price: $("#test-sale-price").value });
    if ($("#test-cancel-listing"))
      $("#test-cancel-listing").onclick = () => quote("cancel", { tokenId: id });
  }
  function buy(id) {
    const l = state.listings.find((x) => x.id === id);
    if (!l) return;
    const mine = l.seller.toLowerCase() === state.wallet.address.toLowerCase(),
      allowed = BigInt(state.wallet.marketAllowance) >= BigInt(l.priceRaw);
    modal(
      "Review test purchase.",
      `<img class="review-modal-image" src="${l.image}" alt="${esc(l.name)}"><h3>${esc(l.name)} · ${amount(l.price)} tUSDT</h3><p class="test-wallet">Seller ${esc(l.seller)}<br>Listing ${esc(l.listingId)}</p>${mine ? '<p class="notice">This agent owns the listing. Switch to the other test agent to buy it.</p>' : `<div class="result-links"><button class="button secondary" id="test-buy-approval" ${allowed ? "disabled" : ""}>1. Preview exact payment approval</button><button class="button primary" id="test-buy-submit" ${allowed ? "" : "disabled"}>2. Preview purchase</button></div>`}`,
    );
    if (!mine) {
      const values = { tokenId: id, listingId: l.listingId, priceRaw: l.priceRaw };
      $("#test-buy-approval").onclick = () => quote("buy-approval", values);
      $("#test-buy-submit").onclick = () => quote("buy", values);
    }
  }
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const nav = e.target.closest("[data-test-view]");
    if (nav) {
      view(nav.dataset.testView);
      return;
    }
    for (const [key, fn] of [
      ["inspect", inspect],
      ["sell", sell],
      ["buy", buy],
    ]) {
      const b = e.target.closest("[data-" + key + "]");
      if (b) {
        fn(Number(b.dataset[key]));
        return;
      }
    }
  });
  $("#test-role").onchange = () => {
    role = $("#test-role").value;
    refresh();
  };
  $("#test-refresh").onclick = () => {
    refresh();
    checkReceipts();
  };
  $("#test-quantity").oninput = renderMint;
  $("#test-mint-request").onclick = () =>
    quote("mint", { quantity: Number($("#test-quantity").value) });
  $("#test-mint-approval").onclick = () =>
    quote("mint-approval", { quantity: Number($("#test-quantity").value) });
  $("#test-prev").onclick = () => {
    page = Math.max(0, page - 1);
    refresh();
  };
  $("#test-next").onclick = () => {
    page = Math.min(833, page + 1);
    refresh();
  };
  $("#test-modal-close").onclick = close;
  view(location.hash.slice(1) || "mint");
  refresh();
  renderRecords();
  setInterval(() => {
    if (!document.hidden) {
      refresh();
      checkReceipts();
    }
  }, 7000);
})();
