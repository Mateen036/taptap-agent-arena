import { test, expect } from "@playwright/test";
test("owner review: free mint → paid mint → individual approval → listing → other-agent purchase", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#test-status")).toContainText("connected", { timeout: 30000 });
  await expect(page.locator("#test-gallery .nft-card")).toHaveCount(12);
  await expect(page.locator("#test-cost")).toContainText("FREE");
  await page.locator('[data-inspect="1"]').first().click();
  await expect(page.locator("#test-modal")).toBeVisible();
  await page.locator("#test-modal-close").click();
  async function approve() {
    await expect(page.locator("#test-modal")).toBeVisible();
    await expect(page.locator("#test-modal")).toContainText("BNB TESTNET 97");
    await page.locator("#test-quote-approve").click();
    await expect(page.locator("#test-modal")).not.toBeVisible();
    await expect(page.locator("#test-records .review-receipt").first()).toContainText("confirmed", {
      timeout: 30000,
    });
  }
  await page.locator("#test-mint-request").click();
  await approve();
  await expect(page.locator("#test-wallet-note")).toContainText("1/10");
  await page.locator("#test-mint-approval").click();
  await approve();
  await page.locator("#test-mint-request").click();
  await approve();
  await expect(page.locator("#test-wallet-note")).toContainText("2/10");
  await page.locator('[data-test-view="wallet"]').click();
  await expect(page.locator("#test-owned .nft-card")).toHaveCount(2);
  await page.locator('[data-sell="1"]').click();
  await page.locator("#test-approve-nft").click();
  await approve();
  await page.locator('[data-sell="1"]').click();
  await page.locator("#test-list-nft").click();
  await approve();
  await page.locator("#test-role").selectOption("beta");
  await expect(page.locator("#test-wallet-address")).not.toHaveText("");
  await page.locator('[data-test-view="market"]').click();
  await expect(page.locator("#test-listings .nft-card")).toHaveCount(1);
  await page.locator('[data-buy="1"]').click();
  await page.locator("#test-buy-approval").click();
  await approve();
  await page.locator('[data-buy="1"]').click();
  await page.locator("#test-buy-submit").click();
  await approve();
  await page.locator('[data-test-view="wallet"]').click();
  await expect(page.locator("#test-owned .nft-card")).toHaveCount(1);
  await expect(page.locator("#test-owned")).toContainText("00001");
  await page.locator('[data-test-view="lp"]').click();
  await expect(page.locator("#test-lp-state")).toContainText("1 tUSDT in vault");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-test-view="plan"]').click();
  await expect(page.locator("#test-plan")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const body = await page.content();
  expect(body).not.toContain("privateKey");
  expect(errors).toEqual([]);
});

test("funding-pending review remains navigable with all designs and honest disabled mint", async ({
  page,
}) => {
  await page.route("**/api/review?*", async (route) => {
    const r = await route.fetch(),
      s = await r.json();
    await route.fulfill({
      json: {
        ...s,
        configured: false,
        wallet: undefined,
        owned: [],
        listings: [],
        market: undefined,
        lp: undefined,
        funding: { address: s.wallets.deployer, testBNB: "0" },
      },
    });
  });
  await page.goto("/");
  await expect(page.locator("#test-funding")).toBeVisible();
  await expect(page.locator("#test-mint-request")).toBeDisabled();
  await page.locator("#test-next").click();
  await expect(page.locator("#test-page")).toContainText("Page 2");
  await expect(page.locator("#test-gallery")).toContainText("00013");
  await page.locator('[data-test-view="market"]').click();
  await expect(page.locator("#test-listings")).toContainText("No available test listings");
});
