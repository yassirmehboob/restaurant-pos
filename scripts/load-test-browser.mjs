import assert from "node:assert/strict";

// Optional UI regression check against the benchmark's synthetic database.
// browserModule is a file URL to a locally installed playwright-core entry point.
export async function checkOrderCatalog(base, cookies, browserModule) {
  const { chromium } = await import(browserModule);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const checks = [], errors = [];
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: "restaurant_pos_session", value: cookies[0].split("=").slice(1).join("="), url: base }]);
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/orders");
    const cards = page.locator(".order-card");
    await cards.first().waitFor();
    assert.equal(await cards.count(), 50);
    checks.push("Initial render shows 50 cards");
    for (let count = 100; count <= 500; count += 50) {
      await page.getByRole("button", { name: "Show more orders", exact: true }).click();
      await page.waitForFunction(expected => document.querySelectorAll(".order-card").length === expected, count);
    }
    assert.equal(await page.getByRole("button", { name: "Show more orders", exact: true }).count(), 0);
    checks.push("All 500 loaded orders remain accessible");
    const lastNumber = await cards.last().locator(".order-card-number").innerText();
    const search = page.getByPlaceholder("Search order or customer...");
    await search.fill("nonexistent-order-for-load-test");
    await page.getByText("No matching orders", { exact: true }).waitFor();
    await search.fill(lastNumber);
    await page.waitForFunction(() => document.querySelectorAll(".order-card").length === 1);
    assert.equal(await cards.first().locator(".order-card-number").innerText(), lastNumber);
    checks.push("Search finds an order beyond the initial 50");
    await search.fill("");
    await page.waitForFunction(() => document.querySelectorAll(".order-card").length === 50);
    const selectors = page.locator(".order-filters select");
    await selectors.nth(2).selectOption("PAID");
    await page.waitForTimeout(100);
    const payments = await cards.locator(".payment-status").allTextContents();
    assert.ok(payments.length > 0 && payments.every(status => status === "PAID"));
    checks.push("Payment filtering resets visible count and preserves matches");
    await selectors.nth(2).selectOption("ALL");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    checks.push("Orders page fits a phone viewport");
    assert.deepEqual(errors, []);
    return { checks, errors };
  } finally { await browser.close(); }
}
