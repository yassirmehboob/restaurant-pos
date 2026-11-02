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
import { Customer } from "../models/Customer.ts";
import { SmsMessage } from "../models/SmsMessage.ts";
import { encryptSmsToken } from "../lib/sms-crypto.mjs";
import { runSmsDeliveryTick } from "../lib/sms-delivery.mjs";
import { advanceKitchenOrders } from "../lib/kitchen-timing.mjs";

const jar = new Map();
globalThis.__orderSmsTestCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__orderSmsTestCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("dine-in and takeaway customers get order placed and order ready texts; walk-ins get none", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_order_sms_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { saveOrder, changeOrderStatus, completeTakeawayPayment } = await import("../app/(dashboard)/orders/actions.ts");
    const { saveOrderSmsSettings } = await import("../app/(dashboard)/settings/business/sms-actions.ts");
    await Promise.all([User.init(), Order.init(), SaleSession.init(), SmsMessage.init()]);
    const secret = process.env.AUTH_SECRET;
    const business = await Business.create({ name: "Indus Grill", saleTaxRate: 0, smsEnabled: true });
    await Business.updateOne({ _id: business._id }, { $set: { smsTokenEncrypted: encryptSmsToken("token-order", secret, String(business._id)) } });
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234567", username: "order.sms.owner", role: "OWNER", passwordHash: "x" });
    await createSession({ userId: String(owner._id), businessId: String(business._id), role: "OWNER", authVersion: 0 });
    await SaleSession.create({ businessId: business._id, userId: owner._id, userNameSnapshot: owner.fullName, counterName: "Main", counterKey: "main", saleDate: "2026-11-02", openingBalance: 0 });
    const category = await Category.create({ businessId: business._id, name: "Mains" });
    const karahi = await Product.create({ businessId: business._id, categoryId: category._id, name: "Karahi", salePrice: 1500, costPrice: 700 });
    const ali = await Customer.create({ businessId: business._id, name: "Ali", phone: "0313 3551379" });
    const order = (orderType, customerId = "") => ({ paymentMethod: "CASH", orderType, tableId: "", waiterId: "", customerId, deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines: [{ kind: "PRODUCT", id: String(karahi._id), quantity: 1, note: "" }] });
    const message = (config = {}) => ({ enabled: true, includeOptOut: false, dineIn: true, takeaway: true, ...config });
    const settings = (placed, ready) => saveOrderSmsSettings({ placed: message({ template: "Hi {{customer_name}}, {{order_number}} placed. Total {{currency}} {{order_total}}.", ...placed }), ready: message({ template: "{{order_number}} is ready at {{business_name}}.", ...ready }) });
    const texts = async orderId => (await SmsMessage.find({ orderId }).lean()).map(row => row.messageType).sort();

    await t.test("settings need dine-in, takeaway or both when a message is on", async () => {
      assert.equal((await settings({ dineIn: false, takeaway: false }, {})).ok, false);
      assert.equal((await settings({}, { template: "{{unknown}}" })).ok, false);
      assert.equal((await settings({}, {})).ok, true);
      const saved = (await Business.findById(business._id).lean()).smsOrderMessages;
      assert.deepEqual([saved.placed.enabled, saved.placed.dineIn, saved.ready.takeaway], [true, true, true]);
    });

    let dineInId;
    await t.test("a dine-in order with a customer is texted once when placed, even after edits", async () => {
      const placed = await saveOrder(order("DINE_IN", String(ali._id)));
      assert.equal(placed.ok, true, placed.message);
      dineInId = placed.orderId;
      const [row] = await SmsMessage.find({ orderId: dineInId }).lean();
      assert.equal(row.messageType, "ORDER_PLACED"); assert.equal(row.status, "PENDING"); assert.equal(row.to, "+923133551379");
      assert.match(row.body, /^Hi Ali, ORD-\d+ placed\. Total PKR 1500\.00\.$/);
      assert.equal((await saveOrder(order("DINE_IN", String(ali._id)), dineInId)).ok, true);
      assert.deepEqual(await texts(dineInId), ["ORDER_PLACED"]);
    });

    await t.test("walk-in orders are never texted or logged", async () => {
      const walkIn = await saveOrder(order("DINE_IN"));
      assert.equal(walkIn.ok, true, walkIn.message);
      assert.equal((await changeOrderStatus(walkIn.orderId, "READY")).ok, true);
      assert.deepEqual(await texts(walkIn.orderId), []);
    });

    await t.test("marking the order ready in the kitchen sends the ready text", async () => {
      assert.equal((await changeOrderStatus(dineInId, "READY")).ok, true);
      const ready = await SmsMessage.findOne({ orderId: dineInId, messageType: "ORDER_READY" }).lean();
      assert.match(ready.body, /^ORD-\d+ is ready at Indus Grill\.$/);
    });

    await t.test("a paid takeaway is texted as placed alongside its payment, and the kitchen timer sends ready", async () => {
      const paid = await completeTakeawayPayment(order("TAKEAWAY", String(ali._id)), { idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: 1500, tenderedAmount: 1500, reference: "", notes: "" });
      assert.equal(paid.ok, true, paid.message);
      assert.deepEqual(await texts(paid.orderId), ["ORDER_PLACED"]);
      await Order.updateOne({ _id: paid.orderId }, { $set: { status: "PREPARING", preparingAt: new Date(Date.now() - 3600_000) } });
      const timed = await Business.findByIdAndUpdate(business._id, { $set: { kitchenTimingEnabled: true, kitchenReadyDelayMinutes: 5 } }, { returnDocument: "after" }).lean();
      assert.equal(await advanceKitchenOrders(mongoose.connection.db, timed), 1);
      assert.deepEqual(await texts(paid.orderId), ["ORDER_PLACED", "ORDER_READY"]);
      await Business.updateOne({ _id: business._id }, { $set: { kitchenTimingEnabled: false } });
    });

    await t.test("switching off dine-in stops dine-in texts but not takeaway", async () => {
      assert.equal((await settings({ dineIn: false }, { dineIn: false })).ok, true);
      const quiet = await saveOrder(order("DINE_IN", String(ali._id)));
      assert.equal((await changeOrderStatus(quiet.orderId, "READY")).ok, true);
      assert.deepEqual(await texts(quiet.orderId), []);
    });

    await t.test("the sender delivers the texts and skips orders cancelled before sending", async () => {
      await settings({}, {});
      const pending = await saveOrder(order("DINE_IN", String(ali._id)));
      await Order.updateOne({ _id: pending.orderId }, { $set: { status: "CANCELLED" } });
      const calls = [];
      await runSmsDeliveryTick(mongoose.connection.db, { secret, base: "https://sms.example.test/", fetcher: async (url, options) => { calls.push(JSON.parse(options.body)); return new Response("{}", { status: 202 }); } });
      assert.equal(calls.length, 4, "two dine-in and two takeaway texts");
      assert.ok(calls.every(call => call.to === "+923133551379" && call.includeOptOut === false));
      const skipped = await SmsMessage.findOne({ orderId: pending.orderId }).lean();
      assert.deepEqual([skipped.status, skipped.failureCode], ["SKIPPED", "ORDER_UNAVAILABLE"]);
    });
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
