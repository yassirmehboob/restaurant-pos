import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { User } from "../models/User.ts";
import { Business } from "../models/Business.ts";
import { Order } from "../models/Order.ts";
import { SaleSession } from "../models/SaleSession.ts";
import { Product } from "../models/Product.ts";
import { Category } from "../models/Category.ts";
import { Deal } from "../models/Deal.ts";

const jar = new Map();
globalThis.__dealWeightCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__dealWeightCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("deals can include KG items at a fixed weight", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_deal_weight_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { createDeal, updateDeal } = await import("../app/(dashboard)/master-actions.ts");
    const { saveOrder } = await import("../app/(dashboard)/orders/actions.ts");
    const { GET: exportCsv } = await import("../app/api/deals/deals.csv/route.ts");
    await Promise.all([User.init(), Order.init(), SaleSession.init()]);
    const business = await Business.create({ name: "Deal weight test", saleTaxRate: 0 });
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234567", username: "dealweight.owner", role: "OWNER", passwordHash: "x" });
    await createSession({ userId: String(owner._id), businessId: String(business._id), role: "OWNER", authVersion: 0 });
    await SaleSession.create({ businessId: business._id, userId: owner._id, userNameSnapshot: owner.fullName, counterName: "Main", counterKey: "main", saleDate: "2026-11-13", openingBalance: 0 });
    const category = await Category.create({ businessId: business._id, name: "Karahi" });
    const karahi = await Product.create({ businessId: business._id, categoryId: category._id, name: "Mutton Karahi", sellBy: "WEIGHT", salePrice: 4800, costPrice: 3000 });
    const naan = await Product.create({ businessId: business._id, categoryId: category._id, name: "Naan", salePrice: 50, costPrice: 20 });
    // Mirrors the deal form: every row posts productId, quantity and weightGrams (empty for piece items).
    const pizza = await Product.create({ businessId: business._id, categoryId: category._id, name: "Pizza", salePrice: 900, costPrice: 400, variants: [{ name: "Small", salePrice: 900, costPrice: 400 }, { name: "Large", salePrice: 1800, costPrice: 750 }] });
    const form = (name, rows) => { const data = new FormData(); data.set("name", name); data.set("salePrice", "3000"); data.set("description", ""); for (const [product, quantity, weight, size] of rows) { data.append("productId", String(product._id)); data.append("quantity", String(quantity)); data.append("weightGrams", weight === undefined ? "" : String(weight)); data.append("variantName", size ?? ""); } return data; };
    const order = lines => ({ paymentMethod: "CASH", orderType: "DINE_IN", tableId: "", waiterId: "", customerId: "", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines });

    let dealId;
    await t.test("a deal saves the weight for KG items only", async () => {
      const result = await createDeal(undefined, form("Karahi Deal", [[karahi, 1, 500], [naan, 4, undefined]]));
      assert.equal(result?.ok, true, result?.message);
      const deal = await Deal.findOne({ businessId: business._id, name: "Karahi Deal" }).lean();
      dealId = String(deal._id);
      assert.deepEqual(deal.items.map(item => [String(item.productId), item.quantity, item.weightGrams]), [[String(karahi._id), 1, 500], [String(naan._id), 4, undefined]]);
    });

    await t.test("a KG item without a weight, or below 125 g, is refused", async () => {
      const missing = await createDeal(undefined, form("No Weight", [[karahi, 1, undefined]]));
      assert.equal(missing?.ok, undefined);
      assert.match(missing?.message ?? "", /Choose a weight for Mutton Karahi/);
      const small = await createDeal(undefined, form("Too Small", [[karahi, 1, 100]]));
      assert.ok(small?.errors, "a weight under 125 g should fail validation");
      assert.equal(await Deal.countDocuments({ businessId: business._id }), 1);
    });

    await t.test("a stray weight on a piece item is dropped", async () => {
      const result = await updateDeal(dealId, undefined, form("Karahi Deal", [[karahi, 1, 1000], [naan, 2, 750]]));
      assert.equal(result?.ok, true, result?.message);
      const deal = await Deal.findById(dealId).lean();
      assert.deepEqual(deal.items.map(item => [item.quantity, item.weightGrams]), [[1, 1000], [2, undefined]]);
    });

    await t.test("an ordered deal snapshots the weighted name and weight-based cost", async () => {
      const result = await saveOrder(order([{ kind: "DEAL", id: dealId, quantity: 1, note: "" }]));
      assert.equal(result.ok, true, result.message);
      const [line] = (await Order.findById(result.orderId).lean()).items;
      assert.deepEqual(line.dealItemsSnapshot.map(item => [item.name, item.quantity, item.unitCost]), [["Mutton Karahi (1 KG)", 1, 3000], ["Naan", 2, 20]]);
      assert.equal(line.unitCost, 3000 + 2 * 20);
      assert.equal(line.unitPrice, 3000);
    });

    await t.test("an older deal saved before weights still orders", async () => {
      const old = await Deal.create({ businessId: business._id, name: "Naan Pack", salePrice: 180, items: [{ productId: naan._id, quantity: 4 }] });
      const result = await saveOrder(order([{ kind: "DEAL", id: String(old._id), quantity: 1, note: "" }]));
      assert.equal(result.ok, true, result.message);
      const [line] = (await Order.findById(result.orderId).lean()).items;
      assert.deepEqual(line.dealItemsSnapshot.map(item => [item.name, item.quantity]), [["Naan", 4]]);
    });

    let pizzaDealId;
    await t.test("an item with sizes needs one of its sizes", async () => {
      const missing = await createDeal(undefined, form("Pizza No Size", [[pizza, 1]]));
      assert.match(missing?.message ?? "", /Choose a size for Pizza/);
      const unknown = await createDeal(undefined, form("Pizza Bad Size", [[pizza, 1, undefined, "Huge"]]));
      assert.match(unknown?.message ?? "", /Choose a size for Pizza/);
      // The size is matched without case and saved as the item spells it; a size on a plain item is dropped.
      const result = await createDeal(undefined, form("Pizza Party", [[pizza, 2, undefined, "large"], [naan, 1, undefined, "Large"]]));
      assert.equal(result?.ok, true, result?.message);
      const deal = await Deal.findOne({ businessId: business._id, name: "Pizza Party" }).lean();
      pizzaDealId = String(deal._id);
      assert.deepEqual(deal.items.map(item => [item.quantity, item.variantName]), [[2, "Large"], [1, undefined]]);
    });

    await t.test("an ordered deal snapshots the size name and size cost", async () => {
      const result = await saveOrder(order([{ kind: "DEAL", id: pizzaDealId, quantity: 1, note: "" }]));
      assert.equal(result.ok, true, result.message);
      const [line] = (await Order.findById(result.orderId).lean()).items;
      assert.deepEqual(line.dealItemsSnapshot.map(item => [item.name, item.quantity, item.unitCost]), [["Pizza (Large)", 2, 750], ["Naan", 1, 20]]);
      assert.equal(line.unitCost, 2 * 750 + 20);
    });

    await t.test("the menu CSV shows the weight and size with the item name", async () => {
      const text = await (await exportCsv()).text();
      assert.match(text, /"Mutton Karahi \(1 KG\) - Qty 1, Naan - Qty 2"/);
      assert.match(text, /"Naan - Qty 4"/);
      assert.match(text, /"Pizza \(Large\) - Qty 2, Naan - Qty 1"/);
    });
  } finally {
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
