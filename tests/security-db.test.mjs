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
globalThis.__securityTestCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__securityTestCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("security: authorization, tenant isolation, sessions and payment integrity", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_security_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession, deleteSession } = await import("../lib/auth/session.ts");
    const { getCurrentUser } = await import("../data/auth.ts");
    const { saveUserAccount, saveOwnerProfile } = await import("../app/(dashboard)/users/actions.ts");
    const { saveOrder, cancelOrder, changeOrderStatus } = await import("../app/(dashboard)/orders/actions.ts");
    const { completeOrderPayment, previewPaymentTax } = await import("../app/(dashboard)/payments/actions.ts");
    const { GET: imageGET } = await import("../app/api/images/[id]/route.ts");
    const { GET: csvGET } = await import("../app/api/reports/sales.csv/route.ts");
    const { createProduct } = await import("../app/(dashboard)/master-actions.ts");
    const { uploadImage } = await import("../lib/uploads.ts");
    await Promise.all([User.init(), Order.init(), Payment.init(), SaleSession.init()]);
    const a = await Business.create({ name: "Restaurant A", saleTaxRate: 0 }), b = await Business.create({ name: "Restaurant B", saleTaxRate: 0 });
    const password = "SecurityTest123", passwordHash = await bcrypt.hash(password, 12);
    const account = (business, username, role) => User.create({ businessId: business._id, fullName: username, phone: "03001234567", username, role, passwordHash });
    const owner = await account(a, "owner.a", "OWNER"), otherOwner = await account(b, "owner.b", "OWNER"), cashier = await account(a, "cashier.a", "CASHIER"), waiter = await account(a, "waiter.a", "WAITER");
    const signIn = async user => { const current = await User.findById(user._id); await createSession({ userId: String(current._id), businessId: String(current.businessId), role: current.role, authVersion: current.authVersion ?? 0 }); return jar.get("restaurant_pos_session"); };
    const useCookie = value => { jar.clear(); if (value) jar.set("restaurant_pos_session", value); };
    const saleDate = "2026-10-28";
    for (const user of [owner, otherOwner, cashier]) await SaleSession.create({ businessId: user.businessId, userId: user._id, userNameSnapshot: user.fullName, counterName: user.username, counterKey: user.username, saleDate, openingBalance: 0 });
    const categoryA = await Category.create({ businessId: a._id, name: "A category" }), categoryB = await Category.create({ businessId: b._id, name: "B category" });
    const product = await Product.create({ businessId: a._id, categoryId: categoryA._id, name: "Test burger", salePrice: 100, costPrice: 40 });
    const input = { paymentMethod: "CASH", orderType: "DINE_IN", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines: [{ kind: "PRODUCT", id: String(product._id), quantity: 1, note: "", salePrice: 1 }] };
    const foreign = await Order.create({ businessId: b._id, orderNumber: "FOREIGN-ORDER", orderType: "DINE_IN", status: "SENT_TO_KITCHEN", items: [], subtotal: 999, taxAmount: 0, grandTotal: 999, paidAmount: 0, dueAmount: 999, createdByUserId: otherOwner._id });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/bcAAAAASUVORK5CYII=", "base64");
    const foreignImage = await uploadImage(new File([png], "foreign.png", { type: "image/png" }), `business-${b._id}/products`);
    const query = { params: Promise.resolve({ id: foreignImage.split("/").at(-1) }) };
    const reportURL = "http://localhost/api/reports/sales.csv?range=CUSTOM&from=2026-10-28&to=2026-10-28";

    await t.test("anonymous requests cannot read reports, images or mutate orders", async () => {
      jar.clear();
      assert.equal((await imageGET(new Request("http://localhost"), query)).status, 401);
      assert.equal((await csvGET(new Request(reportURL))).status, 401);
      assert.equal((await saveOrder(input)).ok, false);
      assert.equal(await Order.countDocuments({ businessId: a._id }), 0);
    });
    await t.test("staff cannot bypass owner-only or payment permissions", async () => {
      await signIn(waiter);
      await assert.rejects(saveUserAccount(undefined, {}), /Only the restaurant owner/);
      await assert.rejects(previewPaymentTax(String(foreign._id), "CASH"), /permission/);
      assert.equal((await csvGET(new Request(reportURL))).status, 403);
    });
    await t.test("authorized owner cannot modify another restaurant's records", async () => {
      await signIn(owner);
      assert.equal((await saveOrder(input, String(foreign._id))).ok, false);
      assert.equal((await cancelOrder(String(foreign._id), "Cross tenant attempt")).ok, false);
      assert.equal((await changeOrderStatus(String(foreign._id), "PREPARING")).ok, false);
      assert.equal((await previewPaymentTax(String(foreign._id), "CASH")).ok, false);
      const form = new FormData();
      for (const [key, value] of Object.entries({ categoryId: String(categoryB._id), name: "Illegal category", description: "", salePrice: "10", costPrice: "5", taxRate: "0" })) form.set(key, value);
      assert.match((await createProduct(undefined, form)).message, /active category/);
      assert.equal((await imageGET(new Request("http://localhost"), query)).status, 404);
      const ownImage = await uploadImage(new File([png], "own.png", { type: "image/png" }), `business-${a._id}/products`);
      const response = await imageGET(new Request("http://localhost"), { params: Promise.resolve({ id: ownImage.split("/").at(-1) }) });
      assert.equal(response.status, 200); assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.equal((await Order.findById(foreign._id)).status, "SENT_TO_KITCHEN");
    });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    await t.test("prices are server-calculated and concurrent payment attempts collect once", { skip: !hello.setName && hello.msg !== "isdbgrid" }, async () => {
      await signIn(owner);
      const saved = await saveOrder(input); assert.equal(saved.ok, true); assert.equal(saved.grandTotal, 100);
      const orderId = saved.orderId, request = { orderId, idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: 100, tenderedAmount: 100, reference: "", notes: "" };
      assert.equal((await changeOrderStatus(orderId, "__proto__")).ok, false);
      assert.equal((await cancelOrder(orderId, "x".repeat(501))).ok, false);
      assert.equal((await completeOrderPayment({ ...request, expectedGrandTotal: 1 })).ok, false);
      assert.equal((await completeOrderPayment({ ...request, tenderedAmount: 1 })).ok, false);
      assert.equal((await completeOrderPayment({ ...request, orderId: String(foreign._id) })).ok, false);
      assert.equal(await Payment.countDocuments({ orderId }), 0);
      // Completion is a financial terminal state and cannot bypass payment.
      await Order.updateOne({ _id: orderId }, { $set: { status: "SERVED" } });
      assert.equal((await changeOrderStatus(orderId, "COMPLETED")).ok, false);
      const outcomes = await Promise.all([completeOrderPayment(request), completeOrderPayment({ ...request, idempotencyKey: randomUUID() })]);
      assert.equal(outcomes.filter(result => result.ok).length, 1);
      assert.equal(await Payment.countDocuments({ orderId }), 1);
      const paid = await Order.findById(orderId); assert.equal(paid.paidAmount, 100); assert.equal(paid.status, "COMPLETED");
      assert.equal((await cancelOrder(orderId, "Cannot cancel paid order")).ok, false);
      await Order.updateOne({ _id: orderId }, { $set: { "customerSnapshot.name": "=1+1" } });
      const response = await csvGET(new Request(reportURL)); assert.equal(response.status, 200);
      const body = await response.text(); assert.ok(!body.includes("FOREIGN-ORDER")); assert.ok(body.includes('"\'=1+1"'));
    });
    await t.test("owner credential changes require reauthentication and revoke older sessions", async () => {
      const old = await signIn(owner), update = { fullName: owner.fullName, phone: "03001234567", username: owner.username, password: "ChangedPassword123" };
      assert.equal((await saveOwnerProfile(update)).ok, false);
      assert.equal((await saveOwnerProfile({ ...update, currentPassword: password })).ok, true);
      const renewed = jar.get("restaurant_pos_session"); assert.notEqual(old, renewed);
      useCookie(old); assert.equal(await getCurrentUser(), null);
      useCookie(renewed); assert.equal((await getCurrentUser()).id, String(owner._id));
      // Staff password resets invalidate active tokens without disabling 2FA.
      const staffCookie = await signIn(cashier); useCookie(renewed);
      assert.equal((await saveUserAccount(String(cashier._id), { fullName: cashier.fullName, phone: "03001234567", username: cashier.username, password: "ResetPassword123", role: "CASHIER", isActive: true, privileges: ["pos", "orders", "payments", "sale_sessions"] })).ok, true);
      useCookie(staffCookie); assert.equal(await getCurrentUser(), null);
    });
    await t.test("logout revokes the token even if a copied cookie is replayed", async () => {
      const token = await signIn(owner); await deleteSession(); assert.equal(jar.size, 0);
      useCookie(token); assert.equal(await getCurrentUser(), null);
      const fresh = await signIn(owner); assert.notEqual(fresh, token); assert.ok(await getCurrentUser());
    });
  } finally {
    jar.clear(); delete globalThis.mongooseConnection;
    assert.match(mongoose.connection.name, /^pos_security_test_[a-f0-9]+$/);
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
