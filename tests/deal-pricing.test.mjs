import assert from "node:assert/strict";
import test from "node:test";
import { dealPricing,dealRowPrice } from "../lib/deal-pricing.ts";

const products = new Map([
  ["burger", { price: 500, cost: 250 }],
  ["pizza", { price: 900, cost: 400, sizes: [{ name: "Small", price: 900, cost: 400 }, { name: "Large", price: 1800, cost: 750 }] }],
  ["karahi", { price: 4800, cost: 3000, byWeight: true }],
]);

test("each row is priced at its size, weight and quantity", () => {
  assert.deepEqual(dealRowPrice(products.get("burger"), { productId: "burger", quantity: 2 }), { sale: 1000, cost: 500 });
  assert.deepEqual(dealRowPrice(products.get("pizza"), { productId: "pizza", quantity: 1, variantName: "Large" }), { sale: 1800, cost: 750 });
  assert.deepEqual(dealRowPrice(products.get("karahi"), { productId: "karahi", quantity: 1, weightGrams: 500 }), { sale: 2400, cost: 1500 });
});

test("rows missing an item, size, weight or quantity are not counted yet", () => {
  assert.equal(dealRowPrice(undefined, { productId: "", quantity: 1 }), null);
  assert.equal(dealRowPrice(products.get("pizza"), { productId: "pizza", quantity: 1 }), null);
  assert.equal(dealRowPrice(products.get("karahi"), { productId: "karahi", quantity: 1 }), null);
  assert.equal(dealRowPrice(products.get("burger"), { productId: "burger", quantity: 0 }), null);
  const result = dealPricing(products, [{ productId: "burger", quantity: 1 }, { productId: "pizza", quantity: 1 }]);
  assert.deepEqual([result.total, result.counted, result.complete], [500, 1, false]);
});

test("the suggested price keeps 75% of the normal profit, to the nearest Rs 10", () => {
  // Sale 1000 + 1800 + 2400 = 5200, cost 500 + 750 + 1500 = 2750: 2750 + 0.75 x 2450 = 4587.5 -> 4590.
  const result = dealPricing(products, [{ productId: "burger", quantity: 2 }, { productId: "pizza", quantity: 1, variantName: "Large" }, { productId: "karahi", quantity: 1, weightGrams: 500 }]);
  assert.deepEqual([result.total, result.cost, result.suggested, result.complete], [5200, 2750, 4590, true]);
});

test("items sold at or below cost are suggested at their total", () => {
  const free = new Map([["water", { price: 50, cost: 60 }]]);
  assert.equal(dealPricing(free, [{ productId: "water", quantity: 2 }]).suggested, 100);
  assert.equal(dealPricing(products, []).suggested, 0);
});
