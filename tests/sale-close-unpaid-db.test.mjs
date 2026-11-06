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

const jar = new Map();
globalThis.__saleCloseCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__saleCloseCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("a sale cannot close while its invoices are unpaid", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_sale_close_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { saveOrder, cancelOrder } = await import("../app/(dashboard)/orders/actions.ts");
    const { previewPaymentTax, completeOrderPayment } = await import("../app/(dashboard)/payments/actions.ts");
    const { closeSale, ownerCloseCounter } = await import("../app/(dashboard)/sale-sessions/actions.ts");
    const { sessionTotals, sessionUnpaidOrders, sessionsUncollected } = await import("../lib/sale-sessions.ts");
    await Promise.all([User.init(), Order.init(), Payment.init(), SaleSession.init()]);

    const business = await Business.create({ name: "Close test" });
    const password = "OwnerPass123", passwordHash = await bcrypt.hash(password, 10);
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234567", username: "close.owner", role: "OWNER", passwordHash });
    const cashier = await User.create({ businessId: business._id, fullName: "Cashier", phone: "03001234568", username: "close.cashier", role: "CASHIER", passwordHash });
    const open = user => SaleSession.create({ businessId: business._id, userId: user._id, userNameSnapshot: user.fullName, counterName: user.username, counterKey: user.username, saleDate: "2026-11-06", openingBalance: 1000 });
    const signIn = async user => { jar.clear(); await createSession({ userId: String(user._id), businessId: String(business._id), role: user.role, authVersion: 0 }); };
    const category = await Category.create({ businessId: business._id, name: "Mains" });
    const product = await Product.create({ businessId: business._id, categoryId: category._id, name: "Karahi", salePrice: 1000, costPrice: 600 });
    const place = async () => {
      const saved = await saveOrder({ paymentMethod: "CASH", orderType: "DINE_IN", tableId: "", waiterId: "", customerId: "", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines: [{ kind: "PRODUCT", id: String(product._id), quantity: 1, note: "" }] });
      assert.equal(saved.ok, true, saved.message);
      return saved;
    };
    const pay = async orderId => {
      const quote = await previewPaymentTax(orderId, "CASH");
      assert.equal(quote.ok, true, quote.message);
      const paid = await completeOrderPayment({ orderId, idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: quote.grandTotal, tenderedAmount: quote.dueAmount, reference: "", notes: "" });
      assert.equal(paid.ok, true, paid.message);
    };
    const close = id => { const form = new FormData(); form.set("confirm", "yes"); return closeSale(id, undefined, form); };

    const ownerSale = await open(owner), cashierSale = await open(cashier);
    const cashierId = String(cashierSale._id);
    await signIn(cashier);
    const first = await place(), second = await place();

    await t.test("unpaid invoices are listed and totalled, and stay out of the balance", async () => {
      const unpaid = await sessionUnpaidOrders(String(business._id), cashierId);
      assert.deepEqual(unpaid.map(order => order.orderNumber).sort(), [first.orderNumber, second.orderNumber].sort());
      const uncollected = await sessionsUncollected(String(business._id), [cashierId, String(ownerSale._id)]);
      assert.deepEqual(uncollected.get(cashierId), { count: 2, amount: first.grandTotal + second.grandTotal });
      assert.equal(uncollected.has(String(ownerSale._id)), false);
      const totals = await sessionTotals(String(business._id), cashierId, 1000);
      assert.equal(totals.sales, 0);
      assert.equal(totals.balance, 1000);
    });

    await t.test("the cashier cannot close, and the sale stays open and usable", async () => {
      const before = await SaleSession.findById(cashierId).lean();
      const blocked = await close(cashierId);
      assert.notEqual(blocked.ok, true);
      assert.match(blocked.message, /cannot close/);
      assert.ok(blocked.message.includes(first.orderNumber) && blocked.message.includes(second.orderNumber), blocked.message);
      const after = await SaleSession.findById(cashierId).lean();
      assert.equal(after.status, "OPEN");
      assert.equal(after.closingTotals, undefined);
      assert.equal(after.revision, before.revision, "the rejected close must roll back");
    });

    await t.test("the owner cannot close that counter either, even with the right password", async () => {
      await signIn(owner);
      const blocked = await ownerCloseCounter(cashierId, password);
      assert.equal(blocked.ok, false);
      assert.match(blocked.message, /cannot close/);
      assert.equal((await SaleSession.findById(cashierId).lean()).status, "OPEN");
    });

    await t.test("another counter's unpaid invoices do not hold this sale open", async () => {
      await signIn(owner);
      const closed = await close(String(ownerSale._id));
      assert.equal(closed.ok, true, closed.message);
    });

    await t.test("one invoice left: still blocked after the other is paid", async () => {
      await signIn(cashier);
      await pay(first.orderId);
      assert.deepEqual((await sessionUnpaidOrders(String(business._id), cashierId)).map(order => order.orderNumber), [second.orderNumber]);
      const blocked = await close(cashierId);
      assert.match(blocked.message, new RegExp(second.orderNumber));
      assert.ok(!blocked.message.includes(first.orderNumber));
    });

    await t.test("a cancelled invoice no longer blocks, and the closing totals are exact", async () => {
      await signIn(owner);
      const cancelled = await cancelOrder(second.orderId, "Guest left");
      assert.equal(cancelled.ok, true, cancelled.message);
      assert.deepEqual(await sessionUnpaidOrders(String(business._id), cashierId), []);
      await signIn(cashier);
      const closed = await close(cashierId);
      assert.equal(closed.ok, true, closed.message);
      const row = await SaleSession.findById(cashierId).lean();
      assert.equal(row.status, "CLOSED");
      assert.equal(row.closingTotals.sales, first.grandTotal);
      assert.equal(row.closingTotals.balance, 1000 + first.grandTotal);
    });

    await t.test("a zero-total invoice has nothing to collect, so it cannot trap a sale open", async () => {
      await signIn(cashier);
      const next = await open(cashier);
      const saved = await place();
      await Order.updateOne({ _id: saved.orderId }, { $set: { grandTotal: 0, dueAmount: 0 } });
      const closed = await close(String(next._id));
      assert.equal(closed.ok, true, closed.message);
    });

    await t.test("the owner can close a counter once everything is collected", async () => {
      await signIn(cashier);
      const next = await open(cashier);
      await pay((await place()).orderId);
      await signIn(owner);
      const closed = await ownerCloseCounter(String(next._id), password);
      assert.equal(closed.ok, true, closed.message);
      assert.equal((await SaleSession.findById(next._id).lean()).closedByOwner, true);
    });
  } finally {
    assert.match(mongoose.connection.name, /^pos_sale_close_test_[a-f0-9]+$/);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    globalThis.mongooseConnection = undefined;
  }
});
