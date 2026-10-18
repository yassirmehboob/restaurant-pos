import assert from "node:assert/strict";
import test from "node:test";
import { calculateSessionTotals } from "../lib/sale-session-totals.ts";
import { startSaleSchema } from "../lib/validation/sale-session.ts";
import { resolveReportRange, saleDateFilter } from "../lib/reporting.ts";

test("closing balances distinguish total receipts from physical cash", () => {
  const totals = calculateSessionTotals(1000,
    [{ amount: 500, method: "CASH" }, { amount: 750, method: "CARD" }],
    [{ amount: 100, method: "CASH" }, { amount: 50, method: "BANK" }]);
  assert.deepEqual(totals, { sales: 1250, expenses: 150, cashSales: 500, cashExpenses: 100, balance: 2100, expectedCash: 1400, paymentCount: 2, expenseCount: 2 });
});

test("empty shifts preserve opening cash and zero-opening shifts are valid", () => {
  assert.equal(calculateSessionTotals(1500, [], []).balance, 1500);
  assert.equal(calculateSessionTotals(0, [], []).expectedCash, 0);
  assert.equal(startSaleSchema.parse({ saleDate: "2026-10-16", counterName: " Counter 1 ", openingBalance: "0" }).counterName, "Counter 1");
});

test("money arithmetic uses cents and permits an expense deficit", () => {
  const totals = calculateSessionTotals(0.1, [{ amount: 0.2, method: "CASH" }], [{ amount: 0.4, method: "CASH" }]);
  assert.equal(totals.balance, -0.1);
  assert.equal(totals.expectedCash, -0.1);
});

test("start sale rejects missing, negative, fractional-cent balances and invalid dates", () => {
  const valid = { saleDate: "2026-10-16", counterName: "Counter 1", openingBalance: "1000" };
  for (const patch of [{ openingBalance: "" }, { openingBalance: null }, { openingBalance: "-1" }, { openingBalance: "1.001" }, { openingBalance: "Infinity" }, { saleDate: "2026-02-30" }, { counterName: " " }]) {
    assert.equal(startSaleSchema.safeParse({ ...valid, ...patch }).success, false);
  }
});

test("reports filter session sales by business date and legacy sales by timestamps", () => {
  const range = resolveReportRange({ range: "CUSTOM", from: "2026-10-16", to: "2026-10-16" });
  const filter = saleDateFilter(range, "completedAt");
  assert.deepEqual(filter.$or[0], { saleDate: { $gte: "2026-10-16", $lte: "2026-10-16" } });
  assert.deepEqual(filter.$or[1].saleDate, { $exists: false });
  assert.equal(filter.$or[1].completedAt.$gte.toISOString(), "2026-10-15T19:00:00.000Z");
  assert.equal(filter.$or[1].completedAt.$lte.toISOString(), "2026-10-16T18:59:59.999Z");
});
