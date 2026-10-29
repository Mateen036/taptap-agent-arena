export default function Page() {
  return (
    <div className="test-review">
      <style>{`
.test-review .app{margin-left:190px}.test-review .sidebar{width:190px}.test-strip{background:#6e4a18;color:#fff0bd;border-bottom:1px solid #a17c34;padding:10px 18px;font-size:11px;text-align:center;position:relative;z-index:40}.test-banner{padding:16px;border:1px solid #84632a;background:#2b2518;border-radius:9px;margin:22px 0;color:#e8d5a3;font-size:12px}.test-actions{display:flex;gap:8px;flex-wrap:wrap}.test-actions .button{font-size:10px;padding:10px}.test-wallet{font-size:10px;overflow-wrap:anywhere}.test-steps{counter-reset:step;display:grid;gap:12px;padding:0;list-style:none}.test-steps li{padding:18px;background:var(--panel);border:1px solid var(--line);border-radius:8px}.test-steps b{color:var(--lime)}#test-role{max-width:190px}#test-status{font-size:11px;color:var(--muted)}.test-view[hidden]{display:none}.review-receipt{padding:14px 0;border-top:1px solid var(--line)}.review-receipt a{overflow-wrap:anywhere;font-size:10px}.review-receipt strong{font-size:13px}.review-traits{display:grid;grid-template-columns:1fr 1fr;gap:8px}.review-traits div{padding:9px;background:#242d1d;border-radius:6px}.review-traits dt{font-size:8px;color:var(--sage);text-transform:uppercase}.review-traits dd{font-size:11px;margin:4px 0 0}.review-modal-image{width:210px;height:auto;display:block;margin:12px auto;border-radius:12px}.test-review .sidebar nav{margin-top:25px}.test-review .nav-item{min-width:0}.test-wallet-panel{display:grid;grid-template-columns:1fr 1fr;gap:15px}#test-lp-state strong{color:var(--lime)}.test-review #toast{left:calc(50% + 95px)}.review-links{display:flex;gap:15px;flex-wrap:wrap;font-size:11px}#test-funding-address{overflow-wrap:anywhere;color:var(--lime)}.review-json{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:#0c1009;padding:12px;max-height:240px;overflow:auto;font-size:10px}#test-records:empty:after{content:'Your approved test transactions and verified receipts will appear here.';color:var(--muted);font-size:12px}.test-hero{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}.test-hero img{width:100%;height:auto;border-radius:12px}.test-review .sidebar-foot{margin-top:auto}#test-quote-approve{margin-top:15px}
@media(max-width:900px){.test-review .sidebar{width:78px}.test-review .sidebar .brand small,.test-review .sidebar .brand>span:last-child{display:none}.test-review .app{margin-left:78px}.test-hero{grid-template-columns:1fr}.test-review #toast{left:calc(50% + 39px)}}
@media(max-width:700px){.test-review .app{margin:0}.test-review .sidebar{width:100%;height:70px}.test-review .sidebar nav{margin:0}.test-review .nav-item{width:20%;padding:7px 3px}.test-review .nav-item>span{font-size:9px}.test-wallet-panel{grid-template-columns:1fr}.test-review .topbar{height:auto;min-height:70px;padding:12px;gap:8px;flex-wrap:wrap}.test-review #toast{left:50%}#test-role{max-width:165px}.test-strip{font-size:9px}.test-review .page-heading h1{font-size:36px}.test-review .nft-grid{gap:10px}.test-review .nft-card-heading strong{font-size:12px}.test-review .nft-card .button{font-size:9px}.test-review .section-heading h2{font-size:22px}}
`}</style>
      <div className="test-strip">
        BNB TESTNET · CHAIN 97 · DISPOSABLE TEST AGENTS · TEST TOKENS HAVE NO MONETARY VALUE
      </div>
      <aside className="sidebar">
        <a className="brand" href="#mint">
          <span className="brand-symbol">
            tt<span>✳</span>
          </span>
          <span>
            taptap<small>TESTNET REVIEW</small>
          </span>
        </a>
        <div className="season-tag">
          <i className="dot" /> NIB FOUNDRY <span>TEST ONLY</span>
        </div>
        <nav>
          <button className="nav-item active" data-test-view="mint">
            <span>Mint</span>
          </button>
          <button className="nav-item" data-test-view="market">
            <span>Market</span>
          </button>
          <button className="nav-item" data-test-view="wallet">
            <span>Your NFTs</span>
          </button>
          <button className="nav-item" data-test-view="lp">
            <span>LP vault</span>
          </button>
          <button className="nav-item" data-test-view="plan">
            <span>Test plan</span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <b>Test the whole loop.</b>
          <p>
            Review. Approve.
            <br />
            Verify the chain receipt.
          </p>
          <a
            className="text-button"
            href="https://taptap-agent-arena.vercel.app"
            target="_blank"
            rel="noopener"
          >
            Main site ↗
          </a>
        </div>
      </aside>
      <div className="app">
        <header className="topbar">
          <div className="breadcrumb">
            Nib Foundry / <b id="test-breadcrumb">Mint review</b>
          </div>
          <div className="top-actions">
            <label className="tiny" htmlFor="test-role">
              Test agent
            </label>
            <select id="test-role" defaultValue="alpha">
              <option value="alpha">Alpha — mint &amp; sell</option>
              <option value="beta">Beta — mint &amp; buy</option>
              <option value="deployer">Operator — LP tests</option>
            </select>
            <button className="button secondary" id="test-refresh">
              Refresh ↻
            </button>
          </div>
        </header>
        <main>
          <div className="test-banner">
            This site uses disposable test-agent wallets and a test identity registry. Binance
            Agentic Wallet does not support chain 97, so this verifies the NFT and marketplace
            contracts, not Binance’s mainnet signing service. Mainnet deployment remains on hold.
          </div>
          <div id="test-error" className="notice error" hidden role="status" />
          <div id="test-funding" className="panel" hidden>
            <h2>Ready for testnet gas.</h2>
            <p>Send free faucet test BNB on chain 97 to the disposable deployer:</p>
            <p id="test-funding-address" className="test-wallet" />
            <p id="test-funding-balance" />
            <a
              className="button secondary"
              href="https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/"
              target="_blank"
              rel="noopener"
            >
              Official faucet options ↗
            </a>
            <p className="tiny muted">
              Use 0.1 tBNB. Do not send real BNB. Contracts will become available after funding and
              deployment.
            </p>
          </div>
          <section className="test-view" id="test-mint">
            <div className="page-heading">
              <div className="eyebrow">NIB FOUNDRY / PUBLIC BLOCKCHAIN REVIEW</div>
              <h1>
                Give your agent
                <br />
                <span>a test run.</span>
              </h1>
              <p>Same 10,000-piece collection and mint rules. Test gas and tokens only.</p>
            </div>
            <div className="test-hero">
              <img
                src="/brand/nft-collection-preview.svg"
                width="1120"
                height="760"
                alt="Six original Nib Foundry robot NFT designs"
              />
              <article className="panel">
                <div className="panel-heading">
                  <h2>Mint with a test agent.</h2>
                  <span className="chip accent">CHAIN 97</span>
                </div>
                <div className="nft-supply">
                  <strong id="test-minted">—</strong>
                  <span>/ 10,000 minted</span>
                </div>
                <dl className="nft-facts">
                  <div>
                    <dt>First NFT per wallet</dt>
                    <dd>Free + test gas</dd>
                  </div>
                  <div>
                    <dt>Each later mint</dt>
                    <dd>1 tUSDT</dd>
                  </div>
                  <div>
                    <dt>Wallet lifetime limit</dt>
                    <dd>10 NFTs</dd>
                  </div>
                  <div>
                    <dt>Payment token value</dt>
                    <dd>None · test funds</dd>
                  </div>
                </dl>
                <p id="test-wallet-note" className="tiny muted" />
                <label htmlFor="test-quantity">Quantity</label>
                <div className="mint-quantity">
                  <input id="test-quantity" type="number" min="1" max="10" defaultValue="1" />
                  <strong id="test-cost">—</strong>
                </div>
                <button className="button secondary full" id="test-mint-approval" hidden>
                  Ask agent to approve exact payment
                </button>
                <button className="button primary full" id="test-mint-request" disabled>
                  Awaiting deployment
                </button>
                <p className="tiny muted">
                  The test agent prepares and simulates the transaction. You review the exact terms
                  and approve before it signs. Browser code never receives private keys.
                </p>
              </article>
            </div>
            <div className="section-heading">
              <h2>Explore all designs.</h2>
              <span className="tiny muted">Designs do not imply mint ownership.</span>
            </div>
            <div className="nft-grid" id="test-gallery" />
            <div className="nft-pagination">
              <button className="button secondary" id="test-prev">
                ← Previous
              </button>
              <span id="test-page" className="tiny muted" />
              <button className="button secondary" id="test-next">
                Next →
              </button>
            </div>
          </section>
          <section className="test-view" id="test-market" hidden>
            <div className="page-heading">
              <div className="eyebrow">ALPHA SELLS. BETA BUYS.</div>
              <h1>
                Test a real
                <br />
                <span>agent exchange.</span>
              </h1>
              <p>
                Switch agents to test both sides. Payments and ownership settle atomically on BNB
                testnet.
              </p>
            </div>
            <div id="test-market-stats" className="stats-grid" />
            <div className="notice">
              Approve the individual NFT, list it from Your NFTs, then switch to the other agent to
              approve test payment and buy. Marketplace fee: 0%.
            </div>
            <div className="nft-grid" id="test-listings" />
          </section>
          <section className="test-view" id="test-wallet" hidden>
            <div className="page-heading">
              <div className="eyebrow">OWNERSHIP FROM THE CONTRACT</div>
              <h1>
                Your test
                <br />
                <span>agent’s collection.</span>
              </h1>
              <p id="test-wallet-address" className="test-wallet" />
            </div>
            <div id="test-wallet-stats" className="stats-grid" />
            <div className="nft-grid" id="test-owned" />
          </section>
          <section className="test-view" id="test-lp" hidden>
            <div className="page-heading">
              <div className="eyebrow">PRIMARY MINT PROCEEDS / REAL TIMELOCK</div>
              <h1>
                Follow the funds
                <br />
                <span>into LP.</span>
              </h1>
              <p>
                Uses the same LP-vault code and two-day token-selection delay. The selected token
                and all funds here are test substitutes.
              </p>
            </div>
            <article className="panel" id="test-lp-state" />
            <article className="panel">
              <h2>What this proves.</h2>
              <p>
                Paid mint proceeds go directly to the vault. After the real two-day delay, Operator
                can activate the preselected test token and add liquidity through PancakeSwap’s
                testnet router. LP tokens remain in the vault with no withdrawal path.
              </p>
              <p className="tiny muted">
                Waiting cannot be accelerated on the public testnet. Local automated tests already
                cover the timelock boundary. Token quality, future mainnet economics and real
                liquidity value are outside this test.
              </p>
            </article>
          </section>
          <section className="test-view" id="test-plan" hidden>
            <div className="page-heading">
              <div className="eyebrow">YOUR ACCEPTANCE CHECKLIST</div>
              <h1>
                Try to
                <br />
                <span>break it.</span>
              </h1>
              <p>
                Keep this checklist while reviewing. Every successful action should have a testnet
                explorer receipt.
              </p>
            </div>
            <ol className="test-steps">
              <li>
                <b>1. Alpha: mint one free NFT.</b>
                <p>Only tBNB gas should be charged. Lifetime mint count becomes one.</p>
              </li>
              <li>
                <b>2. Alpha: make a paid mint.</b>
                <p>
                  Approve the exact tUSDT amount, then mint. The vault balance increases by that
                  amount.
                </p>
              </li>
              <li>
                <b>3. Check the wallet limit.</b>
                <p>
                  Mint up to ten total; an eleventh must fail. Selling or transferring must not
                  reset the count.
                </p>
              </li>
              <li>
                <b>4. List an NFT.</b>
                <p>
                  Approve that individual NFT, then list it. Ownership stays with Alpha before sale.
                </p>
              </li>
              <li>
                <b>5. Beta: buy it.</b>
                <p>
                  Approve exact test payment, then purchase. Alpha receives tUSDT and Beta receives
                  the NFT in one successful transaction.
                </p>
              </li>
              <li>
                <b>6. Cancel or change a listing.</b>
                <p>Confirm stale quotes and already-sold listings cannot execute.</p>
              </li>
              <li>
                <b>7. Inspect art and receipts.</b>
                <p>
                  Check traits, mobile layouts and transaction hashes. Retrying the same approved
                  request must not mint twice.
                </p>
              </li>
              <li>
                <b>8. Operator: verify LP after two days.</b>
                <p>
                  Activate the selected test token and add liquidity. Check LP tokens are locked and
                  router allowances clear.
                </p>
              </li>
            </ol>
            <article className="panel">
              <h2>Test limits.</h2>
              <p>
                The test identity registry substitutes for Binance IDs, and disposable agents
                substitute for Binance signing. Mainnet Binance login/signing requires a separate
                final check. Filling all 10,000 NFTs on the public testnet is unnecessary; automated
                local tests cover the supply boundary and rejection of NFT 10,001.
              </p>
            </article>
          </section>
          <article className="panel">
            <div className="panel-heading">
              <h2>Test transaction receipts.</h2>
              <span className="chip">APPROVED → CHAIN VERIFIED</span>
            </div>
            <p className="tiny muted">
              Stored in this browser. Ownership and balances are always read from chain 97. These
              are test transactions, not production trading volume.
            </p>
            <div id="test-records" />
          </article>
          <footer>
            <span className="footer-brand">Nib Foundry ✳</span>
            <span>
              Isolated BNB testnet review.
              <br />
              No real Binance identity or token value.
            </span>
            <span id="test-status">Connecting to testnet…</span>
          </footer>
        </main>
      </div>
      <dialog id="test-modal" aria-labelledby="test-modal-title">
        <button className="modal-close" id="test-modal-close" aria-label="Close dialog">
          ×
        </button>
        <div id="test-modal-body" />
      </dialog>
      <div id="toast" role="status" aria-live="polite" />
    </div>
  );
}
