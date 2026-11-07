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
import { Coupon } from "../models/Coupon.ts";
import { CouponBatch } from "../models/CouponBatch.ts";
import { AuditLog } from "../models/AuditLog.ts";

const jar = new Map();
globalThis.__reversalCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__reversalCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("payment reversal: permission, drawer totals, reopen flows and report", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_reversal_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { saveOrder, cancelOrder, completeTakeawayPayment, previewTakeawayPayment, changeOrderStatus } = await import("../app/(dashboard)/orders/actions.ts");
    const { previewPaymentTax, completeOrderPayment } = await import("../app/(dashboard)/payments/actions.ts");
    const { reverseOrderPayment } = await import("../app/(dashboard)/payments/reversal-actions.ts");
    const { closeSale } = await import("../app/(dashboard)/sale-sessions/actions.ts");
    const { sessionTotals, sessionUnpaidOrders } = await import("../lib/sale-sessions.ts");
    const { buildSalesReport } = await import("../lib/reporting.ts");
    const { buildReversalReport } = await import("../lib/reversal-report.ts");
    const { buildPrintJob } = await import("../lib/receipt-print.ts");
    await Promise.all([User.init(), Order.init(), Payment.init(), SaleSession.init(), Coupon.init()]);

    const business = await Business.create({ name: "Reversal test" });
    const passwordHash = await bcrypt.hash("OwnerPass123", 10), businessId = String(business._id), saleDate = "2026-11-06", nextDate = "2026-11-07";
    const account = (username, role, extra = {}) => User.create({ businessId: business._id, fullName: username, phone: "03001234567", username, role, passwordHash, ...extra });
    const owner = await account("rev.owner", "OWNER"), cashier = await account("rev.cashier", "CASHIER"), admin = await account("rev.admin", "ADMIN"), manager = await account("rev.manager", "MANAGER");
    const trusted = await account("rev.trusted", "CASHIER", { privileges: ["pos", "orders", "payments", "sale_sessions", "printing", "reverse_payments"] });
    const open = (user, date = saleDate) => SaleSession.create({ businessId: business._id, userId: user._id, userNameSnapshot: user.fullName, counterName: user.username, counterKey: user.username, saleDate: date, openingBalance: 1000 });
    // Changing an account's access bumps its authVersion, so sessions are made from the stored value.
    const signIn = async user => { const fresh = await User.findById(user._id).lean(); jar.clear(); await createSession({ userId: String(user._id), businessId, role: user.role, authVersion: fresh.authVersion ?? 0 }); };
    const category = await Category.create({ businessId: business._id, name: "Mains" });
    const product = await Product.create({ businessId: business._id, categoryId: category._id, name: "Karahi", salePrice: 1000, costPrice: 600 });
    const lines = [{ kind: "PRODUCT", id: String(product._id), quantity: 1, note: "" }];
    const base = { paymentMethod: "CASH", tableId: "", waiterId: "", customerId: "", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines };
    const place = async () => { const saved = await saveOrder({ ...base, orderType: "DINE_IN" }); assert.equal(saved.ok, true, saved.message); return saved; };
    const pay = async (orderId, method = "CASH") => {
      const quote = await previewPaymentTax(orderId, method);
      assert.equal(quote.ok, true, quote.message);
      const paid = await completeOrderPayment({ orderId, idempotencyKey: randomUUID(), method, expectedGrandTotal: quote.grandTotal, tenderedAmount: quote.dueAmount, reference: "", notes: "" });
      assert.equal(paid.ok, true, paid.message);
      return paid;
    };
    const close = id => { const form = new FormData(); form.set("confirm", "yes"); return closeSale(id, undefined, form); };
    const totals = async id => { const sale = await SaleSession.findById(id).lean(); return sessionTotals(businessId, String(id), sale.openingBalance); };

    const ownerSale = await open(owner), cashierSale = await open(cashier);
    await signIn(cashier);
    const order = await place();
    await pay(order.orderId);
    const amount = order.grandTotal;

    await t.test("only the owner and accounts the owner picked may reverse", async () => {
      const { can } = await import("../lib/permissions.ts");
      assert.equal(can({ role: "OWNER", privileges: [] }, "reverse_payments"), true);
      for (const role of ["ADMIN", "MANAGER", "SUPERVISOR", "CASHIER"]) assert.equal(can({ role }, "reverse_payments"), false, role);
      assert.equal(can({ role: "CASHIER", privileges: ["reverse_payments"] }, "reverse_payments"), true);
      for (const user of [cashier, admin, manager]) {
        await signIn(user);
        const denied = await reverseOrderPayment(order.orderId, "Not allowed");
        assert.equal(denied.ok, false, user.username);
        assert.match(denied.message, /permission/);
      }
      assert.equal((await Order.findById(order.orderId).lean()).paymentStatus, "PAID");
    });

    await t.test("a reason is required, and nothing changes without one", async () => {
      await signIn(owner);
      for (const reason of ["", "  ", "ab"]) assert.equal((await reverseOrderPayment(order.orderId, reason)).ok, false);
      assert.equal((await Order.findById(order.orderId).lean()).paymentStatus, "PAID");
    });

    await t.test("owner reversal comes off the drawer that took it, and the order is unpaid again", async () => {
      assert.equal((await totals(cashierSale._id)).expectedCash, 1000 + amount);
      const before = (await SaleSession.findById(cashierSale._id).lean()).revision;
      const reversed = await reverseOrderPayment(order.orderId, "Charged the wrong table");
      assert.equal(reversed.ok, true, reversed.message);
      assert.equal(reversed.amount, amount);
      const row = await Order.findById(order.orderId).lean();
      assert.equal(row.paymentStatus, "UNPAID"); assert.equal(row.paidAmount, 0); assert.equal(row.dueAmount, amount);
      assert.equal(row.status, "SERVED"); assert.equal(row.completedAt, undefined); assert.equal(row.collectedInSessionId, undefined);
      const payment = await Payment.findOne({ orderId: order.orderId }).lean();
      assert.equal(payment.reversal.reason, "Charged the wrong table");
      assert.equal(String(payment.reversal.saleSessionId), String(cashierSale._id));
      assert.equal(payment.reversal.reversedByNameSnapshot, owner.fullName);
      const drawer = await totals(cashierSale._id);
      assert.equal(drawer.sales, 0); assert.equal(drawer.cashSales, 0); assert.equal(drawer.balance, 1000); assert.equal(drawer.expectedCash, 1000);
      assert.equal(drawer.reversals, amount); assert.equal(drawer.reversalCount, 1);
      assert.equal((await SaleSession.findById(cashierSale._id).lean()).revision, before + 1);
      assert.equal((await totals(ownerSale._id)).reversals, 0, "the owner's own drawer is untouched");
      assert.ok(await AuditLog.exists({ action: "REVERSE_PAYMENT", entityId: order.orderId }));
    });

    await t.test("it cannot be reversed twice, and leaves paid reports", async () => {
      const again = await reverseOrderPayment(order.orderId, "Double click");
      assert.equal(again.ok, false);
      assert.equal((await totals(cashierSale._id)).reversalCount, 1);
      const sales = await buildSalesReport(businessId, { range: "CUSTOM", from: saleDate, to: saleDate });
      assert.equal(sales.summary.orders, 0); assert.equal(sales.summary.netSales, 0); assert.deepEqual(sales.paymentMethods, []);
    });

    await t.test("the cashier's sale cannot close until it is collected again", async () => {
      await signIn(cashier);
      assert.deepEqual((await sessionUnpaidOrders(businessId, String(cashierSale._id))).map(row => row.orderNumber), [order.orderNumber]);
      const blocked = await close(String(cashierSale._id));
      assert.match(blocked.message, /cannot close/);
    });

    await t.test("collecting it again counts once, by the new method, and the receipt shows only that payment", async () => {
      await pay(order.orderId, "CARD");
      const row = await Order.findById(order.orderId).lean();
      assert.equal(row.paymentStatus, "PAID"); assert.equal(row.status, "COMPLETED"); assert.equal(row.dueAmount, 0); assert.equal(row.taxPaymentMethod, "CARD");
      const drawer = await totals(cashierSale._id);
      assert.equal(drawer.sales, row.grandTotal); assert.equal(drawer.cashSales, 0); assert.equal(drawer.expectedCash, 1000);
      const sales = await buildSalesReport(businessId, { range: "CUSTOM", from: saleDate, to: saleDate });
      assert.deepEqual(sales.paymentMethods, [{ method: "CARD", amount: row.grandTotal }]);
      const job = await buildPrintJob(businessId, order.orderId, "customer");
      assert.equal(job.error, undefined);
      const text = JSON.stringify(job.parts);
      assert.ok(!text.includes("CASH") && !text.includes("Cash"), "the reversed cash payment is not on the receipt");
    });

    await t.test("it can be reversed again, each time on the report with its own reason", async () => {
      await signIn(trusted);
      const secondReversal = await reverseOrderPayment(order.orderId, "Card declined later");
      assert.equal(secondReversal.ok, true, secondReversal.message);
      const report = await buildReversalReport(businessId, { range: "CUSTOM", from: saleDate, to: saleDate });
      assert.deepEqual(report.reversals.map(row => row.reason).sort(), ["Card declined later", "Charged the wrong table"]);
      assert.equal(report.totals.count, 2);
      assert.equal(report.totals.cash, amount);
      assert.equal(report.reversals.find(row => row.reason === "Card declined later").reversedBy, trusted.fullName);
      assert.ok(report.reversals.every(row => row.outcome === "Still unpaid"));
    });

    await t.test("a reversed order can be edited, then cancelled, which clears the block", async () => {
      await signIn(cashier);
      const edited = await saveOrder({ ...base, orderType: "DINE_IN", lines: [{ ...lines[0], quantity: 2 }] }, order.orderId);
      assert.equal(edited.ok, true, edited.message);
      assert.equal((await Order.findById(order.orderId).lean()).dueAmount, edited.grandTotal);
      await signIn(owner);
      const cancelled = await cancelOrder(order.orderId, "Guest got a refund");
      assert.equal(cancelled.ok, true, cancelled.message);
      await signIn(owner);
      assert.equal((await reverseOrderPayment(order.orderId, "Cancelled order")).ok, false);
      const report = await buildReversalReport(businessId, { range: "CUSTOM", from: saleDate, to: saleDate });
      assert.ok(report.reversals.every(row => row.outcome === "Cancelled"));
      assert.equal((await sessionUnpaidOrders(businessId, String(cashierSale._id))).length, 0);
    });

    await t.test("after a shift closes, a mistaken payment is just unpaid: no open sale needed and no drawer is touched", async () => {
      const { dateISO } = await import("../lib/dates.ts");
      await signIn(cashier);
      const later = await place(), other = await place();
      await pay(later.orderId); await pay(other.orderId);
      const closed = await close(String(cashierSale._id));
      assert.equal(closed.ok, true, closed.message);
      const frozen = (await SaleSession.findById(cashierSale._id).lean()).closingTotals;

      await signIn(trusted);
      assert.equal(await SaleSession.exists({ userId: trusted._id, status: "OPEN" }), null);
      const reversed = await reverseOrderPayment(later.orderId, "Recorded by mistake");
      assert.equal(reversed.ok, true, reversed.message);
      assert.deepEqual((await SaleSession.findById(cashierSale._id).lean()).closingTotals, frozen);
      const payment = await Payment.findOne({ orderId: later.orderId }).lean();
      assert.equal(payment.reversal.saleSessionId, undefined, "no drawer gives money back");
      const row = await Order.findById(later.orderId).lean();
      assert.equal(row.paymentStatus, "UNPAID"); assert.equal(String(row.saleSessionId), String(cashierSale._id)); assert.equal(row.saleDate, saleDate);
      const report = await buildReversalReport(businessId, { range: "CUSTOM", from: dateISO(), to: dateISO() });
      assert.ok(report.reversals.some(item => item.reason === "Recorded by mistake" && item.counter === ""));

      // With a sale open, the order joins it so that shift cannot close until it is collected, but its cash is untouched.
      const nextSale = await open(trusted, nextDate);
      const second = await reverseOrderPayment(other.orderId, "Also recorded by mistake");
      assert.equal(second.ok, true, second.message);
      const drawer = await totals(nextSale._id);
      assert.equal(drawer.expectedCash, 1000); assert.equal(drawer.reversalCount, 0);
      assert.equal(String((await Order.findById(other.orderId).lean()).saleSessionId), String(nextSale._id));
      assert.match((await close(String(nextSale._id))).message, /cannot close/);
      assert.equal((await Payment.findOne({ orderId: other.orderId }).lean()).reversal.saleDate, nextDate);

      // Actually collected now: the money lands in the drawer that takes it.
      await pay(other.orderId); await pay(later.orderId);
      assert.equal((await totals(nextSale._id)).expectedCash, 1000 + other.grandTotal + later.grandTotal);
      const reclosed = await close(String(nextSale._id));
      assert.equal(reclosed.ok, true, reclosed.message);
    });

    await t.test("a served takeaway finishes when collected again; an unfinished one keeps its kitchen stage", async () => {
      await signIn(cashier);
      await open(cashier, nextDate);
      const input = { ...base, orderType: "TAKEAWAY" }, quote = await previewTakeawayPayment(input);
      const paid = await completeTakeawayPayment(input, { idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: quote.grandTotal, tenderedAmount: quote.dueAmount, reference: "", notes: "" });
      assert.equal(paid.ok, true, paid.message);
      await signIn(owner);
      assert.equal((await reverseOrderPayment(paid.orderId, "Wrong order")).ok, true);
      assert.equal((await Order.findById(paid.orderId).lean()).status, "SENT_TO_KITCHEN");
      await signIn(cashier);
      await pay(paid.orderId);
      for (const next of ["READY", "SERVED", "COMPLETED"]) { await signIn(owner); assert.equal((await changeOrderStatus(paid.orderId, next)).ok, true, next); }
      assert.equal((await reverseOrderPayment(paid.orderId, "Wrong order again")).ok, true);
      assert.equal((await Order.findById(paid.orderId).lean()).status, "SERVED");
      await signIn(cashier);
      await pay(paid.orderId);
      assert.equal((await Order.findById(paid.orderId).lean()).status, "COMPLETED");
    });

    await t.test("the owner grants and revokes the right through the account form", async () => {
      const { saveUserAccount } = await import("../app/(dashboard)/users/actions.ts");
      const clerk = await account("rev.clerk", "CASHIER");
      const form = privileges => ({ fullName: clerk.fullName, phone: clerk.phone, username: clerk.username, password: "", role: "CASHIER", isActive: true, privileges });
      await signIn(cashier);
      const target = await place();
      await pay(target.orderId);

      await signIn(clerk);
      assert.match((await reverseOrderPayment(target.orderId, "Before the grant")).message, /permission/);

      await signIn(cashier);
      const refused = await saveUserAccount(String(clerk._id), form(["orders", "reverse_payments"])).catch(error => ({ ok: false, message: error.message }));
      assert.equal(refused.ok, false, "only an owner can grant it");

      await signIn(owner);
      const granted = await saveUserAccount(String(clerk._id), form(["orders", "reverse_payments"]));
      assert.equal(granted.ok, true, granted.message);
      await signIn(clerk);
      const reversed = await reverseOrderPayment(target.orderId, "After the grant");
      assert.equal(reversed.ok, true, reversed.message);

      await signIn(cashier);
      await pay(target.orderId);
      await signIn(owner);
      const revoked = await saveUserAccount(String(clerk._id), form(["orders"]));
      assert.equal(revoked.ok, true, revoked.message);
      await signIn(clerk);
      assert.match((await reverseOrderPayment(target.orderId, "After the revoke")).message, /permission/);
      assert.equal((await Order.findById(target.orderId).lean()).paymentStatus, "PAID");
    });

    await t.test("a delivered order stays delivered and can be collected again", async () => {
      const { Customer } = await import("../models/Customer.ts");
      const { changeDeliveryStatus } = await import("../app/(dashboard)/orders/actions.ts");
      const { completeDeliveryPayment } = await import("../app/(dashboard)/payments/actions.ts");
      const customer = await Customer.create({ businessId: business._id, name: "Rider Guest", phone: "03001112223", address: "12 Main Street" });
      await signIn(owner);
      const saved = await saveOrder({ ...base, orderType: "DELIVERY", customerId: String(customer._id), deliveryAddress: "12 Main Street", deliveryArea: "City" });
      assert.equal(saved.ok, true, saved.message);
      assert.equal((await changeOrderStatus(saved.orderId, "READY")).ok, true);
      const dispatched = await changeDeliveryStatus(saved.orderId, "OUT_FOR_DELIVERY");
      assert.equal(dispatched.ok, true, dispatched.message);
      const quote = await previewPaymentTax(saved.orderId, "CASH");
      const delivered = await completeDeliveryPayment({ orderId: saved.orderId, idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: quote.grandTotal, tenderedAmount: quote.dueAmount, reference: "", notes: "" });
      assert.equal(delivered.ok, true, delivered.message);

      const reversed = await reverseOrderPayment(saved.orderId, "Rider kept the cash");
      assert.equal(reversed.ok, true, reversed.message);
      const row = await Order.findById(saved.orderId).lean();
      assert.equal(row.paymentStatus, "UNPAID"); assert.equal(row.status, "SERVED"); assert.equal(row.deliveryStatus, "DELIVERED");

      await pay(saved.orderId);
      const collected = await Order.findById(saved.orderId).lean();
      assert.equal(collected.paymentStatus, "PAID"); assert.equal(collected.status, "COMPLETED"); assert.equal(collected.deliveryStatus, "DELIVERED");
    });

    await t.test("the coupon returns to the order and reward coupons cannot be earned twice", async () => {
      await signIn(cashier);
      const { Customer } = await import("../models/Customer.ts");
      const customer = await Customer.create({ businessId: business._id, name: "Guest", phone: "03009998887" });
      const batch = await CouponBatch.create({ businessId: business._id, name: "Ten off", discountType: "FIXED", discountValue: 10, usage: "INSTANT", quantity: 2, createdByUserId: owner._id, autoIssueEnabled: false });
      const reward = await CouponBatch.create({ businessId: business._id, name: "Reward", discountType: "FIXED", discountValue: 50, usage: "INSTANT", quantity: 2, createdByUserId: owner._id, autoIssueEnabled: true, autoIssueMinSpend: 1 });
      const held = await Coupon.create({ businessId: business._id, batchId: batch._id, code: "1234567890" });
      await Coupon.insertMany([{ businessId: business._id, batchId: reward._id, code: "2234567890" }, { businessId: business._id, batchId: reward._id, code: "3234567890" }]);
      const input = { ...base, orderType: "TAKEAWAY", customerId: String(customer._id), couponCode: held.code }, quote = await previewTakeawayPayment(input);
      assert.equal(quote.couponError, "", quote.couponError);
      const paid = await completeTakeawayPayment(input, { idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: quote.grandTotal, tenderedAmount: quote.dueAmount, reference: "", notes: "" });
      assert.equal(paid.ok, true, paid.message);
      assert.equal(paid.issuedCoupons.length, 1);
      const rewardOwned = () => Coupon.countDocuments({ batchId: reward._id, customerId: customer._id });
      assert.equal(await rewardOwned(), 1);

      await signIn(owner);
      assert.equal((await reverseOrderPayment(paid.orderId, "Customer changed mind")).ok, true);
      const couponRow = await Coupon.findById(held._id).lean();
      assert.equal(couponRow.status, "APPLIED"); assert.equal(couponRow.redeemedAt, undefined); assert.equal(String(couponRow.orderId), paid.orderId);
      assert.equal(await rewardOwned(), 0, "the unused reward is taken back");
      assert.equal((await Order.findById(paid.orderId).lean()).issuedCoupons, undefined);

      await signIn(cashier);
      await pay(paid.orderId);
      assert.equal((await Coupon.findById(held._id).lean()).status, "REDEEMED");
      assert.equal(await rewardOwned(), 1, "paying again earns the one reward, not a second");

      await signIn(owner);
      assert.equal((await reverseOrderPayment(paid.orderId, "Refunded")).ok, true);
      assert.equal((await cancelOrder(paid.orderId, "Customer left")).ok, true);
      assert.equal((await Coupon.findById(held._id).lean()).status, "ACTIVE", "cancelling gives the coupon back");
    });
  } finally {
    assert.match(mongoose.connection.name, /^pos_reversal_test_[a-f0-9]+$/);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    globalThis.mongooseConnection = undefined;
  }
});
