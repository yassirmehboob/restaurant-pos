import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const state = globalThis.__posWaiterApprovalsTest = { user: null, filter: null, rows: [] };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "@/data/auth": "export async function getCurrentUser(){return globalThis.__posWaiterApprovalsTest.user}",
      "@/lib/db": "export async function connectToDatabase(){}",
      "@/models/Business": "export const Business={findById(){return{select(){return{lean:async()=>({currency:'PKR'})}}}}}",
      "@/models/WaiterRequest": "export const WaiterRequest={find(filter){globalThis.__posWaiterApprovalsTest.filter=filter;return{select(){return this},sort(){return this},lean:async()=>globalThis.__posWaiterApprovalsTest.rows}}}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});
const { GET } = await import("../app/api/pos/waiter-requests/route.ts");

test("POS approval queue requires cashier access and exposes only pending requests from the signed-in business", async () => {
  assert.equal((await GET()).status, 401);
  for (const user of [{ role: "WAITER", privileges: ["pos"] }, { role: "KITCHEN", privileges: ["pos"] }, { role: "CHEF", privileges: ["pos"] }, { role: "CASHIER", privileges: [] }]) {
    state.user = user;
    assert.equal((await GET()).status, 403);
  }
  for (const role of ["OWNER", "ADMIN", "MANAGER", "SUPERVISOR", "CASHIER"]) {
    state.user = { role, businessId: "business-a" };
    state.rows = [{ _id: "request-a", revision: 4, waiterName: "Ali", tableName: "Table 4", createdAt: new Date("2026-10-29T10:00:00Z"), displayLines: [{ name: "Soup", quantity: 2, note: "No salt", unitCost: 100 }], summary: { subtotal: 500, taxAmount: 50, grandTotal: 550 }, userId: "private-user", input: { internal: true } }];
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(state.filter, { businessId: "business-a", status: "PENDING" });
    const queue = await response.json();
    assert.equal(queue.currency, "PKR");
    assert.equal(queue.requests[0].revision, 4);
    assert.equal(queue.requests[0].summary.grandTotal, 550);
    assert.deepEqual(queue.requests[0].lines, [{ name: "Soup", quantity: 2, note: "No salt" }]);
    assert.equal("input" in queue.requests[0], false);
    assert.equal("userId" in queue.requests[0], false);
  }
});
