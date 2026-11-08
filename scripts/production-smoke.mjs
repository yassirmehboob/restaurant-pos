import assert from "node:assert/strict";

// Run against a running production build; only anonymous GET requests are sent.
const base = process.argv[2] || "http://127.0.0.1:3219";
const checks = [];
async function check(route, status, cookie) {
  const response = await fetch(new URL(route, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    headers: cookie ? { Cookie: cookie } : {},
  });
  assert.equal(response.status, status, route);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff", route);
  assert.equal(response.headers.get("x-frame-options"), "DENY", route);
  assert.equal(response.headers.get("x-powered-by"), null, route);
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  if (status === 307) assert.equal(new URL(response.headers.get("location"), base).pathname, "/login", route);
  await response.arrayBuffer();
  checks.push({ route, status, forgedCookie: Boolean(cookie) });
}
for (const route of ["/login", "/signup", "/manifest.webmanifest"]) await check(route, 200);
for (const route of ["/dashboard", "/pos", "/orders", "/kitchen", "/reports", "/users", "/security", "/settings/backups", "/settings/business", "/waiter", "/waiter-requests"]) await check(route, 307);
for (const route of ["/api/reports/sales.csv", "/api/images/000000000000000000000000", "/api/staff-photos/000000000000000000000000", "/api/backups"]) await check(route, 401);
await check("/dashboard", 307, "restaurant_pos_session=forged.owner.token");
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
