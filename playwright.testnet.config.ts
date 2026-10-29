import { defineConfig } from "@playwright/test";
import fs from "node:fs";
export default defineConfig({
  testDir: "./test/browser-testnet",
  workers: 1,
  timeout: 180000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    headless: true,
    launchOptions: {
      executablePath: fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined,
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx scripts/testnet-browser-server.ts",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 45000,
  },
});
