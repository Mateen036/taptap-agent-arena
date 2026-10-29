import { test } from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { parseEther } from "viem";
import { nftChain } from "./helpers/nft-chain";
import { NFT_PAYMENT, NFT_ROUTER } from "../lib/nft-protocol";
import { AGENT_ID_REGISTRY } from "../lib/protocol";
import {
  testnetState,
  prepareTestnetQuote,
  executeTestnetQuote,
  confirmTestnetQuote,
  sealTestnetQuote,
  openTestnetQuote,
  type TestnetEnv,
} from "../lib/nft-testnet";

const secret = { TESTNET_REVIEW_SECRET: "fixture-secret-only-not-a-deployment-secret" };
test("testnet review rejects altered, mainnet and nonzero-value approval tokens", () => {
  const q = { chainId: 97, testOnly: true, value: "0", nonce: 2 };
  const token = sealTestnetQuote(secret, q);
  assert.deepEqual(openTestnetQuote(secret, token), q);
  assert.throws(() => openTestnetQuote(secret, token + "x"), /changed/);
  for (const changed of [
    { ...q, chainId: 56 },
    { ...q, testOnly: false },
    { ...q, value: "1" },
  ])
    assert.throws(() => openTestnetQuote(secret, sealTestnetQuote(secret, changed)), /testnet/);
  assert.throws(() => openTestnetQuote({}, token), /secret/);
});

test("isolated chain97: explicit approvals, exact payments, resale, replay safety, cap and LP timelock", async (t) => {
  const f = await nftChain(97),
    roles = ["deployer", "alpha", "beta"];
  const keys = Object.values(f.provider.getInitialAccounts()).map((x: any) => x.secretKey);
  const publicWallets = Object.fromEntries(roles.map((r, i) => [r, f.accounts[i].address]));
  const token = await f.deploy(f.m.MockToken);
  const env: TestnetEnv = {
    ...secret,
    TESTNET_MODE: "bnb-testnet",
    TESTNET_RPC_URL: f.rpc,
    TESTNET_DEPLOYMENT: JSON.stringify({
      chainId: 97,
      testOnly: true,
      wallets: publicWallets,
      contracts: {
        registry: AGENT_ID_REGISTRY,
        payment: NFT_PAYMENT,
        router: NFT_ROUTER,
        renderer: f.renderer,
        vault: f.vault,
        collection: f.collection,
        market: f.market,
        futureToken: token,
      },
    }),
    TESTNET_WALLETS: JSON.stringify({
      chainId: 97,
      wallets: Object.fromEntries(
        roles.map((r, i) => [r, { address: f.accounts[i].address, privateKey: keys[i] }]),
      ),
    }),
  };
  async function run(role: string, kind: string, values: any = {}) {
    const q = await prepareTestnetQuote(env, { role, kind, chainId: 97, ...values });
    const sent = await executeTestnetQuote(env, { approve: true, reviewToken: q.reviewToken });
    await f.client.waitForTransactionReceipt({ hash: sent.hash });
    await f.provider.request({ method: "evm_mine", params: [] });
    await f.provider.request({ method: "evm_mine", params: [] });
    const receipt = await confirmTestnetQuote(env, { reviewToken: q.reviewToken, hash: sent.hash });
    assert.equal(receipt.status, "confirmed");
    return { q, sent };
  }
  try {
    await t.test(
      "test identity and payment contracts enforce ownership and the chain97 constructor gate",
      async () => {
        const support = (name: string) =>
          JSON.parse(fs.readFileSync("artifacts/testnet/" + name + ".json", "utf8"));
        const registry = await f.deploy(support("NibTestIdentity"), [f.owner]);
        const payment = await f.deploy(support("NibTestToken"), ["Test", "TEST", f.owner]);
        assert.equal(await f.read(registry, support("NibTestIdentity").abi, "TESTNET_ONLY"), true);
        await assert.rejects(
          f.write(
            registry,
            support("NibTestIdentity").abi,
            "setEligible",
            [f.accounts[1].address, true],
            1,
          ),
        );
        await f.write(registry, support("NibTestIdentity").abi, "setEligible", [
          f.accounts[1].address,
          true,
        ]);
        assert.equal(
          await f.read(registry, support("NibTestIdentity").abi, "balanceOf", [
            f.accounts[1].address,
          ]),
          1n,
        );
        await assert.rejects(
          f.write(payment, support("NibTestToken").abi, "mint", [f.accounts[1].address, 1n], 1),
        );
      },
    );
    await t.test(
      "fails closed for disabled mode, mainnet RPC, forged role, absent approval and expired quotes",
      async () => {
        await assert.rejects(testnetState({ ...env, TESTNET_MODE: "mainnet" }), /not enabled/);
        await assert.rejects(
          prepareTestnetQuote(env, { role: "alpha", kind: "mint", quantity: 1, chainId: 56 }),
          /Mainnet/,
        );
        await assert.rejects(
          prepareTestnetQuote(env, { role: "stranger", kind: "mint", quantity: 1 }),
          /Choose/,
        );
        const q = await prepareTestnetQuote(env, { role: "alpha", kind: "mint", quantity: 1 });
        await assert.rejects(
          executeTestnetQuote(env, { approve: false, reviewToken: q.reviewToken }),
          /approval/,
        );
        await assert.rejects(
          executeTestnetQuote(env, {
            approve: true,
            reviewToken: sealTestnetQuote(env, { ...q, expiresAt: 0 }),
          }),
          /expired/,
        );
        await assert.rejects(
          executeTestnetQuote(env, {
            approve: true,
            reviewToken: sealTestnetQuote(env, { ...q, to: f.accounts[3].address }),
          }),
          /target/,
        );
      },
    );
    await t.test(
      "free mint and same approved request return one transaction, never two NFTs",
      async () => {
        const { q, sent } = await run("alpha", "mint", { quantity: 1 });
        assert.equal(q.summary.payment, "0");
        const repeat = await executeTestnetQuote(env, {
          approve: true,
          reviewToken: q.reviewToken,
        });
        assert.equal(repeat.hash, sent.hash);
        assert.equal(repeat.alreadySubmitted, true);
        const s = await testnetState(env, "alpha");
        assert.equal(s.wallet?.minted, 1);
        assert.equal(s.owned?.length, 1);
        assert.equal(s.lp?.balance, "0");
        await assert.rejects(
          confirmTestnetQuote(env, {
            reviewToken: q.reviewToken,
            hash: (await run("beta", "mint", { quantity: 1 })).sent.hash,
          }),
          /differs/,
        );
      },
    );
    await t.test(
      "paid mint needs exact approval and routes only primary proceeds into the vault",
      async () => {
        await assert.rejects(
          prepareTestnetQuote(env, { role: "alpha", kind: "mint", quantity: 1 }),
          /Approve/,
        );
        const { q } = await run("alpha", "mint-approval", { quantity: 1 });
        assert.equal(q.summary.payment, "1");
        await run("alpha", "mint", { quantity: 1 });
        const s = await testnetState(env, "alpha");
        assert.equal(s.wallet?.minted, 2);
        assert.equal(s.wallet?.mintAllowance, "0");
        assert.equal(s.lp?.balance, "1");
      },
    );
    await t.test(
      "list approval is individual, stale prices fail, other agent buys atomically and cancel works",
      async () => {
        await assert.rejects(
          prepareTestnetQuote(env, { role: "alpha", kind: "list", tokenId: 1, price: "2" }),
          /Approve/,
        );
        await run("alpha", "nft-approval", { tokenId: 1 });
        await run("alpha", "list", { tokenId: 1, price: "2" });
        let s = await testnetState(env, "beta"),
          l = s.listings![0];
        assert.equal(l.seller.toLowerCase(), publicWallets.alpha.toLowerCase());
        await assert.rejects(
          prepareTestnetQuote(env, {
            role: "beta",
            kind: "buy",
            tokenId: 1,
            listingId: l.listingId,
            priceRaw: "1",
          }),
          /changed/,
        );
        const values = { tokenId: 1, listingId: l.listingId, priceRaw: l.priceRaw };
        await run("beta", "buy-approval", values);
        await run("beta", "buy", values);
        s = await testnetState(env, "beta");
        assert.ok(s.owned?.some((x) => x.id === 1));
        assert.equal(s.market?.sales, 1);
        assert.equal(s.lp?.balance, "1");
        await assert.rejects(
          prepareTestnetQuote(env, { role: "beta", kind: "buy", ...values }),
          /unavailable/,
        );
        const alpha = await testnetState(env, "alpha"),
          id = alpha.owned![0].id;
        await run("alpha", "nft-approval", { tokenId: id });
        await run("alpha", "list", { tokenId: id, price: "3" });
        await run("alpha", "cancel", { tokenId: id });
        assert.equal((await testnetState(env)).listings?.length, 0);
      },
    );
    await t.test("ten lifetime mints are enforced after selling", async () => {
      await run("alpha", "mint-approval", { quantity: 8 });
      await run("alpha", "mint", { quantity: 8 });
      assert.equal((await testnetState(env, "alpha")).wallet?.minted, 10);
      await assert.rejects(
        prepareTestnetQuote(env, { role: "alpha", kind: "mint", quantity: 1 }),
        /ten lifetime/,
      );
    });
    await t.test(
      "owner LP activation waits two days, liquidity is locked and allowance cleared",
      async () => {
        await f.write(token, f.m.MockToken.abi, "mint", [f.vault, parseEther("100")]);
        await f.write(f.vault, f.art("NibLPVault").abi, "proposeToken", [token]);
        await assert.rejects(
          prepareTestnetQuote(env, { role: "alpha", kind: "lp-activate" }),
          /Operator/,
        );
        await assert.rejects(prepareTestnetQuote(env, { role: "deployer", kind: "lp-activate" }));
        await f.provider.request({ method: "evm_increaseTime", params: [172801] });
        await f.provider.request({ method: "evm_mine", params: [] });
        await run("deployer", "lp-activate");
        await run("deployer", "lp-add");
        const s = await testnetState(env);
        assert.equal(s.lp?.paymentAdded, "9");
        assert.ok(BigInt(s.lp!.lockedRaw) > 0n);
        assert.equal(
          await f.read(NFT_PAYMENT, f.m.MockToken.abi, "allowance", [f.vault, NFT_ROUTER]),
          0n,
        );
      },
    );
  } finally {
    await f.close();
  }
});

test("testnet review refuses a chain56 RPC before quoting", async () => {
  const f = await nftChain();
  try {
    const support = JSON.parse(fs.readFileSync("artifacts/testnet/NibTestIdentity.json", "utf8"));
    await assert.rejects(f.deploy(support, [f.owner]));
    await assert.rejects(
      prepareTestnetQuote(
        {
          ...secret,
          TESTNET_MODE: "bnb-testnet",
          TESTNET_RPC_URL: f.rpc,
          TESTNET_DEPLOYMENT: JSON.stringify({ chainId: 97, testOnly: true }),
        },
        { role: "alpha", kind: "mint", quantity: 1 },
      ),
      /outside BNB testnet/,
    );
  } finally {
    await f.close();
  }
});
