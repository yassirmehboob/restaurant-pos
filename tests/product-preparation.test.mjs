import assert from "node:assert/strict";
import test from "node:test";
import { productSchema } from "../lib/validation/master-data.ts";

const item = { categoryId: "0123456789abcdef01234567", name: "Burger", salePrice: 500, costPrice: 200, taxRate: 0 };

test("item preparation time is optional and blank values clear it", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.equal(productSchema.parse({ ...item, preparationTimeMinutes: value }).preparationTimeMinutes, null);
  }
});

test("item preparation time accepts whole minutes within one day", () => {
  for (const value of [1, "15", 1440]) {
    assert.equal(productSchema.parse({ ...item, preparationTimeMinutes: value }).preparationTimeMinutes, Number(value));
  }
  for (const value of [0, -1, 1.5, 1441, "invalid"]) {
    const result = productSchema.safeParse({ ...item, preparationTimeMinutes: value });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].path[0], "preparationTimeMinutes");
  }
});
