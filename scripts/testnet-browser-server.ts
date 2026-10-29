// Local-only browser fixture. Disposable Ganache keys never leave this process or enter Git.
import { spawn } from "node:child_process";
import { nftChain } from "../test/helpers/nft-chain";
import { NFT_PAYMENT, NFT_ROUTER } from "../lib/nft-protocol";
import { AGENT_ID_REGISTRY } from "../lib/protocol";
const f = await nftChain(97),
  roles = ["deployer", "alpha", "beta"];
const keys = Object.values(f.provider.getInitialAccounts()).map((a: any) => a.secretKey);
const futureToken = await f.deploy(f.m.MockToken);
const env = {
  ...process.env,
  TESTNET_MODE: "bnb-testnet",
  TESTNET_RPC_URL: f.rpc,
  TESTNET_REVIEW_SECRET: "local-browser-fixture-only-not-a-deployment-secret",
  TESTNET_DEPLOYMENT: JSON.stringify({
    chainId: 97,
    testOnly: true,
    wallets: Object.fromEntries(roles.map((r, i) => [r, f.accounts[i].address])),
    contracts: {
      registry: AGENT_ID_REGISTRY,
      payment: NFT_PAYMENT,
      futureToken,
      router: NFT_ROUTER,
      renderer: f.renderer,
      vault: f.vault,
      collection: f.collection,
      market: f.market,
    },
  }),
  TESTNET_WALLETS: JSON.stringify({
    chainId: 97,
    wallets: Object.fromEntries(
      roles.map((r, i) => [r, { address: f.accounts[i].address, privateKey: keys[i] }]),
    ),
  }),
};
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "deploy/testnet",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4174",
  ],
  { env, stdio: "inherit" },
);
const miner = setInterval(
  () => f.provider.request({ method: "evm_mine", params: [] }).catch(() => {}),
  1000,
);
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  clearInterval(miner);
  child.kill("SIGTERM");
  await f.close();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", stop);
