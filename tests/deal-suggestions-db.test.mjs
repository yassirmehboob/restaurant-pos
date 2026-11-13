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
globalThis.__dealSuggestCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__dealSuggestCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("suggested deals rank real sales and save through the deal form", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_deal_suggest_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { createDeal } = await import("../app/(dashboard)/master-actions.ts");
    const { saveOrder } = await import("../app/(dashboard)/orders/actions.ts");
    const { productUnitsSold } = await import("../lib/deal-sales.ts");
    const { suggestDeals } = await import("../lib/deal-suggestions.ts");
    await Promise.all([User.init(), Order.init(), SaleSession.init()]);
    const business = await Business.create({ name: "Suggest test", saleTaxRate: 0 });
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234567", username: "suggest.owner", role: "OWNER", passwordHash: "x" });
    await createSession({ userId: String(owner._id), businessId: String(business._id), role: "OWNER", authVersion: 0 });
    await SaleSession.create({ businessId: business._id, userId: owner._id, userNameSnapshot: owner.fullName, counterName: "Main", counterKey: "main", saleDate: "2026-11-13", openingBalance: 0 });
    const cat = async name => Category.create({ businessId: business._id, name });
    const [burgers, pizza, sides, drinks, desi] = await Promise.all(["Burgers", "Pizza", "Fries & Sides", "Drinks", "Desi Mix"].map(cat));
    const add = (category, name, extra = {}) => Product.create({ businessId: business._id, categoryId: category._id, name, salePrice: 500, costPrice: 250, ...extra });
    const zinger = await add(burgers, "Zinger Burger");
    const beef = await add(burgers, "Beef Burger");
    const bbq = await add(pizza, "BBQ Pizza", { variants: [{ name: "Small", salePrice: 600, costPrice: 400 }, { name: "Medium", salePrice: 800, costPrice: 700 }, { name: "Large", salePrice: 1200, costPrice: 1000 }] });
    const fries = await add(sides, "French Fries", { salePrice: 250, costPrice: 100 });
    const pepsi = await add(drinks, "Pepsi", { salePrice: 120, costPrice: 80, variants: [{ name: "Tin", salePrice: 120, costPrice: 80 }, { name: "1.5 ltr", salePrice: 260, costPrice: 180 }] });
    const karahi = await add(desi, "Mutton Karahi", { sellBy: "WEIGHT", salePrice: 4800, costPrice: 3500 });
    const order = lines => ({ paymentMethod: "CASH", orderType: "DINE_IN", tableId: "", waiterId: "", customerId: "", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines });
    const line = (product, quantity, extra = {}) => ({ kind: "PRODUCT", id: String(product._id), quantity, note: "", ...extra });
    const pay = async lines => { const result = await saveOrder(order(lines)); assert.equal(result.ok, true, result.message); await Order.updateOne({ _id: result.orderId }, { $set: { paymentStatus: "PAID" } }); return result.orderId; };

    await t.test("units sold count paid orders and items inside deals, not unpaid ones", async () => {
      await pay([line(beef, 3), line(fries, 2)]);
      await pay([line(bbq, 2, { variantName: "Large" }), line(pepsi, 4, { variantName: "Tin" })]);
      const combo = await Deal.create({ businessId: business._id, name: "Beef Combo", salePrice: 700, items: [{ productId: beef._id, quantity: 2 }, { productId: fries._id, quantity: 1 }] });
      await pay([{ kind: "DEAL", id: String(combo._id), quantity: 2, note: "" }]);
      const unpaid = await saveOrder(order([line(zinger, 50)]));
      assert.equal(unpaid.ok, true, unpaid.message);
      const sold = await productUnitsSold(String(business._id));
      // Beef: 3 alone + 2 per deal x 2 deals. Fries: 2 + 1 x 2. The unpaid Zinger order does not count.
      assert.deepEqual([sold.get(String(beef._id)), sold.get(String(fries._id)), sold.get(String(bbq._id)), sold.get(String(pepsi._id)), sold.get(String(zinger._id))], [7, 4, 2, 4, undefined]);
      const old = await Order.findOne({ businessId: business._id, paymentStatus: "PAID" }).sort({ _id: 1 });
      await Order.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) } });
      assert.equal((await productUnitsSold(String(business._id))).get(String(beef._id)), 4, "orders older than 90 days are left out");
    });

    await t.test("every suggestion saves through the real deal form action", async () => {
      const sold = await productUnitsSold(String(business._id));
      const products = await Product.find({ businessId: business._id }).populate("categoryId").lean();
      const menu = products.map((product, index) => ({ id: String(product._id), name: product.name, category: product.categoryId.name, price: product.salePrice, cost: product.costPrice, byWeight: product.sellBy === "WEIGHT", sizes: (product.variants ?? []).map(size => ({ name: size.name, price: size.salePrice, cost: size.costPrice })), sold: sold.get(String(product._id)) ?? 0, menuOrder: index }));
      const before = await Deal.countDocuments({ businessId: business._id });
      for (const persons of [1, 2, 4, 7]) {
        const { regular } = suggestDeals(menu, persons);
        assert.ok(regular.length >= 3, `ideas for ${persons}`);
        assert.equal(regular[0].items[0].productId, String(beef._id), "the best seller leads");
        for (const deal of regular) {
          const data = new FormData();
          data.set("name", `${deal.name} ${persons}`); data.set("salePrice", String(deal.price)); data.set("description", deal.description);
          for (const item of deal.items) { data.append("productId", item.productId); data.append("quantity", String(item.quantity)); data.append("weightGrams", item.weightGrams ? String(item.weightGrams) : ""); data.append("variantName", item.variantName ?? ""); }
          const result = await createDeal(undefined, data);
          assert.equal(result?.ok, true, `${deal.name} for ${persons}: ${result?.message ?? JSON.stringify(result?.errors)}`);
        }
      }
      const saved = await Deal.find({ businessId: business._id, _id: { $nin: (await Deal.find({ businessId: business._id }).sort({ _id: 1 }).limit(before).lean()).map(deal => deal._id) } }).lean();
      const karahiDeal = saved.find(deal => deal.name.startsWith("Mutton Karahi Family Deal 4"));
      assert.deepEqual(karahiDeal.items.map(item => [String(item.productId), item.weightGrams]), [[String(karahi._id), 1000], [String(pepsi._id), undefined]]);
      assert.equal(karahiDeal.items[1].variantName, "1.5 ltr");
    });
  } finally {
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
