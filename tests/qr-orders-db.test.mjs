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
import { RestaurantTable } from "../models/RestaurantTable.ts";
import { Staff } from "../models/Staff.ts";
import { WaiterRequest } from "../models/WaiterRequest.ts";
import { SmsMessage } from "../models/SmsMessage.ts";
import { encryptSmsToken } from "../lib/sms-crypto.mjs";
import { advanceKitchenOrders } from "../lib/kitchen-timing.mjs";

const jar = new Map();
globalThis.__qrTestCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__qrTestCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("QR table orders: guest submits, cashier prints, approves or cancels, and the guest is texted at every stage", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_qr_orders_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { confirmWaiterRequest, cancelWaiterRequest, changeOrderStatus } = await import("../app/(dashboard)/orders/actions.ts");
    const { completeOrderPayment } = await import("../app/(dashboard)/payments/actions.ts");
    const { saveOrderSmsSettings } = await import("../app/(dashboard)/settings/business/sms-actions.ts");
    const { saveQrOrderingSettings, regenerateTableQr } = await import("../app/(dashboard)/settings/business/qr-actions.ts");
    const { resolveQrTable, guestMenu, submitGuestOrder, guestOrderStatus, previewGuestOrder, newQrToken, QR_LIMITS } = await import("../lib/qr-menu.ts");
    const { buildQrSlipJob } = await import("../lib/receipt-print.ts");
    await Promise.all([User.init(), Order.init(), SaleSession.init(), SmsMessage.init(), WaiterRequest.init(), RestaurantTable.init()]);
    const secret = process.env.AUTH_SECRET;
    const business = await Business.create({ name: "Indus Grill", saleTaxRate: 10, smsEnabled: true, smsPaymentReceiptEnabled: true, smsPaymentTemplate: "Paid {{currency}} {{amount_paid}} for {{order_number}}." });
    await Business.updateOne({ _id: business._id }, { $set: { smsTokenEncrypted: encryptSmsToken("token-qr", secret, String(business._id)) } });
    const other = await Business.create({ name: "Other Place", qrOrderingEnabled: true });
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234567", username: "qr.owner", role: "OWNER", passwordHash: "x" });
    await createSession({ userId: String(owner._id), businessId: String(business._id), role: "OWNER", authVersion: 0 });
    await SaleSession.create({ businessId: business._id, userId: owner._id, userNameSnapshot: owner.fullName, counterName: "Main", counterKey: "main", saleDate: "2026-11-03", openingBalance: 0 });
    const category = await Category.create({ businessId: business._id, name: "Mains" });
    const karahi = await Product.create({ businessId: business._id, categoryId: category._id, name: "Karahi", description: "Chicken karahi", salePrice: 1500, costPrice: 700, imageUrl: "/api/images/" + new mongoose.Types.ObjectId() });
    const mutton = await Product.create({ businessId: business._id, categoryId: category._id, name: "Mutton", salePrice: 2000, costPrice: 1200, sellBy: "WEIGHT" });
    const hidden = await Product.create({ businessId: business._id, categoryId: category._id, name: "Sold out", salePrice: 100, costPrice: 50, isAvailable: false });
    const table = await RestaurantTable.create({ businessId: business._id, name: "Table 5", number: 5, qrToken: newQrToken() });
    const table6 = await RestaurantTable.create({ businessId: business._id, name: "Table 6", number: 6, qrToken: newQrToken() });
    const otherTable = await RestaurantTable.create({ businessId: other._id, name: "Table 1", number: 1, qrToken: newQrToken() });
    const existing = await Customer.create({ businessId: business._id, name: "Ali (regular)", phone: "0313 3551379" });
    const stage = { enabled: true, includeOptOut: false, dineIn: true, takeaway: true };
    assert.equal((await saveOrderSmsSettings({ placed: { ...stage, template: "{{order_number}} placed" }, preparing: { ...stage, template: "{{order_number}} preparing" }, ready: { ...stage, template: "{{order_number}} ready" }, served: { ...stage, template: "{{order_number}} served" }, completed: { ...stage, template: "{{order_number}} completed" } })).ok, true);
    const lines = [{ kind: "PRODUCT", id: String(karahi._id), quantity: 2, note: "less spicy" }, { kind: "PRODUCT", id: String(mutton._id), weightGrams: 500, quantity: 1, note: "" }];
    const guest = (extra = {}) => ({ submissionKey: randomUUID(), language: "ur", name: "Ali", phone: "03133551379", lines, ...extra });
    const texts = async orderId => (await SmsMessage.find({ orderId }).lean()).map(row => row.messageType).sort();
    let ip = 0;
    const address = () => `10.0.0.${++ip}`;

    await t.test("ordering is off until the owner switches it on", async () => {
      assert.equal((await resolveQrTable(table.qrToken)).business.enabled, false);
      assert.deepEqual(await submitGuestOrder(table.qrToken, guest(), address()), { ok: false, code: "CLOSED" });
      assert.equal((await saveQrOrderingSettings({ enabled: true, showSummary: true, baseUrl: "not a url" })).ok, false);
      assert.equal((await saveQrOrderingSettings({ enabled: true, showSummary: true, baseUrl: "http://192.168.1.10:3000/" })).baseUrl, "http://192.168.1.10:3000");
    });

    await t.test("no QR orders while every counter is closed", async () => {
      await SaleSession.updateMany({ businessId: business._id }, { $set: { status: "CLOSED" } });
      assert.equal((await resolveQrTable(table.qrToken)).business.countersOpen, false);
      assert.deepEqual(await submitGuestOrder(table.qrToken, guest(), address()), { ok: false, code: "COUNTER_CLOSED" });
      assert.equal(await previewGuestOrder(table.qrToken, { lines }, address()), null);
      await SaleSession.updateMany({ businessId: business._id }, { $set: { status: "OPEN" } });
      assert.equal((await resolveQrTable(table.qrToken)).business.countersOpen, true);
    });

    await t.test("an edited or unknown link matches no table", async () => {
      const tampered = table.qrToken.slice(0, -1) + (table.qrToken.endsWith("A") ? "B" : "A");
      for (const token of [tampered, "x", "../../api", String(table._id)]) assert.equal(await resolveQrTable(token), null);
      assert.deepEqual(await submitGuestOrder(tampered, guest(), address()), { ok: false, code: "INVALID" });
    });

    await t.test("the guest menu lists available items with prices and token-scoped photos", async () => {
      const context = await resolveQrTable(table.qrToken);
      assert.deepEqual([context.table.name, context.business.name, context.business.showSummary], ["Table 5", "Indus Grill", true]);
      const menu = await guestMenu(table.qrToken, context);
      assert.deepEqual(menu.items.map(item => item.name).sort(), ["Karahi", "Mutton"]);
      assert.ok(!menu.items.some(item => item.id === String(hidden._id)));
      const item = menu.items.find(row => row.name === "Karahi");
      assert.equal(item.price, 1500);
      assert.match(item.imageUrl, new RegExp(`^/api/menu/${table.qrToken}/images/[a-f0-9]{24}$`));
      const preview = await previewGuestOrder(table.qrToken, { lines }, address());
      assert.deepEqual([preview.subtotal, preview.taxAmount, preview.grandTotal], [4000, 400, 4400]);
    });

    await t.test("bad details are refused with a code the phone can translate", async () => {
      assert.equal((await submitGuestOrder(table.qrToken, guest({ phone: "12345" }), address())).code, "PHONE");
      assert.equal((await submitGuestOrder(table.qrToken, guest({ name: " " }), address())).code, "NAME");
      assert.equal((await submitGuestOrder(table.qrToken, guest({ lines: [] }), address())).code, "EMPTY");
      assert.equal((await submitGuestOrder(table.qrToken, guest({ lines: [{ kind: "PRODUCT", id: String(hidden._id), quantity: 1, note: "" }] }), address())).code, "UNAVAILABLE");
      assert.equal((await submitGuestOrder(table.qrToken, guest({ lines: [{ kind: "PRODUCT", id: String(mutton._id), quantity: 1, note: "" }] }), address())).code, "UNAVAILABLE");
      assert.equal(await WaiterRequest.countDocuments(), 0);
    });

    let first;
    await t.test("a valid order waits for the cashier, on the table from the code, priced by the server", async () => {
      const body = guest({ tableId: String(table6._id), businessId: String(other._id), unitPrice: 1 });
      first = await submitGuestOrder(table.qrToken, body, address());
      assert.equal(first.ok, true);
      assert.deepEqual(await submitGuestOrder(table.qrToken, body, address()), first, "a repeated tap returns the same order");
      const saved = await WaiterRequest.findById(first.id).lean();
      assert.deepEqual([saved.source, saved.status, saved.tableName, String(saved.tableId), String(saved.businessId), saved.guest.phone, saved.guest.language], ["QR", "PENDING", "Table 5", String(table._id), String(business._id), "+923133551379", "ur"]);
      assert.equal(saved.summary.grandTotal, 4400);
      assert.deepEqual(saved.displayLines.map(line => [line.name, line.quantity, line.unitPrice]), [["Karahi", 2, 1500], ["Mutton (500 g)", 1, 1000]]);
      const status = await guestOrderStatus(table.qrToken, first.id, first.key);
      assert.equal(status.stage, "WAITING");
      assert.equal(status.summary.grandTotal, 4400);
      assert.equal(await guestOrderStatus(table.qrToken, first.id, randomUUID()), null, "another phone cannot read the order");
      assert.equal(await guestOrderStatus(otherTable.qrToken, first.id, first.key), null);
    });

    await t.test("the cashier can print a slip while the order is pending", async () => {
      const job = await buildQrSlipJob(String(business._id), first.id);
      assert.equal(job.role, "customer");
      const text = Buffer.from(job.parts[0].base64, "base64").toString("latin1");
      for (const expected of ["QR ORDER - PLEASE CONFIRM", "Table 5", "Ali", "Karahi", "less spicy", "This is not a bill."]) assert.ok(text.includes(expected), expected);
      assert.ok("error" in await buildQrSlipJob(String(other._id), first.id), "slips stay inside the business");
    });

    await t.test("pending orders per phone are capped", async () => {
      const second = await submitGuestOrder(table.qrToken, guest(), address());
      assert.equal(second.ok, true);
      assert.deepEqual(await submitGuestOrder(table6.qrToken, guest(), address()), { ok: false, code: "LIMIT" });
      assert.equal((await cancelWaiterRequest(second.id, 0, "no")).ok, false, "a reason is required");
      assert.equal((await cancelWaiterRequest(second.id, 0, "Nobody at the table")).ok, true);
      assert.equal((await guestOrderStatus(table.qrToken, second.id, second.key)).stage, "CANCELLED");
      assert.equal((await confirmWaiterRequest(second.id, 1)).ok, false, "a cancelled order cannot be approved");
      assert.equal((await cancelWaiterRequest(second.id, 1, "Again please")).ok, false);
    });

    let orderId;
    await t.test("approval sends it to the kitchen tagged QR, linked to the existing customer, and texts 'placed'", async () => {
      const result = await confirmWaiterRequest(first.id, 0);
      assert.equal(result.ok, true, result.message);
      orderId = result.orderId;
      const order = await Order.findById(orderId).lean();
      assert.deepEqual([order.orderSource, order.status, order.orderType, order.tableNameSnapshot, order.waiterNameSnapshot, String(order.customerId), order.customerSnapshot.phone, order.grandTotal], ["QR", "SENT_TO_KITCHEN", "DINE_IN", "Table 5", undefined, String(existing._id), "0313 3551379", 4400]);
      assert.equal(await Customer.countDocuments({ businessId: business._id }), 1, "no duplicate customer for a known number");
      assert.deepEqual(await texts(orderId), ["ORDER_PLACED"]);
      assert.equal((await guestOrderStatus(table.qrToken, first.id, first.key)).stage, "CONFIRMED");
      assert.equal((await cancelWaiterRequest(first.id, 1, "Too late now")).ok, false, "approved orders are cancelled from Orders instead");
      assert.ok("error" in await buildQrSlipJob(String(business._id), first.id));
    });

    await t.test("each kitchen stage and the payment texts the guest once", async () => {
      await Order.updateOne({ _id: orderId }, { $set: { kitchenSentAt: new Date(Date.now() - 3600_000) } });
      const timed = await Business.findByIdAndUpdate(business._id, { $set: { kitchenTimingEnabled: true, kitchenPreparingDelaySeconds: 60, kitchenReadyDelayMinutes: 600 } }, { returnDocument: "after" }).lean();
      assert.equal(await advanceKitchenOrders(mongoose.connection.db, timed), 1);
      await Business.updateOne({ _id: business._id }, { $set: { kitchenTimingEnabled: false } });
      assert.deepEqual(await texts(orderId), ["ORDER_PLACED", "ORDER_PREPARING"]);
      assert.equal((await guestOrderStatus(table.qrToken, first.id, first.key)).stage, "PREPARING");
      assert.equal((await changeOrderStatus(orderId, "READY")).ok, true);
      assert.equal((await changeOrderStatus(orderId, "SERVED")).ok, true);
      assert.equal((await guestOrderStatus(table.qrToken, first.id, first.key)).stage, "SERVED");
      const paid = await completeOrderPayment({ orderId, idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: 4400, tenderedAmount: 5000, reference: "", notes: "" });
      assert.equal(paid.ok, true, paid.message);
      assert.deepEqual(await texts(orderId), ["ORDER_COMPLETED", "ORDER_PLACED", "ORDER_PREPARING", "ORDER_READY", "ORDER_SERVED", "PAYMENT_RECEIPT"]);
      const done = await guestOrderStatus(table.qrToken, first.id, first.key);
      assert.deepEqual([done.stage, done.paid], ["COMPLETED", true]);
      assert.match((await SmsMessage.findOne({ orderId, messageType: "ORDER_SERVED" }).lean()).body, /^ORD-\d+ served$/);
    });

    await t.test("a new guest number becomes a customer on approval", async () => {
      const order = await submitGuestOrder(table6.qrToken, guest({ name: "Sana", phone: "+92 300 7654321" }), address());
      assert.equal(order.ok, true);
      const bilal = await Staff.create({ businessId: business._id, fullName: "Bilal", role: "WAITER" });
      const chef = await Staff.create({ businessId: business._id, fullName: "Chef", role: "CHEF" });
      assert.equal((await confirmWaiterRequest(order.id, 0, String(chef._id))).ok, false, "only waiters can be assigned");
      assert.equal((await confirmWaiterRequest(order.id, 0, "nonsense")).ok, false);
      const approved = await confirmWaiterRequest(order.id, 0, String(bilal._id));
      assert.equal(approved.ok, true, approved.message);
      const customer = await Customer.findOne({ businessId: business._id, name: "Sana" }).lean();
      assert.equal(customer.phone, "03007654321");
      const placed = await Order.findById(approved.orderId).lean();
      assert.equal(String(placed.customerId), String(customer._id));
      assert.deepEqual([String(placed.waiterId), placed.waiterNameSnapshot], [String(bilal._id), "Bilal"]);
    });

    await t.test("hiding the bill summary hides totals from guests", async () => {
      assert.equal((await saveQrOrderingSettings({ enabled: true, showSummary: false, baseUrl: "" })).ok, true);
      assert.equal(await previewGuestOrder(table.qrToken, { lines }, address()), null);
      const hiddenStatus = await guestOrderStatus(table.qrToken, first.id, first.key);
      assert.equal(hiddenStatus.summary, undefined);
      assert.ok(hiddenStatus.lines.every(line => line.unitPrice === undefined), "line prices are not sent either");
      assert.equal((await Business.findById(business._id).lean()).qrMenuBaseUrl, undefined);
    });

    await t.test("a table is capped on pending orders and a new code retires the old print", async () => {
      for (let index = 0; index < QR_LIMITS.pendingPerTable; index++) assert.equal((await submitGuestOrder(table.qrToken, guest({ phone: `0301000000${index}` }), address())).ok, true);
      assert.deepEqual(await submitGuestOrder(table.qrToken, guest({ phone: "03019999999" }), address()), { ok: false, code: "LIMIT" });
      const old = table.qrToken;
      assert.equal((await regenerateTableQr(String(table._id))).ok, true);
      assert.equal(await resolveQrTable(old), null);
      const fresh = (await RestaurantTable.findById(table._id).lean()).qrToken;
      assert.equal((await resolveQrTable(fresh)).table.id, String(table._id));
    });

    await t.test("one network address cannot flood orders", async () => {
      const results = [];
      for (let index = 0; index < QR_LIMITS.ordersPerIpWindow + 1; index++) results.push((await submitGuestOrder(table6.qrToken, guest({ phone: `0302000000${index}` }), "10.9.9.9")).code ?? "OK");
      assert.equal(results.at(-1), "BUSY");
    });

    await t.test("with SMS phone codes on, a new number types the texted code once and then orders freely", async () => {
      // Fresh tables: the earlier tests used up the per-table order window of the others.
      const table7 = await RestaurantTable.create({ businessId: business._id, name: "Table 7", number: 7, qrToken: newQrToken() });
      const table8 = await RestaurantTable.create({ businessId: business._id, name: "Table 8", number: 8, qrToken: newQrToken() });
      const token = table7.qrToken;
      const savedApi = process.env.SMS_API;
      process.env.SMS_API ||= "https://sms.example.test/";
      try {
        const { sendQrPhoneCode, checkQrPhoneCode, QR_VERIFY } = await import("../lib/qr-phone-verification.ts");
        const { runSmsDeliveryTick } = await import("../lib/sms-delivery.mjs");
        const settings = verifyPhone => saveQrOrderingSettings({ enabled: true, showSummary: true, verifyPhone, baseUrl: "" });
        const codeFor = async to => (await SmsMessage.findOne({ businessId: business._id, messageType: "QR_VERIFICATION", to }).sort({ createdAt: -1 }).lean()).body.match(/: (\d{4}) is your table order code/)[1];
        const other = code => code === "0000" ? "1111" : "0000";

        await Business.updateOne({ _id: business._id }, { $set: { smsEnabled: false } });
        assert.equal((await settings(true)).ok, false, "cannot be switched on while SMS is off");
        await Business.updateOne({ _id: business._id }, { $set: { smsEnabled: true } });
        assert.equal((await settings(true)).ok, true);
        assert.equal((await resolveQrTable(token)).business.verifyPhone, true);

        const phone = "03214445566", order = (extra = {}) => guest({ phone, ...extra });
        assert.deepEqual(await submitGuestOrder(token, order(), address()), { ok: false, code: "VERIFY" });
        assert.deepEqual(await submitGuestOrder(token, order({ verification: "x".repeat(32) }), address()), { ok: false, code: "VERIFY" }, "a made-up pass is refused");
        assert.deepEqual(await sendQrPhoneCode(token, { phone }, address()), { ok: true });
        const sms = await SmsMessage.findOne({ businessId: business._id, messageType: "QR_VERIFICATION", to: "+923214445566" }).lean();
        assert.deepEqual([sms.includeOptOut, sms.status], [false, "PENDING"]);
        const code = await codeFor("+923214445566");
        assert.deepEqual(await checkQrPhoneCode(token, { phone, code: other(code) }, address()), { ok: false, code: "CODE" });
        assert.deepEqual(await checkQrPhoneCode(token, { phone: "03001112223", code }, address()), { ok: false, code: "EXPIRED" }, "a code only works for its own number");
        const checked = await checkQrPhoneCode(token, { phone, code }, address());
        assert.equal(checked.ok, true);
        assert.deepEqual(await checkQrPhoneCode(token, { phone, code }, address()), { ok: false, code: "EXPIRED" }, "a code works once");

        const placed = await submitGuestOrder(token, order({ verification: checked.pass }), address());
        assert.equal(placed.ok, true, JSON.stringify(placed));
        assert.equal((await WaiterRequest.findById(placed.id).lean()).guest.verified, true);
        assert.equal((await submitGuestOrder(table8.qrToken, order({ verification: checked.pass }), address())).ok, true, "the pass works on any table of the restaurant");
        assert.deepEqual(await submitGuestOrder(token, guest({ phone: "03001112223", verification: checked.pass }), address()), { ok: false, code: "VERIFY" }, "the pass is tied to the verified number");

        const guesser = "03007778899";
        assert.equal((await sendQrPhoneCode(token, { phone: guesser }, address())).ok, true);
        const real = await codeFor("+923007778899");
        for (let index = 0; index < QR_VERIFY.maxAttempts; index++) await checkQrPhoneCode(token, { phone: guesser, code: other(real) }, address());
        assert.deepEqual(await checkQrPhoneCode(token, { phone: guesser, code: real }, address()), { ok: false, code: "EXPIRED" }, "too many wrong guesses burn the code");
        assert.equal((await sendQrPhoneCode(token, { phone: guesser }, address())).ok, true);
        assert.deepEqual(await sendQrPhoneCode(token, { phone: guesser }, address()), { ok: true });
        assert.deepEqual(await sendQrPhoneCode(token, { phone: guesser }, address()), { ok: false, code: "BUSY" }, "codes per number are capped");
        assert.deepEqual(await sendQrPhoneCode(token, { phone: "12345" }, address()), { ok: false, code: "PHONE" });

        const sent = [];
        await runSmsDeliveryTick(mongoose.connection.db, { secret, base: "https://sms.example.test/", limit: 100, fetcher: async (url, options) => { sent.push(JSON.parse(options.body)); return new Response("{}", { status: 202 }); } });
        const delivered = sent.find(row => row.to === "+923214445566" && /table order code/.test(row.body));
        assert.ok(delivered, "the worker sends the code");
        assert.equal(delivered.includeOptOut, false);
        assert.equal((await SmsMessage.findById(sms._id).lean()).status, "ACCEPTED");

        await Business.updateOne({ _id: business._id }, { $set: { smsEnabled: false } });
        assert.equal((await resolveQrTable(token)).business.verifyPhone, false, "turning SMS off never locks guests out");
        await Business.updateOne({ _id: business._id }, { $set: { smsEnabled: true } });
        assert.equal((await settings(false)).ok, true);
        assert.equal((await submitGuestOrder(token, guest({ phone: "03005550001" }), address())).ok, true, "switched off, no code is needed");
        assert.deepEqual(await sendQrPhoneCode(token, { phone: "03005550001" }, address()), { ok: false, code: "OFF" });
      } finally {
        if (savedApi === undefined) delete process.env.SMS_API; else process.env.SMS_API = savedApi;
      }
    });
  } finally {
    assert.match(mongoose.connection.name, /^pos_qr_orders_test_[a-f0-9]+$/);
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
