import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeFunctionData,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
  keccak256,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { canonical } from "./game";
import {
  nftAbi,
  nftMarketAbi,
  nftPaymentAbi,
  nftVaultAbi,
  nftTokenId,
  nftPrice,
} from "./nft-protocol";
import { nftSvg, nftTraits } from "./nft-art";
export type TestnetEnv = {
  TESTNET_MODE?: string;
  TESTNET_RPC_URL?: string;
  TESTNET_DEPLOYMENT?: string;
  TESTNET_WALLETS?: string;
  TESTNET_REVIEW_SECRET?: string;
};
type Role = "alpha" | "beta" | "deployer";
export class TestnetError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new TestnetError(status, message);
};
const supportAbi = [
  {
    type: "function",
    name: "TESTNET_ONLY",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;
const identityAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
const adminAbi = [
  {
    type: "function",
    name: "activateToken",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "addLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
  },
] as const;
const read = (c: any, address: any, abi: any, functionName: string, args: any[] = []) =>
  c.readContract({ address, abi, functionName, args });
const asset = (id: number) => ({
  id,
  name: "Nib Foundry #" + String(id).padStart(5, "0"),
  image: "/api/review/art/" + id + ".svg",
  traits: nftTraits(id),
});
function setup(env: TestnetEnv) {
  if (env.TESTNET_MODE !== "bnb-testnet")
    throw new TestnetError(503, "Testnet review is not enabled.");
  let manifest: any;
  try {
    manifest = JSON.parse(env.TESTNET_DEPLOYMENT || "{}");
  } catch {
    throw new TestnetError(503, "Testnet manifest is invalid.");
  }
  if (manifest.chainId !== 97 || manifest.testOnly !== true)
    throw new TestnetError(503, "This service accepts chain97 test deployments only.");
  const c = createPublicClient({
    chain: bscTestnet,
    transport: http(env.TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545", {
      timeout: 15000,
      retryCount: 1,
    }),
  });
  return { c, manifest };
}
function actor(env: TestnetEnv, role: any) {
  if (!["alpha", "beta", "deployer"].includes(role))
    throw new TestnetError(400, "Choose Alpha, Beta or Operator.");
  let data: any;
  try {
    data = JSON.parse(env.TESTNET_WALLETS || "{}");
  } catch {
    throw new TestnetError(503, "Test agents are not configured.");
  }
  if (data.chainId !== 97) throw new TestnetError(503, "Testnet-only agent credentials required.");
  const record = data.wallets?.[role];
  if (!record?.privateKey) throw new TestnetError(503, "Test agent is not configured.");
  const account = privateKeyToAccount(record.privateKey);
  if (account.address.toLowerCase() !== record.address?.toLowerCase())
    throw new TestnetError(503, "Test agent key/address mismatch.");
  return account;
}
const verified = new Map<string, number>();
async function context(env: TestnetEnv) {
  const { c, manifest } = setup(env);
  if ((await c.getChainId()) !== 97)
    throw new TestnetError(503, "Refusing an RPC outside BNB testnet97.");
  const a = manifest.contracts;
  if (
    !a ||
    !["collection", "market", "vault", "registry", "payment", "futureToken", "router"].every((k) =>
      isAddress(a[k]),
    )
  )
    throw new TestnetError(409, "Waiting for testnet gas funding and contract deployment.");
  const key = (env.TESTNET_RPC_URL || "public") + canonical(a);
  if ((verified.get(key) || 0) < Date.now()) {
    const v = await Promise.all([
      read(c, a.registry, supportAbi, "TESTNET_ONLY"),
      read(c, a.payment, supportAbi, "TESTNET_ONLY"),
      read(c, a.futureToken, supportAbi, "TESTNET_ONLY"),
      read(c, a.collection, nftAbi, "paymentToken"),
      read(c, a.collection, nftAbi, "agentIdRegistry"),
      read(c, a.collection, nftAbi, "lpVault"),
      read(c, a.market, nftMarketAbi, "collection"),
      read(c, a.market, nftMarketAbi, "paymentToken"),
      read(c, a.vault, nftVaultAbi, "router"),
      read(c, a.collection, nftAbi, "MAX_SUPPLY"),
      read(c, a.collection, nftAbi, "WALLET_LIMIT"),
      read(c, a.collection, nftAbi, "mintPrice"),
    ]);
    const expected = [a.payment, a.registry, a.vault, a.collection, a.payment, a.router];
    if (
      v.slice(0, 3).some((x) => x !== true) ||
      v.slice(3, 9).some((x, i) => String(x).toLowerCase() !== expected[i].toLowerCase()) ||
      BigInt(v[9]) !== 10000n ||
      BigInt(v[10]) !== 10n ||
      BigInt(v[11]) !== 10n ** 18n
    )
      throw new TestnetError(
        503,
        "Testnet contracts fail the expected economics, identity or payment checks.",
      );
    if (verified.size > 16) verified.clear();
    verified.set(key, Date.now() + 30000);
  }
  return { c, manifest, a };
}
async function listing(c: any, a: any, id: number) {
  const [l, available] = await Promise.all([
    read(c, a.market, nftMarketAbi, "listings", [BigInt(id)]),
    read(c, a.market, nftMarketAbi, "available", [BigInt(id)]),
  ]);
  return {
    ...asset(id),
    listingId: String(l[0]),
    seller: String(l[1]),
    priceRaw: String(l[2]),
    price: formatUnits(BigInt(l[2]), 18),
    expiresAt: Number(l[3]) * 1000,
    available,
  };
}
export async function testnetState(env: TestnetEnv, role: Role = "alpha", page = 0) {
  const { c, manifest } = setup(env);
  if (!["alpha", "beta", "deployer"].includes(role)) fail(400, "Invalid test agent.");
  const p = Math.min(833, Math.max(0, Math.floor(page) || 0));
  const base = {
    chainId: 97,
    testOnly: true,
    network: "BNB testnet",
    paymentSymbol: "tUSDT (no value)",
    binanceWalletSupported: false,
    identity: "Test substitute; not a real Binance Agent ID",
    role,
    wallets: manifest.wallets,
    configured: !!manifest.contracts?.collection,
    gallery: Array.from({ length: Math.min(12, 10000 - p * 12) }, (_, i) => asset(p * 12 + i + 1)),
    page: p,
    pages: 834,
    contracts: manifest.contracts || {},
  };
  if (!base.configured) {
    const testBNB = manifest.wallets?.deployer
      ? formatEther(await c.getBalance({ address: manifest.wallets.deployer }))
      : null;
    return {
      ...base,
      funding: {
        address: manifest.wallets?.deployer,
        testBNB,
        needed: "0.1 tBNB on chain97",
        faucet: "https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/",
      },
      notice: "Testnet contracts await faucet funding. No mainnet transaction has been sent.",
    };
  }
  const { a } = await context(env),
    address = manifest.wallets[role];
  const [
    minted,
    used,
    held,
    balance,
    bnb,
    allowMint,
    allowMarket,
    count,
    sales,
    volume,
    vaultBalance,
    tokenReadyAt,
    liquidityToken,
    locked,
    added,
    open,
    paused,
  ] = await Promise.all([
    read(c, a.collection, nftAbi, "minted"),
    read(c, a.collection, nftAbi, "mintedBy", [address]),
    read(c, a.collection, nftAbi, "balanceOf", [address]),
    read(c, a.payment, nftPaymentAbi, "balanceOf", [address]),
    c.getBalance({ address }),
    read(c, a.payment, nftPaymentAbi, "allowance", [address, a.collection]),
    read(c, a.payment, nftPaymentAbi, "allowance", [address, a.market]),
    read(c, a.market, nftMarketAbi, "activeCount"),
    read(c, a.market, nftMarketAbi, "completedSales"),
    read(c, a.market, nftMarketAbi, "volume"),
    read(c, a.payment, nftPaymentAbi, "balanceOf", [a.vault]),
    read(c, a.vault, nftVaultAbi, "tokenReadyAt"),
    read(c, a.vault, nftVaultAbi, "liquidityToken"),
    read(c, a.vault, nftVaultAbi, "lpTokensLocked"),
    read(c, a.vault, nftVaultAbi, "paymentAdded"),
    read(c, a.collection, nftAbi, "mintOpen"),
    read(c, a.collection, nftAbi, "paused"),
  ]);
  const ownedIds = await Promise.all(
    Array.from({ length: Math.min(30, Number(held)) }, (_, i) =>
      read(c, a.collection, nftAbi, "tokenOfOwnerByIndex", [address, BigInt(i)]),
    ),
  );
  const marketIds = await Promise.all(
    Array.from({ length: Math.min(30, Number(count)) }, (_, i) =>
      read(c, a.market, nftMarketAbi, "activeAt", [BigInt(i)]),
    ),
  );
  const [owned, listings] = await Promise.all([
    Promise.all(
      ownedIds.map(async (id) => ({
        ...asset(Number(id)),
        listing: await listing(c, a, Number(id)),
      })),
    ),
    Promise.all(marketIds.map((id) => listing(c, a, Number(id)))),
  ]);
  return {
    ...base,
    minted: Number(minted),
    mintOpen: open && !paused,
    wallet: {
      address,
      minted: Number(used),
      remaining: 10 - Number(used),
      freeAvailable: BigInt(used) === 0n,
      owned: Number(held),
      paymentBalance: formatUnits(BigInt(balance), 18),
      testBNB: formatEther(bnb),
      mintAllowance: String(allowMint),
      marketAllowance: String(allowMarket),
    },
    owned,
    listings: listings.filter((l) => l.available),
    market: { sales: Number(sales), volume: formatUnits(BigInt(volume), 18) },
    lp: {
      vault: a.vault,
      balance: formatUnits(BigInt(vaultBalance), 18),
      readyAt: Number(tokenReadyAt) * 1000,
      token: liquidityToken,
      tokenConfigured: String(liquidityToken) !== "0x0000000000000000000000000000000000000000",
      lockedRaw: String(locked),
      paymentAdded: formatUnits(BigInt(added), 18),
    },
  };
}
function secret(env: TestnetEnv) {
  if (!env.TESTNET_REVIEW_SECRET || env.TESTNET_REVIEW_SECRET.length < 32)
    throw new TestnetError(503, "Review-signing secret is missing.");
  return env.TESTNET_REVIEW_SECRET;
}
export function sealTestnetQuote(env: TestnetEnv, quote: any) {
  const data = Buffer.from(canonical(quote)).toString("base64url"),
    mac = createHmac("sha256", secret(env)).update(data).digest("base64url");
  return data + "." + mac;
}
export function openTestnetQuote(env: TestnetEnv, token: any) {
  if (typeof token !== "string" || token.length > 20000)
    throw new TestnetError(400, "Invalid review token.");
  const [data, mac, ...extra] = token.split(".");
  const expected = createHmac("sha256", secret(env))
      .update(data || "")
      .digest(),
    provided = Buffer.from(mac || "", "base64url");
  if (extra.length || provided.length !== expected.length || !timingSafeEqual(expected, provided))
    throw new TestnetError(400, "Review token changed. Request a fresh quote.");
  let q: any;
  try {
    q = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    throw new TestnetError(400, "Invalid review data.");
  }
  if (q.chainId !== 97 || q.testOnly !== true || q.value !== "0")
    throw new TestnetError(400, "Only zero-value testnet requests are allowed.");
  return q;
}
export async function prepareTestnetQuote(env: TestnetEnv, b: any) {
  if (b.chainId !== undefined && b.chainId !== 97)
    fail(400, "Mainnet calls are forbidden in this review.");
  const { c, a, manifest } = await context(env),
    account = actor(env, b.role),
    from = account.address;
  if (from.toLowerCase() !== manifest.wallets[b.role]?.toLowerCase())
    fail(503, "Actor differs from the public test manifest.");
  const kind = String(b.kind),
    id = randomUUID(),
    now = Date.now(),
    expiresAt = now + 5 * 60000,
    deadline = (await c.getBlock()).timestamp + 300n;
  let to: any, data: any, summary: any;
  const encode = (abi: any, name: string, args: any[]) =>
    encodeFunctionData({ abi, functionName: name, args } as any);
  if (kind === "mint" || kind === "mint-approval") {
    const quantity = Number(b.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10)
      fail(400, "Choose 1-10 NFTs.");
    const [used, minted, open, paused] = await Promise.all([
      read(c, a.collection, nftAbi, "mintedBy", [from]),
      read(c, a.collection, nftAbi, "minted"),
      read(c, a.collection, nftAbi, "mintOpen"),
      read(c, a.collection, nftAbi, "paused"),
    ]);
    if (Number(used) + quantity > 10) fail(409, "This wallet reached its ten lifetime mints.");
    if (Number(minted) + quantity > 10000 || !open || paused)
      fail(409, "Mint closed or insufficient supply.");
    const cost = BigInt(quantity - (BigInt(used) === 0n ? 1 : 0)) * 10n ** 18n;
    if (kind === "mint-approval") {
      if (cost === 0n) fail(409, "A free mint needs no test-token approval.");
      to = a.payment;
      data = encode(nftPaymentAbi, "approve", [a.collection, cost]);
      summary = {
        title: "Approve exact test mint payment",
        payment: formatUnits(cost, 18),
        spender: a.collection,
      };
    } else {
      if (BigInt(await read(c, a.payment, nftPaymentAbi, "allowance", [from, a.collection])) < cost)
        fail(409, "Approve the exact test-token amount first.");
      to = a.collection;
      data = encode(nftAbi, "mint", [BigInt(quantity), cost, deadline, keccak256(Buffer.from(id))]);
      summary = { title: "Mint " + quantity + " NFT(s)", payment: formatUnits(cost, 18), quantity };
    }
  } else if (["nft-approval", "list", "buy-approval", "buy", "cancel"].includes(kind)) {
    const tokenId = nftTokenId(b.tokenId),
      l = await listing(c, a, tokenId);
    if (["nft-approval", "list", "cancel"].includes(kind)) {
      if (
        String(await read(c, a.collection, nftAbi, "ownerOf", [BigInt(tokenId)])).toLowerCase() !==
        from.toLowerCase()
      )
        fail(403, "Only the NFT owner can do this.");
      if (kind === "nft-approval") {
        to = a.collection;
        data = encode(nftAbi, "approve", [a.market, BigInt(tokenId)]);
        summary = {
          title: "Approve NFT #" + tokenId + " only",
          payment: "0",
          tokenId,
          spender: a.market,
        };
      } else if (kind === "list") {
        const price = nftPrice(String(b.price));
        if (
          String(
            await read(c, a.collection, nftAbi, "getApproved", [BigInt(tokenId)]),
          ).toLowerCase() !== a.market.toLowerCase()
        )
          fail(409, "Approve this NFT first.");
        to = a.market;
        data = encode(nftMarketAbi, "list", [BigInt(tokenId), price, deadline - 300n + 86400n]);
        summary = {
          title: "List NFT #" + tokenId,
          payment: "0",
          salePrice: formatUnits(price, 18),
          tokenId,
        };
      } else {
        if (l.seller.toLowerCase() !== from.toLowerCase() || l.listingId === "0")
          fail(409, "No listing owned by this test agent.");
        to = a.market;
        data = encode(nftMarketAbi, "cancel", [BigInt(tokenId), BigInt(l.listingId)]);
        summary = { title: "Cancel NFT #" + tokenId + " listing", payment: "0", tokenId };
      }
    } else {
      if (!l.available || l.seller.toLowerCase() === from.toLowerCase())
        fail(409, "Listing unavailable to this test agent.");
      if (b.listingId !== l.listingId || b.priceRaw !== l.priceRaw)
        fail(409, "Listing changed. Review the current price.");
      if (kind === "buy-approval") {
        to = a.payment;
        data = encode(nftPaymentAbi, "approve", [a.market, BigInt(l.priceRaw)]);
        summary = {
          title: "Approve exact test purchase payment",
          payment: l.price,
          spender: a.market,
          tokenId,
        };
      } else {
        if (
          BigInt(await read(c, a.payment, nftPaymentAbi, "allowance", [from, a.market])) <
          BigInt(l.priceRaw)
        )
          fail(409, "Approve the exact purchase price first.");
        to = a.market;
        data = encode(nftMarketAbi, "buy", [
          BigInt(tokenId),
          BigInt(l.listingId),
          BigInt(l.priceRaw),
          l.seller,
          deadline,
        ]);
        summary = { title: "Buy NFT #" + tokenId, payment: l.price, tokenId, seller: l.seller };
      }
    }
  } else if (["lp-activate", "lp-add"].includes(kind)) {
    if (b.role !== "deployer") fail(403, "Choose the disposable Operator agent for LP tests.");
    to = a.vault;
    if (kind === "lp-activate") {
      data = encode(adminAbi, "activateToken", []);
      summary = {
        title: "Activate the preselected test LP token",
        payment: "0",
        token: a.futureToken,
      };
    } else {
      const balance = BigInt(await read(c, a.payment, nftPaymentAbi, "balanceOf", [a.vault]));
      if (balance < parseEther("0.01"))
        fail(409, "The vault needs paid test mints before adding liquidity.");
      const amount = balance > parseEther("10") ? parseEther("10") : balance;
      data = encode(adminAbi, "addLiquidity", [
        amount,
        amount,
        (amount * 99n) / 100n,
        (amount * 99n) / 100n,
        deadline,
      ]);
      summary = {
        title: "Add test-token liquidity with 1% minimum bounds",
        payment: formatUnits(amount, 18),
        token: a.futureToken,
      };
    }
  } else fail(400, "Unsupported test action.");
  const nonce = await c.getTransactionCount({ address: from, blockTag: "pending" }),
    gas = await c.estimateGas({ account: from, to, data, value: 0n }),
    gasPrice = await c.getGasPrice();
  const gasLimit = (gas * 120n) / 100n;
  if (gasLimit > 15000000n || gasLimit * gasPrice > parseEther("0.01"))
    fail(409, "Test gas exceeds the review budget.");
  const quote = {
    id,
    chainId: 97,
    testOnly: true,
    role: b.role,
    kind,
    from,
    to,
    value: "0",
    data,
    nonce,
    gas: gasLimit.toString(),
    gasPrice: gasPrice.toString(),
    expiresAt,
    summary,
    estimatedFee: formatEther(gasLimit * gasPrice),
    scope:
      "Disposable test agent on BNB testnet97. Test assets have no monetary value. No Binance or mainnet key is used.",
  };
  return { ...quote, reviewToken: sealTestnetQuote(env, quote) };
}
export async function executeTestnetQuote(env: TestnetEnv, b: any) {
  if (b.approve !== true) fail(400, "Explicit approval is required.");
  const q = openTestnetQuote(env, b.reviewToken),
    { c, a, manifest } = await context(env),
    account = actor(env, q.role);
  if (q.expiresAt <= Date.now()) fail(409, "Preview expired. Request a fresh quote.");
  if (
    account.address.toLowerCase() !== q.from.toLowerCase() ||
    manifest.wallets[q.role]?.toLowerCase() !== q.from.toLowerCase() ||
    ![a.collection, a.market, a.payment, a.vault].some(
      (v) => v.toLowerCase() === q.to.toLowerCase(),
    )
  )
    fail(400, "Review target or test actor changed.");
  const wallet = createWalletClient({
    account,
    chain: bscTestnet,
    transport: http(env.TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545", {
      timeout: 15000,
      retryCount: 0,
    }),
  });
  const serialized = await wallet.signTransaction({
      chain: bscTestnet,
      account,
      to: q.to,
      data: q.data,
      value: 0n,
      nonce: q.nonce,
      gas: BigInt(q.gas),
      gasPrice: BigInt(q.gasPrice),
      type: "legacy",
    }),
    hash = keccak256(serialized);
  try {
    const existing = await c.getTransaction({ hash });
    if (existing) return { hash, quote: q, alreadySubmitted: true };
  } catch {}
  const nonce = await c.getTransactionCount({ address: q.from, blockTag: "pending" });
  if (nonce !== q.nonce)
    fail(
      409,
      "The test wallet nonce changed. Refresh and review a fresh quote; this request will not be retried with a new nonce.",
    );
  await c.sendRawTransaction({ serializedTransaction: serialized });
  return { hash, quote: q, alreadySubmitted: false };
}
export async function confirmTestnetQuote(env: TestnetEnv, b: any) {
  const q = openTestnetQuote(env, b.reviewToken),
    { c } = await context(env);
  if (typeof b.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(b.hash))
    fail(400, "Enter a transaction hash.");
  let tx: any, r: any;
  try {
    [tx, r] = await Promise.all([
      c.getTransaction({ hash: b.hash }),
      c.getTransactionReceipt({ hash: b.hash }),
    ]);
  } catch {
    return { status: "pending", hash: b.hash };
  }
  if (
    tx.from.toLowerCase() !== q.from.toLowerCase() ||
    tx.to?.toLowerCase() !== q.to.toLowerCase() ||
    tx.input.toLowerCase() !== q.data.toLowerCase() ||
    tx.nonce !== q.nonce ||
    tx.value !== 0n
  )
    fail(400, "Receipt differs from the approved test transaction.");
  const block = await c.getBlockNumber();
  if (block - r.blockNumber < 2n) return { status: "confirming", hash: b.hash };
  return {
    status: r.status === "success" ? "confirmed" : "reverted",
    hash: b.hash,
    gasUsed: r.gasUsed.toString(),
    block: r.blockNumber.toString(),
    summary: q.summary,
  };
}
export function testnetArt(id: string) {
  try {
    return new Response(nftSvg(nftTokenId(id.replace(/\.svg$/, ""))), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public,max-age=31536000,immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
