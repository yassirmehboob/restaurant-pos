import assert from "node:assert/strict";
import test from "node:test";
import { formatWeight,productLinePrice,weightPrice } from "../lib/weight.ts";
import { productSchema } from "../lib/validation/master-data.ts";
import { orderInputSchema } from "../lib/validation/order.ts";

const karahi = { name: "Mutton Karahi", sellBy: "WEIGHT", salePrice: 2500, costPrice: 1800 };

test("weights below 1 KG read in grams and larger weights in KG", () => {
  assert.equal(formatWeight(125), "125 g");
  assert.equal(formatWeight(250), "250 g");
  assert.equal(formatWeight(999), "999 g");
  assert.equal(formatWeight(1000), "1 KG");
  assert.equal(formatWeight(1750), "1.75 KG");
  assert.equal(formatWeight(1125), "1.125 KG");
});

test("weight prices round to the whole rupee", () => {
  assert.equal(weightPrice(2500, 1750), 4375);
  assert.equal(weightPrice(2500, 125), 313);
  assert.equal(weightPrice(2450, 333), 816);
});

test("KG items are priced from the weight and named with it", () => {
  assert.deepEqual(productLinePrice(karahi, undefined, 500), { name: "Mutton Karahi (500 g)", unitPrice: 1250, unitCost: 900, weightGrams: 500, pricePerKg: 2500 });
  assert.equal(productLinePrice(karahi, undefined, 1750).name, "Mutton Karahi (1.75 KG)");
});

test("KG items need a weight of at least 125 g, and piece items reject one", () => {
  assert.throws(() => productLinePrice(karahi, undefined, undefined), /at least 125 g/);
  assert.throws(() => productLinePrice(karahi, undefined, 100), /at least 125 g/);
  assert.throws(() => productLinePrice({ ...karahi, sellBy: "UNIT" }, undefined, 500), /not sold by weight/);
  assert.equal(productLinePrice({ ...karahi, sellBy: "UNIT" }, undefined, undefined).unitPrice, 2500);
});

test("order lines accept whole-gram weights from 125 g", () => {
  const order = { orderType: "TAKEAWAY", deliveryCharge: 0, lines: [{ kind: "PRODUCT", id: "0123456789abcdef01234567", quantity: 1, note: "", weightGrams: 125 }] };
  assert.equal(orderInputSchema.parse(order).lines[0].weightGrams, 125);
  assert.throws(() => orderInputSchema.parse({ ...order, lines: [{ ...order.lines[0], weightGrams: 100 }] }));
  assert.throws(() => orderInputSchema.parse({ ...order, lines: [{ ...order.lines[0], weightGrams: 250.5 }] }));
});

test("items sold by KG cannot have size variants", () => {
  const item = { categoryId: "0123456789abcdef01234567", name: "Mutton Karahi", salePrice: 2500, costPrice: 1800, taxRate: 0 };
  assert.equal(productSchema.parse(item).sellBy, "UNIT");
  assert.equal(productSchema.parse({ ...item, sellBy: "WEIGHT" }).sellBy, "WEIGHT");
  assert.throws(() => productSchema.parse({ ...item, sellBy: "WEIGHT", variants: [{ name: "Half", salePrice: 1250, costPrice: 900 }] }));
});
