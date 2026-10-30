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
import { Customer } from "../models/Customer.ts";
import { Coupon } from "../models/Coupon.ts";
import { CouponBatch } from "../models/CouponBatch.ts";

const jar = new Map();
globalThis.__couponTestCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__couponTestCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("coupons: creation, single use, holds, next-visit rewards, ownership and isolation", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  const dbName = "pos_coupon_test_" + randomUUID().replaceAll("-", "");
  await mongoose.connect(process.env.MONGODB_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const coupons = await import("../app/(dashboard)/coupons/actions.ts");
    const { applyOrderCoupon, removeOrderCoupon, customerCoupons } = await import("../app/(dashboard)/payments/coupon-actions.ts");
    const { saveOrder, cancelOrder, previewTakeawayPayment, completeTakeawayPayment } = await import("../app/(dashboard)/orders/actions.ts");
    const { completeOrderPayment, previewPaymentTax } = await import("../app/(dashboard)/payments/actions.ts");
    const { GET: csvGET } = await import("../app/api/coupons/[batchId]/route.ts");
    await Promise.all([User.init(), Order.init(), Payment.init(), SaleSession.init(), Coupon.init(), CouponBatch.init()]);

    const a = await Business.create({ name: "Restaurant A", saleTaxRate: 16 }), b = await Business.create({ name: "Restaurant B", saleTaxRate: 0 });
    const passwordHash = await bcrypt.hash("CouponTest123", 10);
    const account = (business, username, role) => User.create({ businessId: business._id, fullName: username, phone: "03001234567", username, role, passwordHash });
    const owner = await account(a, "owner.coupon", "OWNER"), cashier = await account(a, "cashier.coupon", "CASHIER"), otherOwner = await account(b, "owner.other", "OWNER");
    const signIn = async user => { jar.clear(); const current = await User.findById(user._id); await createSession({ userId: String(current._id), businessId: String(current.businessId), role: current.role, authVersion: current.authVersion ?? 0 }); };
    for (const user of [owner, cashier, otherOwner]) await SaleSession.create({ businessId: user.businessId, userId: user._id, userNameSnapshot: user.fullName, counterName: user.username, counterKey: user.username, saleDate: "2026-08-14", openingBalance: 0 });
    const category = await Category.create({ businessId: a._id, name: "Mains" });
    const karahi = await Product.create({ businessId: a._id, categoryId: category._id, name: "Karahi", salePrice: 6000, costPrice: 3000 });
    const ali = await Customer.create({ businessId: a._id, name: "Ali", phone: "03001112233" }), sara = await Customer.create({ businessId: a._id, name: "Sara", phone: "03004445566" });
    const lines = quantity => [{ kind: "PRODUCT", id: String(karahi._id), quantity, note: "" }];
    const takeaway = (quantity, extra = {}) => ({ paymentMethod: "CASH", orderType: "TAKEAWAY", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines: lines(quantity), ...extra });
    const dineIn = (quantity, extra = {}) => ({ ...takeaway(quantity, extra), orderType: "DINE_IN" });
    const pay = (input, expected, couponCode) => completeTakeawayPayment({ ...input, couponCode }, { idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: expected, tenderedAmount: expected, reference: "", notes: "" });
    const azadi = { name: "Azadi Offer", discountType: "PERCENT", discountValue: 30, maxDiscount: 1500, minOrderAmount: 12000, usage: "INSTANT", validFrom: "", expiresOn: "2026-08-31", autoIssueEnabled: false, autoIssueMinSpend: 0, quantity: 50 };
    let azadiId, codes;

    await t.test("only the owner can create or download coupons", async () => {
      await signIn(cashier);
      const denied = await coupons.createCouponBatch(azadi);
      assert.equal(denied.ok, false); assert.match(denied.message, /Only the owner/);
      await signIn(owner);
      const created = await coupons.createCouponBatch(azadi);
      assert.equal(created.ok, true, created.message);
      azadiId = created.batchId;
      codes = (await Coupon.find({ batchId: azadiId }).lean()).map(row => row.code);
      assert.equal(codes.length, 50);
      assert.equal(new Set(codes).size, 50);
      assert.ok(codes.every(code => /^[1-9]\d{9}$/.test(code)));
      const csv = await csvGET(new Request("http://localhost"), { params: Promise.resolve({ batchId: azadiId }) });
      assert.equal(csv.status, 200); assert.ok((await csv.text()).includes(codes[0]));
      await signIn(cashier);
      assert.equal((await csvGET(new Request("http://localhost"), { params: Promise.resolve({ batchId: azadiId }) })).status, 403);
    });

    await t.test("a takeaway coupon is discounted before tax and works exactly once", async () => {
      await signIn(cashier);
      const preview = await previewTakeawayPayment(takeaway(2, { couponCode: codes[0] }));
      assert.equal(preview.ok, true); assert.equal(preview.couponError, "");
      assert.equal(preview.subtotal, 12000); assert.equal(preview.discountAmount, 1500); assert.equal(preview.taxAmount, 1680); assert.equal(preview.grandTotal, 12180);
      const paid = await pay(takeaway(2), 12180, codes[0]);
      assert.equal(paid.ok, true, paid.message);
      const coupon = await Coupon.findOne({ code: codes[0] }).lean(), order = await Order.findById(paid.orderId).lean();
      assert.equal(coupon.status, "REDEEMED"); assert.equal(String(coupon.orderId), paid.orderId); assert.equal(coupon.discountAmount, 1500);
      assert.equal(order.discountAmount, 1500); assert.equal(order.couponCode, codes[0]); assert.equal(order.grandTotal, 12180);
      assert.equal(Math.round(order.items.reduce((sum, line) => sum + line.discountAmount, 0) * 100), 150000);
      const again = await previewTakeawayPayment(takeaway(2, { couponCode: codes[0] }));
      assert.match(again.couponError, /already been used/); assert.equal(again.grandTotal, 13920, "totals fall back to no discount");
      const reuse = await pay(takeaway(2), 12180, codes[0]);
      assert.equal(reuse.ok, false); assert.match(reuse.message, /already been used/);
      // Two counters racing with the same code: the transaction lets exactly one succeed.
      const race = await Promise.all([pay(takeaway(2), 12180, codes[3]), pay(takeaway(2), 12180, codes[3])]);
      assert.equal(race.filter(result => result.ok).length, 1, JSON.stringify(race.map(result => result.message)));
      assert.equal(await Order.countDocuments({ couponCode: codes[3] }), 1);
      const small = await previewTakeawayPayment(takeaway(1, { couponCode: codes[1] }));
      assert.match(small.couponError, /Rs 12,000 or more/);
    });

    await t.test("a coupon held by an unpaid order is released on cancel or failed edit, then redeemed on payment", async () => {
      await signIn(cashier);
      const first = await saveOrder(dineIn(2)), second = await saveOrder(dineIn(2));
      assert.equal(first.ok && second.ok, true);
      const applied = await applyOrderCoupon(first.orderId, codes[2]);
      assert.equal(applied.ok, true, applied.message); assert.equal(applied.discountAmount, 1500);
      assert.equal((await Order.findById(first.orderId).lean()).grandTotal, 12180);
      const clash = await applyOrderCoupon(second.orderId, codes[2]);
      assert.equal(clash.ok, false); assert.match(clash.message, /another unpaid order/);
      await signIn(owner);
      assert.equal((await cancelOrder(first.orderId, "Guest left")).ok, true, "cashiers need the cancel permission, so the owner cancels");
      await signIn(cashier);
      assert.equal((await Coupon.findOne({ code: codes[2] }).lean()).status, "ACTIVE", "cancelling returns the coupon");
      assert.equal((await applyOrderCoupon(second.orderId, codes[2])).ok, true);
      // Editing below the minimum order hands the coupon back automatically.
      assert.equal((await saveOrder(dineIn(1), second.orderId)).ok, true);
      const edited = await Order.findById(second.orderId).lean();
      assert.equal(edited.discountAmount, 0); assert.equal(edited.couponCode, undefined);
      assert.equal((await Coupon.findOne({ code: codes[2] }).lean()).status, "ACTIVE");
      assert.equal((await saveOrder(dineIn(3), second.orderId)).ok, true);
      assert.equal((await applyOrderCoupon(second.orderId, codes[2])).ok, true);
      assert.equal((await removeOrderCoupon(second.orderId)).ok, true);
      assert.equal((await Order.findById(second.orderId).lean()).grandTotal, 20880);
      assert.equal((await applyOrderCoupon(second.orderId, codes[2])).ok, true);
      const quote = await previewPaymentTax(second.orderId, "CASH");
      assert.equal(quote.discountAmount, 1500); assert.equal(quote.grandTotal, Math.round((18000 - 1500) * 1.16 * 100) / 100);
      const paid = await completeOrderPayment({ orderId: second.orderId, idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: quote.grandTotal, tenderedAmount: quote.grandTotal, reference: "", notes: "" });
      assert.equal(paid.ok, true, paid.message);
      assert.equal((await Coupon.findOne({ code: codes[2] }).lean()).status, "REDEEMED");
    });

    await t.test("next-visit coupons are given automatically and only work for that customer on a later day", async () => {
      await signIn(owner);
      const reward = await coupons.createCouponBatch({ name: "Thank you", discountType: "FIXED", discountValue: 500, maxDiscount: null, minOrderAmount: 0, usage: "NEXT_VISIT", validFrom: "", expiresOn: "", autoIssueEnabled: true, autoIssueMinSpend: 10000, quantity: 2 });
      assert.equal(reward.ok, true, reward.message);
      await signIn(cashier);
      const walkIn = await pay(takeaway(2), 13920);
      assert.equal(walkIn.ok, true); assert.deepEqual(walkIn.issuedCoupons, [], "walk-in customers do not get assigned coupons");
      const small = await pay(takeaway(1, { customerId: String(ali._id) }), 6960);
      assert.deepEqual(small.issuedCoupons, [], "below the spend rule");
      const earned = await pay(takeaway(2, { customerId: String(ali._id) }), 13920);
      assert.equal(earned.issuedCoupons.length, 1);
      const code = earned.issuedCoupons[0].code, given = await Coupon.findOne({ code }).lean();
      assert.equal(String(given.customerId), String(ali._id)); assert.equal(given.assignmentSource, "AUTO"); assert.equal(given.issuedSaleDate, "2026-08-14");
      assert.equal((await Order.findById(earned.orderId).lean()).issuedCoupons[0].code, code);
      const sameDay = await previewTakeawayPayment(takeaway(1, { customerId: String(ali._id), couponCode: code }));
      assert.match(sameDay.couponError, /next visit/);
      assert.deepEqual((await customerCoupons(String(ali._id))).coupons, [], "not offered at the till before the next visit");
      await SaleSession.updateMany({ businessId: a._id }, { $set: { saleDate: "2026-08-15" } });
      const someoneElse = await previewTakeawayPayment(takeaway(1, { customerId: String(sara._id), couponCode: code }));
      assert.match(someoneElse.couponError, /another customer/);
      const nextVisit = await pay(takeaway(1, { customerId: String(ali._id) }), Math.round((6000 - 500) * 1.16 * 100) / 100, code);
      assert.equal(nextVisit.ok, true, nextVisit.message);
      assert.equal((await Coupon.findOne({ code }).lean()).status, "REDEEMED");
    });

    await t.test("the owner can give, take back, cancel and stop coupons", async () => {
      await signIn(owner);
      const given = await coupons.giveCouponToCustomer(azadiId, String(sara._id));
      assert.equal(given.ok, true, given.message); assert.equal(given.customerName, "Sara");
      await signIn(cashier);
      assert.deepEqual((await customerCoupons(String(sara._id))).coupons.map(item => item.code), [given.code]);
      await signIn(owner);
      const row = await Coupon.findOne({ code: given.code }).lean();
      assert.equal((await coupons.takeBackCoupon(String(row._id))).ok, true);
      assert.equal((await Coupon.findById(row._id).lean()).customerId, undefined);
      assert.equal((await coupons.voidCoupon(String(row._id), "Printed by mistake")).ok, true);
      await signIn(cashier);
      assert.match((await previewTakeawayPayment(takeaway(2, { couponCode: given.code }))).couponError, /cancelled/);
      await signIn(owner);
      assert.equal((await coupons.setCouponBatchActive(azadiId, false)).ok, true);
      await signIn(cashier);
      assert.match((await previewTakeawayPayment(takeaway(2, { couponCode: codes[5] }))).couponError, /stopped/);
      const list = await (async () => { await signIn(owner); return coupons.listBatchCoupons(azadiId, { status: "REDEEMED" }); })();
      assert.equal(list.total, 3, "two direct uses plus the race winner");
    });

    await t.test("another restaurant cannot see or use these coupons", async () => {
      await signIn(otherOwner);
      const product = await Product.create({ businessId: b._id, categoryId: (await Category.create({ businessId: b._id, name: "B" }))._id, name: "B item", salePrice: 20000, costPrice: 1 });
      const preview = await previewTakeawayPayment({ ...takeaway(1), lines: [{ kind: "PRODUCT", id: String(product._id), quantity: 1, note: "" }], couponCode: codes[6] });
      assert.match(preview.couponError, /not found/);
      assert.equal((await coupons.listBatchCoupons(azadiId, {})).total, 0);
      assert.equal((await coupons.setCouponBatchActive(azadiId, true)).ok, false);
    });

    assert.equal(await Coupon.countDocuments(), new Set((await Coupon.find().lean()).map(row => row.code)).size, "every code is unique");
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
