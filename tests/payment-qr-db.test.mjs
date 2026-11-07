import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import QRCode from "qrcode";
import { User } from "../models/User.ts";
import { Business } from "../models/Business.ts";
import { Order } from "../models/Order.ts";

const jar = new Map();
globalThis.__paymentQrCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__paymentQrCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);} export function notFound(){throw new Error('TEST_NOT_FOUND');}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("payment QR code: upload in Business profile, print on the chosen bills", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_payment_qr_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { savePaymentQr } = await import("../app/(dashboard)/settings/business/payment-actions.ts");
    const { buildPrintJob } = await import("../lib/receipt-print.ts");
    await Promise.all([User.init(), Order.init()]);
    const business = await Business.create({ name: "QR pay test", printerMode: "QZ" });
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001230000", username: "qr.owner", role: "OWNER", passwordHash: "x" });
    const cashier = await User.create({ businessId: business._id, fullName: "Cashier", phone: "03001230001", username: "qr.cashier", role: "CASHIER", passwordHash: "x" });
    const signIn = async user => { jar.clear(); await createSession({ userId: String(user._id), businessId: String(business._id), role: user.role, authVersion: 0 }); };
    const form = (values, file) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); if (file) data.set("paymentQr", file); return data; };
    const png = new File([await QRCode.toBuffer("raast://pay/03001234567", { width: 120 })], "qr.png", { type: "image/png" });
    const line = { lineId: "l1", itemType: "PRODUCT", nameSnapshot: "Karahi", quantity: 1, unitPrice: 1000, unitCost: 600, lineSubtotal: 1000, lineTax: 0, lineTotal: 1000 };
    const place = (paymentStatus, orderNumber) => Order.create({ businessId: business._id, orderNumber, orderType: "DINE_IN", status: "SENT_TO_KITCHEN", items: [line], subtotal: 1000, taxAmount: 0, grandTotal: 1000, paidAmount: paymentStatus === "PAID" ? 1000 : 0, dueAmount: paymentStatus === "PAID" ? 0 : 1000, paymentStatus, createdByUserId: owner._id });
    const unpaid = await place("UNPAID", "ORD-1"), paid = await place("PAID", "ORD-2");
    const qrPart = async orderId => (await buildPrintJob(String(business._id), String(orderId), "customer")).parts.find(part => part.type === "logo" && part.width);

    await t.test("only staff with settings access can change it", async () => {
      await signIn(cashier);
      await assert.rejects(savePaymentQr(undefined, form({ showOn: "ALL" }, png)));
      assert.equal((await Business.findById(business._id).lean()).paymentQrUrl, undefined);
    });

    await t.test("an uploaded QR prints on unpaid bills by default, with the caption", async () => {
      await signIn(owner);
      assert.equal(await qrPart(unpaid._id), undefined, "nothing uploaded yet");
      const saved = await savePaymentQr(undefined, form({ showOn: "UNPAID", caption: "  Scan to pay - Raast  " }, png));
      assert.equal(saved.ok, true, JSON.stringify(saved));
      assert.match(saved.url, /^\/api\/images\/[a-f\d]{24}$/);
      const stored = await Business.findById(business._id).lean();
      assert.deepEqual([stored.paymentQrUrl, stored.paymentQrCaption, stored.paymentQrShowOn], [saved.url, "Scan to pay - Raast", "UNPAID"]);
      const part = await qrPart(unpaid._id);
      assert.deepEqual(part, { type: "logo", url: saved.url, width: 304 });
      const text = (await buildPrintJob(String(business._id), String(unpaid._id), "customer")).parts.map(item => item.type === "command" ? Buffer.from(item.base64, "base64").toString("latin1") : "").join("");
      assert.ok(text.includes("Scan to pay - Raast"));
      assert.equal(await qrPart(paid._id), undefined, "paid receipts skip it in unpaid-only mode");
      // Kitchen tickets never carry the payment QR.
      assert.ok(!(await buildPrintJob(String(business._id), String(unpaid._id), "kitchen")).parts.some(item => item.type === "logo"));
    });

    await t.test("both paid & unpaid, then don't print, keep the image without re-uploading it", async () => {
      const url = (await Business.findById(business._id).lean()).paymentQrUrl;
      assert.equal((await savePaymentQr(undefined, form({ showOn: "ALL", caption: "Scan to pay - Raast" }))).ok, true);
      assert.equal((await qrPart(paid._id))?.url, url);
      assert.equal((await savePaymentQr(undefined, form({ showOn: "NEVER", caption: "" }))).ok, true);
      const stored = await Business.findById(business._id).lean();
      assert.deepEqual([stored.paymentQrUrl, stored.paymentQrCaption, stored.paymentQrShowOn], [url, undefined, "NEVER"]);
      assert.equal(await qrPart(unpaid._id), undefined);
    });

    await t.test("bad input is refused and changes nothing", async () => {
      const before = await Business.findById(business._id).lean();
      assert.ok((await savePaymentQr(undefined, form({ showOn: "SOMETIMES" }))).errors?.showOn);
      assert.ok((await savePaymentQr(undefined, form({ showOn: "ALL", caption: "x".repeat(81) }))).errors?.caption);
      const fake = new File([Buffer.from("not an image")], "qr.png", { type: "image/png" });
      const refused = await savePaymentQr(undefined, form({ showOn: "ALL" }, fake));
      assert.equal(refused.ok, undefined);
      assert.match(refused.message, /JPG, PNG, or WebP/);
      const after = await Business.findById(business._id).lean();
      assert.deepEqual([after.paymentQrUrl, after.paymentQrShowOn], [before.paymentQrUrl, before.paymentQrShowOn]);
    });

    await t.test("removing the image stops it printing", async () => {
      const removed = await savePaymentQr(undefined, form({ showOn: "ALL", remove: "YES" }));
      assert.deepEqual([removed.ok, removed.url], [true, null]);
      assert.equal((await Business.findById(business._id).lean()).paymentQrUrl, undefined);
      assert.equal(await qrPart(unpaid._id), undefined);
    });
  } finally {
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
