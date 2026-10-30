import { test, expect } from "@playwright/test";
test("Mint design controls, quantity bounds and persistent motion preference work without submitting transactions", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/nft/intents")) writes.push(r.url());
  });
  await page.goto("/#mint");
  await expect(page.locator("#collection-view")).toBeVisible();
  await expect(page.locator("#nft-gallery .nft-card")).toHaveCount(12);
  await expect(page.locator('[data-view="collection"]')).toHaveText(/Mint/);
  await expect(page.locator("#breadcrumb")).toHaveText("Mint");
  await page.getByRole("button", { name: "Preview design 42", exact: true }).click();
  await expect(page.locator("#mint-feature-image")).toHaveAttribute("src", "/api/nft/preview/v1/42.png");
  await expect(
    page.getByRole("button", { name: "Preview design 42", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Increase mint quantity", exact: true }).click();
  await expect(page.locator("#nft-quantity")).toHaveValue("2");
  await expect(page.locator("#nft-cost")).toHaveText("1 USDT");
  await page.locator("#nft-quantity").fill("10");
  await page.getByRole("button", { name: "Increase mint quantity", exact: true }).click();
  await expect(page.locator("#nft-quantity")).toHaveValue("10");
  await page.locator("#motion-toggle").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "paused");
  await page.reload();
  await expect(page.locator("#motion-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".mint-feature")).toHaveCSS("animation-name", "none");
  expect(writes).toEqual([]);
});
test("reduced-motion users can read and navigate every view with decorative animation disabled", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".mascot-float")).toHaveCSS("animation-name", "none");
  for (const view of [
    "collection",
    "marketplace",
    "wars",
    "challenges",
    "leaderboard",
    "profile",
    "docs",
    "arena",
  ]) {
    await page.locator('.nav-item[data-view="' + view + '"]').click();
    await expect(page.locator("#" + view + "-view")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy();
  }
  await expect(page.locator("#motion-toggle")).toBeDisabled();
});

test("Connect waits for the initial session instead of redirecting to an unrelated sign-in page", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/bootstrap", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/");
  await page.locator(".connect-button").click();
  expect(page.url()).not.toContain("signin-with-chatgpt");
  release();
  await expect(page.locator("#begin-pair")).toBeVisible();
  await expect(page.locator("#modal")).toBeVisible();
});
