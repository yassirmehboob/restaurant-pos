import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../models/User.ts";
import { Business } from "../models/Business.ts";
import { Order } from "../models/Order.ts";
import { Payment } from "../models/Payment.ts";
import { SaleSession } from "../models/SaleSession.ts";
import { Product } from "../models/Product.ts";
import { Category } from "../models/Category.ts";
import { SmsMessage } from "../models/SmsMessage.ts";

const jar = new Map();
globalThis.__discountTestCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__discountTestCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("invoice discounts: owner settings, payment, receipt, SMS alerts and report", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_discount_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { saveDiscountSettings } = await import("../app/(dashboard)/settings/discounts/actions.ts");
    const { saveOrder, completeTakeawayPayment, previewTakeawayPayment } = await import("../app/(dashboard)/orders/actions.ts");
    const { previewPosTotals } = await import("../app/(dashboard)/pos/actions.ts");
    const { previewPaymentTax, completeOrderPayment } = await import("../app/(dashboard)/payments/actions.ts");
    const { buildPrintJob } = await import("../lib/receipt-print.ts");
    const { buildDiscountReport } = await import("../lib/discount-report.ts");
    await Promise.all([User.init(), Order.init(), Payment.init(), SaleSession.init(), SmsMessage.init()]);
    const business = await Business.create({ name: "Discount test", saleTaxRate: 15, smsEnabled: true });
    const password = "OwnerPass123", passwordHash = await bcrypt.hash(password, 10);
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234567", username: "discount.owner", role: "OWNER", passwordHash });
    const cashier = await User.create({ businessId: business._id, fullName: "Cashier Ali", phone: "03001234568", username: "discount.cashier", role: "CASHIER", passwordHash });
    const signIn = async user => { jar.clear(); await createSession({ userId: String(user._id), businessId: String(business._id), role: user.role, authVersion: 0 }); };
    for (const user of [owner, cashier]) await SaleSession.create({ businessId: business._id, userId: user._id, userNameSnapshot: user.fullName, counterName: user.username, counterKey: user.username, saleDate: "2026-11-02", openingBalance: 0 });
    const category = await Category.create({ businessId: business._id, name: "Mains" });
    const karahi = await Product.create({ businessId: business._id, categoryId: category._id, name: "Chicken Karahi", salePrice: 1000, costPrice: 600 });
    const lines = quantity => [{ kind: "PRODUCT", id: String(karahi._id), quantity, note: "" }];
    const order = (orderType, quantity) => ({ paymentMethod: "CASH", orderType, tableId: "", waiterId: "", customerId: "", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines: lines(quantity) });
    const settings = { enabled: true, smsNumbers: ["0300 1112223", "+923004445556"], types: [
      { name: "Discount", mode: "OPEN", percent: null, capAmount: null, remarksRequired: false },
      { name: "Special Relation Discount", mode: "FIXED", percent: 20, capAmount: 300, remarksRequired: true },
    ] };
    let types;

    await t.test("only the owner, with the correct password, can change discount settings", async () => {
      await signIn(cashier);
      await assert.rejects(saveDiscountSettings({ ...settings, currentPassword: password }));
      await signIn(owner);
      const wrong = await saveDiscountSettings({ ...settings, currentPassword: "wrong" });
      assert.equal(wrong.ok, false);
      assert.match(wrong.message, /current password/);
      assert.equal((await Business.findById(business._id).lean()).invoiceDiscountEnabled, false);
      const saved = await saveDiscountSettings({ ...settings, currentPassword: password });
      assert.equal(saved.ok, true, saved.message);
      types = saved.types;
      const stored = await Business.findById(business._id).lean();
      assert.deepEqual(stored.discountSmsNumbers, ["+923001112223", "+923004445556"]);
      assert.deepEqual(stored.discountTypes.map(type => [type.name, type.mode, type.percent, type.capAmount]), [["Discount", "OPEN", null, null], ["Special Relation Discount", "FIXED", 20, 300]]);
    });

    await t.test("a cashier gives an open 10% discount at Review & send and it is kept through payment", async () => {
      await signIn(cashier);
      // The review shows the choices and the discounted totals before anything is saved.
      const review = await previewPosTotals({ paymentMethod: "CASH", lines: lines(2), deliveryCharge: 0 }, { discount: { typeId: types[0].id, percent: 10 } });
      assert.equal(review.ok, true, review.message);
      assert.equal(review.discountTypes.length, 2);
      assert.deepEqual([review.subtotal, review.discountAmount, review.taxAmount, review.grandTotal, review.invoiceDiscount.amount], [2000, 200, 270, 2070, 200]);
      assert.equal((await previewPosTotals({ paymentMethod: "CASH", lines: lines(2), deliveryCharge: 0 }, { discount: { typeId: types[1].id } })).invoiceDiscount.amount, 300);
      // Too high a percentage explains itself instead of failing the preview.
      assert.match((await previewPosTotals({ paymentMethod: "CASH", lines: lines(2), deliveryCharge: 0 }, { discount: { typeId: types[0].id, percent: 150 } })).discountError, /from 0\.01 to 100/);
      // Remarks are required for the special discount; saving is refused without them.
      const noRemarks = await saveOrder(order("DINE_IN", 2), undefined, { typeId: types[1].id, remarks: "" });
      assert.equal(noRemarks.ok, false);
      assert.match(noRemarks.message, /remarks/i);
      const created = await saveOrder(order("DINE_IN", 2), undefined, { typeId: types[0].id, percent: 10, remarks: "Regular guest" });
      assert.equal(created.ok, true, created.message);
      assert.equal(created.grandTotal, 2070);
      const unpaid = await Order.findById(created.orderId).lean();
      assert.deepEqual([unpaid.discountAmount, unpaid.taxAmount, unpaid.grandTotal, unpaid.dueAmount, unpaid.invoiceDiscount.amount, unpaid.invoiceDiscount.amountBefore, unpaid.paymentStatus], [200, 270, 2070, 2070, 200, 2300, "UNPAID"]);
      assert.equal(await SmsMessage.countDocuments({ orderId: unpaid._id, messageType: /^DISCOUNT_ALERT_/ }), 0, "the owner is told when the discounted invoice is paid");
      const preview = await previewPaymentTax(created.orderId, "CASH");
      assert.equal(preview.ok, true, preview.message);
      assert.deepEqual([preview.subtotal, preview.discountAmount, preview.taxAmount, preview.grandTotal, preview.invoiceDiscount.amount], [2000, 200, 270, 2070, 200]);
      assert.equal(preview.discountTypes, undefined);
      const payment = { orderId: created.orderId, method: "CASH", expectedGrandTotal: 2070, tenderedAmount: 2100, reference: "", notes: "" };
      // Payment cannot add or change a discount.
      const changed = await completeOrderPayment({ ...payment, idempotencyKey: randomUUID(), expectedGrandTotal: 1725, tenderedAmount: 2100, discount: { typeId: types[1].id, remarks: "Friend" } });
      assert.equal(changed.ok, false);
      const paid = await completeOrderPayment({ ...payment, idempotencyKey: randomUUID() });
      assert.equal(paid.ok, true, paid.message);
      assert.equal(paid.change, 30);
      const saved = await Order.findById(created.orderId).lean();
      assert.deepEqual([saved.discountAmount, saved.taxAmount, saved.grandTotal, saved.paymentStatus], [200, 270, 2070, "PAID"]);
      assert.deepEqual([saved.invoiceDiscount.name, saved.invoiceDiscount.percent, saved.invoiceDiscount.amount, saved.invoiceDiscount.amountBefore, saved.invoiceDiscount.remarks, saved.invoiceDiscount.appliedByName], ["Discount", 10, 200, 2300, "Regular guest", "Cashier Ali"]);

      const sms = await SmsMessage.find({ orderId: saved._id, messageType: /^DISCOUNT_ALERT_/ }).sort({ messageType: 1 }).lean();
      assert.deepEqual(sms.map(row => [row.messageType, row.to, row.status, row.includeOptOut]), [["DISCOUNT_ALERT_1", "+923001112223", "PENDING", false], ["DISCOUNT_ALERT_2", "+923004445556", "PENDING", false]]);
      for (const text of [saved.orderNumber, "Amount: PKR 2,300.00", "Discount: Discount (10%) PKR 200.00", "After discount: PKR 2,070.00", "Cashier: Cashier Ali", "Remarks: Regular guest"]) assert.ok(sms[0].body.includes(text), `SMS should include "${text}"\n${sms[0].body}`);

      const job = await buildPrintJob(String(business._id), created.orderId, "customer");
      const printed = job.parts.filter(part => part.type === "command").map(part => Buffer.from(part.base64, "base64").toString("latin1")).join("").replace(/\x1b@|\x1b[taEd][\s\S]|\x1d![\s\S]/g, "").split("\n").map(row => row.trimEnd());
      assert.ok(!printed.some(row => row.includes("Regular guest")), "remarks must not print on the invoice");
      for (const row of ["Subtotal".padEnd(34) + "2,000.00", "Discount (10%)".padEnd(35) + "-200.00", "Tax (15%)".padEnd(36) + "270.00", "Received - Cash".padEnd(34) + "2,100.00"]) assert.ok(printed.includes(row), `receipt should contain "${row}"\n${printed.join("\n")}`);
    });

    await t.test("a saved discount stays right through edits, tax changes, coupons and limited staff", async () => {
      const { applyOrderCoupon, removeOrderCoupon } = await import("../app/(dashboard)/payments/coupon-actions.ts");
      const { Coupon } = await import("../models/Coupon.ts");
      const { CouponBatch } = await import("../models/CouponBatch.ts");
      const created = await saveOrder(order("DINE_IN", 2), undefined, { typeId: types[0].id, percent: 10, remarks: "" });
      assert.equal(created.ok, true, created.message);
      // A different payment method re-prices the tax on the discounted amount.
      await Business.updateOne({ _id: business._id }, { $set: { paymentTaxRates: { CASH: 15, CARD: 5, BANK: 15, OTHER: 15 } } });
      const edited = await saveOrder(order("DINE_IN", 3), created.orderId, { typeId: types[0].id, percent: 10, remarks: "" });
      assert.equal(edited.ok, true, edited.message);
      let row = await Order.findById(created.orderId).lean();
      assert.deepEqual([row.subtotal, row.discountAmount, row.grandTotal, row.invoiceDiscount.amount, row.invoiceDiscount.amountBefore], [3000, 300, 3105, 300, 3450]);
      assert.deepEqual((({ discountAmount, taxAmount, grandTotal }) => [discountAmount, taxAmount, grandTotal])(await previewPaymentTax(created.orderId, "CARD")), [300, 135, 2835]);

      // A coupon reduces the amount under the discount, and is recorded on its own.
      const batch = await CouponBatch.create({ businessId: business._id, name: "Rs 500 off", discountType: "FIXED", discountValue: 500, usage: "INSTANT", quantity: 1, createdByUserId: owner._id });
      const coupon = await Coupon.create({ businessId: business._id, batchId: batch._id, code: "1234567891", status: "ACTIVE" });
      const applied = await applyOrderCoupon(created.orderId, "1234567891");
      assert.equal(applied.ok, true, applied.message);
      assert.equal(applied.discountAmount, 500);
      row = await Order.findById(created.orderId).lean();
      assert.deepEqual([row.discountAmount, row.invoiceDiscount.amount, row.grandTotal, row.invoiceDiscount.amountBefore], [750, 250, 2587.5, 2875]);
      assert.equal((await Coupon.findById(coupon._id).lean()).discountAmount, 500);
      // Editing prices coupon and discount the same way in the review and on save.
      const editReview = await previewPosTotals({ paymentMethod: "CASH", lines: lines(3), deliveryCharge: 0 }, { discount: { typeId: types[0].id, percent: 10 }, orderId: created.orderId });
      assert.deepEqual([editReview.discountAmount, editReview.grandTotal], [750, 2587.5]);
      assert.equal((await removeOrderCoupon(created.orderId)).ok, true);
      row = await Order.findById(created.orderId).lean();
      assert.deepEqual([row.discountAmount, row.invoiceDiscount.amount, row.grandTotal], [300, 300, 3105]);
      assert.equal((await applyOrderCoupon(created.orderId, "1234567891")).ok, true);

      // Staff who cannot take payments cannot give a discount, and their edits keep the existing one.
      const limited = await User.create({ businessId: business._id, fullName: "Order Taker", phone: "03001234569", username: "discount.taker", role: "CASHIER", privileges: ["pos", "orders", "edit_orders"], passwordHash });
      await SaleSession.create({ businessId: business._id, userId: limited._id, userNameSnapshot: limited.fullName, counterName: limited.username, counterKey: limited.username, saleDate: "2026-11-02", openingBalance: 0 });
      await signIn(limited);
      const hidden = await previewPosTotals({ paymentMethod: "CASH", lines: lines(3), deliveryCharge: 0 }, { discount: { typeId: types[0].id, percent: 50 }, orderId: created.orderId });
      assert.deepEqual([hidden.discountTypes, hidden.invoiceDiscount.amount, hidden.discountAmount], [[], 250, 750]);
      assert.equal((await saveOrder(order("DINE_IN", 3), undefined, { typeId: types[0].id, percent: 50 })).ok, false);
      assert.equal((await saveOrder(order("DINE_IN", 4), created.orderId)).ok, true);
      row = await Order.findById(created.orderId).lean();
      assert.deepEqual([row.subtotal, row.discountAmount, row.invoiceDiscount.amount, row.invoiceDiscount.percent, row.invoiceDiscount.appliedByName], [4000, 850, 350, 10, "Cashier Ali"]);

      // Paying records the coupon alone on the coupon, and the discount alone on the discount.
      await signIn(cashier);
      const quote = await previewPaymentTax(created.orderId, "CARD");
      const paid = await completeOrderPayment({ orderId: created.orderId, idempotencyKey: randomUUID(), method: "CARD", expectedGrandTotal: quote.grandTotal, tenderedAmount: quote.grandTotal, reference: "", notes: "" });
      assert.equal(paid.ok, true, paid.message);
      row = await Order.findById(created.orderId).lean();
      // 4,000 less 500 coupon less 350 discount = 3,150; before the discount 3,500; both at the 5% card rate.
      assert.deepEqual([row.grandTotal, row.discountAmount, row.invoiceDiscount.amount, row.invoiceDiscount.amountBefore, row.taxPaymentMethod, row.paymentStatus], [3307.5, 850, 350, 3675, "CARD", "PAID"]);
      const redeemed = await Coupon.findById(coupon._id).lean();
      assert.deepEqual([redeemed.status, redeemed.discountAmount], ["REDEEMED", 500]);
      await Business.updateOne({ _id: business._id }, { $unset: { paymentTaxRates: "" } });
      await Order.deleteOne({ _id: created.orderId });
      await SmsMessage.deleteMany({ orderId: row._id });

      // Choosing "No discount" on an edit removes it.
      const removable = await saveOrder(order("DINE_IN", 1), undefined, { typeId: types[0].id, percent: 10, remarks: "" });
      assert.equal((await saveOrder(order("DINE_IN", 1), removable.orderId)).ok, true);
      row = await Order.findById(removable.orderId).lean();
      assert.deepEqual([row.invoiceDiscount, row.discountAmount, row.grandTotal], [undefined, 0, 1150]);
      await Order.deleteOne({ _id: removable.orderId });
    });

    await t.test("a takeaway gets the fixed special discount, held to its cap", async () => {
      const preview = await previewTakeawayPayment(order("TAKEAWAY", 3), { typeId: types[1].id });
      assert.equal(preview.ok, true, preview.message);
      // 20% of 3,000 is 600, capped at 300; tax 15% of 2,700.
      assert.deepEqual([preview.invoiceDiscount.amount, preview.taxAmount, preview.grandTotal], [300, 405, 3105]);
      const paid = await completeTakeawayPayment(order("TAKEAWAY", 3), { idempotencyKey: randomUUID(), method: "CARD", expectedGrandTotal: 3105, tenderedAmount: 3105, reference: "", notes: "", discount: { typeId: types[1].id, remarks: "Owner's cousin" } });
      assert.equal(paid.ok, true, paid.message);
      const saved = await Order.findById(paid.orderId).lean();
      assert.deepEqual([saved.invoiceDiscount.name, saved.invoiceDiscount.amount, saved.invoiceDiscount.amountBefore, saved.grandTotal, saved.cashierNameSnapshot], ["Special Relation Discount", 300, 3450, 3105, "Cashier Ali"]);
      assert.equal(await SmsMessage.countDocuments({ orderId: saved._id, messageType: /^DISCOUNT_ALERT_/ }), 2);
    });

    await t.test("the report lists discounted invoices with cashier and remarks", async () => {
      const report = await buildDiscountReport(String(business._id), { range: "CUSTOM", from: "2026-11-02", to: "2026-11-02" });
      assert.deepEqual(report.invoices.map(row => [row.name, row.amountBefore, row.amount, row.amountAfter, row.cashier, row.remarks]).sort(), [["Discount", 2300, 200, 2070, "Cashier Ali", "Regular guest"], ["Special Relation Discount", 3450, 300, 3105, "Cashier Ali", "Owner's cousin"]]);
      assert.deepEqual(report.totals, { count: 2, before: 5750, discount: 500, after: 5175 });
      assert.equal((await buildDiscountReport(String(business._id), { range: "CUSTOM", from: "2026-11-02", to: "2026-11-02", type: "Discount" })).invoices.length, 1);
    });

    await t.test("the coupon code box can be turned off, and the server then refuses coupon codes", async () => {
      const { applyOrderCoupon } = await import("../app/(dashboard)/payments/coupon-actions.ts");
      await signIn(owner);
      assert.equal((await saveDiscountSettings({ ...settings, couponOnPayment: false, currentPassword: password })).ok, true);
      assert.equal((await Business.findById(business._id).lean()).couponOnPayment, false);
      await signIn(cashier);
      const created = await saveOrder(order("DINE_IN", 1));
      assert.equal((await previewPaymentTax(created.orderId, "CASH")).couponOnPayment, false);
      const applied = await applyOrderCoupon(created.orderId, "1234567890");
      assert.equal(applied.ok, false);
      assert.match(applied.message, /turned off/);
      const takeaway = { ...order("TAKEAWAY", 1), couponCode: "1234567890" };
      const preview = await previewTakeawayPayment(takeaway);
      assert.deepEqual([preview.couponOnPayment, preview.couponError, preview.discountAmount], [false, "Coupon codes are turned off in Discount settings.", 0]);
      const paid = await completeTakeawayPayment(takeaway, { idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: 1150, tenderedAmount: 1150, reference: "", notes: "" });
      assert.equal(paid.ok, false);
      assert.match(paid.message, /turned off/);
      await signIn(owner);
      assert.equal((await saveDiscountSettings({ ...settings, couponOnPayment: true, currentPassword: password })).ok, true);
      await signIn(cashier);
      assert.equal((await previewPaymentTax(created.orderId, "CASH")).couponOnPayment, true);
    });

    await t.test("with discounts turned off, an order carrying a discount is refused", async () => {
      await signIn(owner);
      assert.equal((await saveDiscountSettings({ ...settings, enabled: false, currentPassword: password })).ok, true);
      await signIn(cashier);
      assert.deepEqual((await previewPosTotals({ paymentMethod: "CASH", lines: lines(1), deliveryCharge: 0 })).discountTypes, []);
      const refused = await saveOrder(order("DINE_IN", 1), undefined, { typeId: types[0].id, percent: 10 });
      assert.equal(refused.ok, false);
      assert.match(refused.message, /no longer available/);
    });
  } finally {
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
