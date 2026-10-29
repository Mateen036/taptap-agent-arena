import fs from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { bscTestnet } from "viem/chains";
import { normalizeRuntime } from "./nft-deploy";
import { nftAbi, nftMarketAbi, nftVaultAbi } from "../lib/nft-protocol";
const manifest = JSON.parse(fs.readFileSync("docs/nft/testnet/deployment.json", "utf8"));
if (manifest.chainId !== 97 || manifest.testOnly !== true)
  throw Error("Testnet manifest required.");
const c = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545"),
});
if ((await c.getChainId()) !== 97) throw Error("Refusing another chain.");
const a = manifest.contracts,
  art = (name: string) => JSON.parse(fs.readFileSync("artifacts/" + name + ".json", "utf8"));
const names = {
  registry: "testnet/NibTestIdentity",
  payment: "testnet/NibTestToken",
  futureToken: "testnet/NibTestToken",
  renderer: "NibRenderer",
  vault: "NibLPVault",
  collection: "NibFoundry",
  market: "NibMarketplace",
};
for (const [key, name] of Object.entries(names)) {
  const code = await c.getCode({ address: a[key] }),
    artifact = art(name);
  if (!code || normalizeRuntime(code, artifact) !== artifact.deployedBytecode)
    throw Error("Unexpected deployed runtime: " + key);
}
const ownerAbi = parseAbi(["function owner() view returns(address)"]);
const r = (address: any, abi: any, functionName: string, args: any[] = []) =>
  c.readContract({ address, abi, functionName, args } as any);
const values = await Promise.all([
  r(a.collection, nftAbi, "paymentToken"),
  r(a.collection, nftAbi, "agentIdRegistry"),
  r(a.collection, nftAbi, "lpVault"),
  r(a.collection, nftAbi, "renderer"),
  r(a.market, nftMarketAbi, "collection"),
  r(a.market, nftMarketAbi, "paymentToken"),
  r(a.vault, nftVaultAbi, "router"),
  r(a.collection, ownerAbi, "owner"),
  r(a.vault, ownerAbi, "owner"),
]);
const expected = [
  a.payment,
  a.registry,
  a.vault,
  a.renderer,
  a.collection,
  a.payment,
  a.router,
  manifest.wallets.deployer,
  manifest.wallets.deployer,
];
if (values.some((v, i) => String(v).toLowerCase() !== expected[i].toLowerCase()))
  throw Error("Contract links or ownership mismatch.");
console.log(
  JSON.stringify(
    {
      verified: true,
      chainId: 97,
      testOnly: true,
      contracts: a,
      lpTokenReadyAt: manifest.lpTokenReadyAt,
    },
    null,
    2,
  ),
);
