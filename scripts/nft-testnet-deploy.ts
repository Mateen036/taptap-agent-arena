// Uses disposable testnet-only keys created for this review. Never accepts a mainnet key.
import fs from "node:fs";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  getContractAddress,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
} from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
const walletFile = "/workspace/tools/binance-agentic/nft-testnet-wallets.json",
  stateFile = "/workspace/tools/binance-agentic/nft-testnet-deployment-state.json";
const wallets = JSON.parse(fs.readFileSync(walletFile, "utf8"));
if (wallets.chainId !== 97) throw Error("Testnet keys only.");
const account = privateKeyToAccount(wallets.wallets.deployer.privateKey),
  rpc = process.env.TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const transport = http(rpc, { timeout: 30000, retryCount: 2 }),
  c = createPublicClient({ chain: bscTestnet, transport }),
  w = createWalletClient({ account, chain: bscTestnet, transport });
if ((await c.getChainId()) !== 97) throw Error("Refusing non-testnet RPC.");
const router = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
if (!(await c.getCode({ address: router }))) throw Error("PancakeSwap testnet router missing.");
const sources = {
  "NibTestSupport.sol": {
    content: fs.readFileSync("contracts/testnet/NibTestSupport.sol", "utf8"),
  },
};
const output = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources,
      settings: {
        evmVersion: "paris",
        optimizer: { enabled: true, runs: 200 },
        outputSelection: {
          "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
        },
      },
    }),
    { import: (p: string) => ({ contents: fs.readFileSync("node_modules/" + p, "utf8") }) },
  ),
);
if (output.errors?.some((e: any) => e.severity === "error"))
  throw Error(
    output.errors
      .filter((e: any) => e.severity === "error")
      .map((e: any) => e.formattedMessage)
      .join("\n"),
  );
fs.mkdirSync("artifacts/testnet", { recursive: true });
for (const name of ["NibTestToken", "NibTestIdentity"]) {
  const a = output.contracts["NibTestSupport.sol"][name];
  fs.writeFileSync(
    "artifacts/testnet/" + name + ".json",
    JSON.stringify(
      {
        abi: a.abi,
        bytecode: "0x" + a.evm.bytecode.object,
        deployedBytecode: "0x" + a.evm.deployedBytecode.object,
      },
      null,
      2,
    ) + "\n",
  );
}
const load = (name: string) => JSON.parse(fs.readFileSync("artifacts/" + name + ".json", "utf8"));
const state: any = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
  : { chainId: 97, deployer: account.address, contracts: {}, transactions: {}, initialized: [] };
if (state.chainId !== 97 || state.deployer !== account.address)
  throw Error("Deployment journal mismatch.");
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
const broadcast = process.argv.includes("--broadcast");
const balance = await c.getBalance({ address: account.address });
console.log(
  JSON.stringify({
    chainId: 97,
    deployer: account.address,
    testBNB: formatEther(balance),
    broadcast,
    router,
  }),
);
if (!broadcast) {
  console.log(
    "Readiness checked. Funding requirement: 0.1 tBNB. No transactions sent. Run --broadcast after funding.",
  );
  process.exit(0);
}
if (balance < parseEther("0.01") && !Object.keys(state.contracts).length)
  throw Error(
    "The test deployer needs faucet-funded test BNB. Send 0.1 tBNB on chain97; no real BNB.",
  );
// Persist the exact signed bytes before sending. Recovery reuses the same hash and nonce.
// This journal lives outside the repository and is mode0600, like the disposable keystore.
async function submit(name: string, tx: any) {
  let journal = state.transactions[name];
  if (!journal) {
    const request = await w.prepareTransactionRequest({ ...tx, account, chain: bscTestnet });
    const serialized = await w.signTransaction(request as any),
      hash = keccak256(serialized);
    journal = { hash, serialized, nonce: request.nonce };
    state.transactions[name] = journal;
    save();
  }
  let existing;
  try {
    existing = await c.getTransaction({ hash: journal.hash });
  } catch {}
  if (!existing) {
    if (!journal.serialized)
      throw Error("Uncertain legacy submission; inspect hash before recovery: " + journal.hash);
    await c.sendRawTransaction({ serializedTransaction: journal.serialized });
  }
  console.log(JSON.stringify({ operation: name, hash: journal.hash }));
  const r = await c.waitForTransactionReceipt({
    hash: journal.hash,
    confirmations: 3,
    timeout: 180000,
  });
  if (r.status !== "success") throw Error("Testnet transaction reverted: " + name);
  return r;
}
async function deploy(name: string, artifactName: string, args: any[]) {
  if (state.contracts[name]) {
    if (!(await c.getCode({ address: state.contracts[name] })))
      throw Error("Saved deployment has no code: " + name);
    return state.contracts[name];
  }
  const a = load(artifactName),
    r = await submit("deploy:" + name, {
      data: encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args }),
    });
  if (!r.contractAddress) throw Error("Missing deployed contract: " + name);
  state.contracts[name] = r.contractAddress;
  save();
  return r.contractAddress;
}
async function once(name: string, address: any, abi: any, functionName: string, args: any[] = []) {
  if (state.initialized.includes(name)) return;
  await submit(name, { to: address, data: encodeFunctionData({ abi, functionName, args }) });
  state.initialized.push(name);
  save();
}
const registry = await deploy("registry", "testnet/NibTestIdentity", [account.address]);
const payment = await deploy("payment", "testnet/NibTestToken", [
  "Nib Test USD - no value",
  "tUSDT",
  account.address,
]);
const futureToken = await deploy("futureToken", "testnet/NibTestToken", [
  "Nib Test LP Token - no value",
  "tNIB",
  account.address,
]);
const renderer = await deploy("renderer", "NibRenderer", []),
  vault = await deploy("vault", "NibLPVault", [payment, router, account.address]),
  collection = await deploy("collection", "NibFoundry", [
    registry,
    payment,
    vault,
    renderer,
    account.address,
  ]),
  market = await deploy("market", "NibMarketplace", [collection, payment, registry]);
for (const role of ["deployer", "alpha", "beta"]) {
  const address = wallets.wallets[role].address;
  await once("eligible:" + role, registry, load("testnet/NibTestIdentity").abi, "setEligible", [
    address,
    true,
  ]);
  await once("payment:" + role, payment, load("testnet/NibTestToken").abi, "mint", [
    address,
    parseEther("100"),
  ]);
  if (role !== "deployer") {
    const existing = await c.getBalance({ address });
    if (existing < parseEther("0.01"))
      await submit("gas:" + role, { to: address, value: parseEther("0.02") });
  }
}

await once("token-to-vault", futureToken, load("testnet/NibTestToken").abi, "mint", [
  vault,
  parseEther("100"),
]);
await once("token-proposal", vault, load("NibLPVault").abi, "proposeToken", [futureToken]);
const readyAt = (await c.readContract({
  address: vault,
  abi: load("NibLPVault").abi,
  functionName: "tokenReadyAt",
})) as bigint;
const manifest = {
  chainId: 97,
  network: "BNB Smart Chain testnet",
  testOnly: true,
  binanceWalletSupported: false,
  registryMode: "test substitute, not a real Binance Agent ID",
  contracts: { registry, payment, futureToken, renderer, vault, collection, market, router },
  wallets: Object.fromEntries(
    Object.entries(wallets.wallets).map(([role, entry]: any) => [role, entry.address]),
  ),
  lpTokenReadyAt: new Date(Number(readyAt) * 1000).toISOString(),
  transactions: Object.fromEntries(
    Object.entries(state.transactions).map(([name, v]: any) => [name, v.hash]),
  ),
  createdAt: new Date().toISOString(),
};
fs.mkdirSync("docs/nft/testnet", { recursive: true });
fs.writeFileSync("docs/nft/testnet/deployment.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
