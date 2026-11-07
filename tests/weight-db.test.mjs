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
import { Payment } from "../models/Payment.ts";

const jar = new Map();
globalThis.__weightTestCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__weightTestCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("KG items are priced, saved and reported by weight", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_weight_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { saveOrder } = await import("../app/(dashboard)/orders/actions.ts");
    const { previewPosTotals } = await import("../app/(dashboard)/pos/actions.ts");
    const { buildSalesReport } = await import("../lib/reporting.ts");
    await Promise.all([User.init(), Order.init(), SaleSession.init()]);
    const business = await Business.create({ name: "Weight test", saleTaxRate: 0 });
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234567", username: "weight.owner", role: "OWNER", passwordHash: "x" });
    await createSession({ userId: String(owner._id), businessId: String(business._id), role: "OWNER", authVersion: 0 });
    await SaleSession.create({ businessId: business._id, userId: owner._id, userNameSnapshot: owner.fullName, counterName: "Main", counterKey: "main", saleDate: "2026-11-02", openingBalance: 0 });
    const category = await Category.create({ businessId: business._id, name: "Karahi" });
    const karahi = await Product.create({ businessId: business._id, categoryId: category._id, name: "Mutton Karahi", sellBy: "WEIGHT", salePrice: 4800, costPrice: 3000 });
    const naan = await Product.create({ businessId: business._id, categoryId: category._id, name: "Naan", salePrice: 50, costPrice: 20 });
    const line = (product, extra) => ({ kind: "PRODUCT", id: String(product._id), quantity: 1, note: "", ...extra });
    const order = lines => ({ paymentMethod: "CASH", orderType: "DINE_IN", tableId: "", waiterId: "", customerId: "", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines });

    await t.test("preview prices each weight separately, rounded to the rupee", async () => {
      const result = await previewPosTotals({ paymentMethod: "CASH", deliveryCharge: 0, lines: [line(karahi, { weightGrams: 500 }), line(karahi, { weightGrams: 1750, quantity: 2 }), line(naan)] });
      assert.equal(result.ok, true, result.message);
      assert.equal(result.subtotal, 2400 + 8400 * 2 + 50);
    });

    await t.test("saved lines keep the weight, the KG price and a weighted name", async () => {
      const result = await saveOrder(order([line(karahi, { weightGrams: 500 }), line(karahi, { weightGrams: 125 }), line(naan)]));
      assert.equal(result.ok, true, result.message);
      const saved = await Order.findById(result.orderId).lean();
      const [half, small, bread] = saved.items;
      assert.deepEqual([half.nameSnapshot, half.weightGrams, half.pricePerKgSnapshot, half.unitPrice, half.unitCost], ["Mutton Karahi (500 g)", 500, 4800, 2400, 1500]);
      assert.deepEqual([small.nameSnapshot, small.weightGrams, small.unitPrice], ["Mutton Karahi (125 g)", 125, 600]);
      assert.equal(bread.weightGrams, undefined);
      assert.equal(saved.grandTotal, 2400 + 600 + 50);
    });

    await t.test("a KG item without a valid weight is refused", async () => {
      for (const extra of [{}, { weightGrams: 100 }]) assert.equal((await saveOrder(order([line(karahi, extra)]))).ok, false);
      assert.equal((await saveOrder(order([line(naan, { weightGrams: 500 })]))).ok, false);
    });

    await t.test("receipt lines print before tax and add up to the subtotal", async () => {
      const { buildPrintJob } = await import("../lib/receipt-print.ts");
      await Business.updateOne({ _id: business._id }, { $set: { saleTaxRate: 15 } });
      const result = await saveOrder(order([line(karahi, { weightGrams: 500, quantity: 2 }), line(karahi, { weightGrams: 1500, quantity: 2 }), line(karahi, { weightGrams: 3260 })]));
      assert.equal(result.ok, true, result.message);
      // A split payment: part card, part cash with change.
      const paid = { businessId: business._id, orderId: result.orderId, receivedByUserId: owner._id };
      await Payment.create([{ ...paid, idempotencyKey: "card", method: "CARD", amount: 30000, paidAt: new Date(1) }, { ...paid, idempotencyKey: "cash", method: "CASH", amount: 10075.2, tenderedAmount: 10100, changeAmount: 24.8, paidAt: new Date(2) }]);
      const job = await buildPrintJob(String(business._id), result.orderId, "customer");
      const printed = job.parts.filter(part => part.type === "command").map(part => Buffer.from(part.base64, "base64").toString("latin1")).join("");
      // Strip ESC/POS formatting (init, code page, align, bold, size, feed) to compare the visible text.
      const lines = printed.replace(/\x1b@|\x1b[taEd][\s\S]|\x1d![\s\S]/g, "").split("\n").map(row => row.trimEnd());
      for (const row of ["Cashier".padEnd(37) + "Owner", "Item", "#                    Price  Qty     Amount", "Mutton Karahi (500 g)", "1                 2,400.00    2   4,800.00", "Mutton Karahi (1.5 KG)", "2                 7,200.00    2  14,400.00", "Mutton Karahi (3.26 KG)", "3                15,648.00    1  15,648.00", "Received - Card".padEnd(33) + "30,000.00", "Received - Cash".padEnd(33) + "10,100.00", "Change".padEnd(37) + "24.80"])
        assert.ok(lines.includes(row), `receipt should contain "${row}"\n${lines.join("\n")}`);
      for (const [label, amount] of [["Subtotal", "34,848.00"], ["TOTAL", "40,075.20"]])
        assert.ok(new RegExp(`${label} +${amount}`).test(printed), `${label} should print ${amount}`);
      assert.equal((await Order.findById(result.orderId).lean()).cashierNameSnapshot, "Owner");
      await Payment.deleteMany({ orderId: result.orderId });
      await Order.deleteOne({ _id: result.orderId });
      await Business.updateOne({ _id: business._id }, { $set: { saleTaxRate: 0 } });
    });

    await t.test("reports total the weight per KG item", async () => {
      await Order.updateMany({ businessId: business._id }, { $set: { status: "COMPLETED", paymentStatus: "PAID", paidAmount: 0, dueAmount: 0 } });
      const report = await buildSalesReport(String(business._id), { range: "CUSTOM", from: "2026-11-02", to: "2026-11-02" });
      const row = report.products.find(item => item.name === "Mutton Karahi");
      assert.deepEqual([row?.quantity, row?.weightGrams, row?.revenue], [2, 625, 3000]);
    });
  } finally {
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
