import fs from "node:fs";
fs.mkdirSync("deploy/testnet/app/generated", { recursive: true });
for (const n of ["nft-testnet", "nft-protocol", "nft-art", "game"])
  fs.copyFileSync("lib/" + n + ".ts", "deploy/testnet/app/generated/" + n + ".ts");
fs.cpSync("public/fonts", "deploy/testnet/public/fonts", { recursive: true });
fs.cpSync("public/brand", "deploy/testnet/public/brand", { recursive: true });
fs.copyFileSync("public/style.css", "deploy/testnet/public/style.css");
fs.copyFileSync("public/testnet-review.js", "deploy/testnet/public/testnet-review.js");
