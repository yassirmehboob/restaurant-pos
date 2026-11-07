import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { User } from "../models/User.ts";
import { Business } from "../models/Business.ts";
import { Order } from "../models/Order.ts";
import { Product } from "../models/Product.ts";
import { Category } from "../models/Category.ts";
import { MenuTranslation } from "../models/MenuTranslation.ts";

const jar = new Map();
globalThis.__translationCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__translationCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("kitchen translations: owner approval, NLLB suggestions offline, and the printed ticket", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET, timeout: 240000 }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_translation_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { saveTranslation, suggestTranslations, approveSuggestions } = await import("../app/(dashboard)/settings/translations/actions.ts");
    const { updatePrintingSettings } = await import("../app/(dashboard)/settings/printing/actions.ts");
    const { buildPrintJob } = await import("../lib/receipt-print.ts");
    const { decodeEscPos } = await import("../lib/receipt-raster.ts");
    const { modelReady } = await import("../lib/translation/nllb.ts");
    await Promise.all([User.init(), MenuTranslation.init()]);

    const business = await Business.create({ name: "Translation test" });
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234567", username: "tr.owner", role: "OWNER", passwordHash: "x" });
    const cashier = await User.create({ businessId: business._id, fullName: "Cashier", phone: "03001234568", username: "tr.cashier", role: "CASHIER", passwordHash: "x" });
    const signIn = async user => { jar.clear(); await createSession({ userId: String(user._id), businessId: String(business._id), role: user.role, authVersion: 0 }); };
    const category = await Category.create({ businessId: business._id, name: "Fast food" });
    await Product.create({ businessId: business._id, categoryId: category._id, name: "Chicken Burger", salePrice: 400, costPrice: 200 });
    await Product.create({ businessId: business._id, categoryId: category._id, name: "Pizza", salePrice: 600, costPrice: 300, variants: [{ name: "Small", salePrice: 600, costPrice: 300 }] });
    await Product.create({ businessId: business._id, categoryId: category._id, name: "Beef Burger", salePrice: 550, costPrice: 300 });
    const line = (name, quantity) => ({ lineId: randomUUID(), itemType: "PRODUCT", nameSnapshot: name, quantity, unitPrice: 100, unitCost: 50, lineSubtotal: 100, lineTax: 0, lineTotal: 100 });
    const order = await Order.create({ businessId: business._id, orderNumber: "ORD-000001", orderType: "DINE_IN", items: [line("Chicken Burger", 2), line("Pizza (Small)", 1), line("Beef Burger", 1)], subtotal: 400, taxAmount: 0, grandTotal: 400, dueAmount: 400, createdByUserId: owner._id });
    const ticket = async () => {
      const job = await buildPrintJob(String(business._id), String(order._id), "kitchen");
      const rows = job.parts.flatMap(part => part.type === "command" ? decodeEscPos(part.base64) : []).filter(row => row.kind === "text");
      return { family: job.family, rtl: rows.filter(row => row.rtl).map(row => row.text), english: rows.filter(row => !row.rtl).map(row => row.text.trim()) };
    };
    const settings = language => { const form = new FormData(); for (const [key, value] of Object.entries({ receiptPaperWidth: "80", showOrderReadyTime: "NO", showLogoOnCustomerReceipt: "YES", showPricesOnKitchenReceipt: "NO", printerMode: "QZ", onePrinterMode: "YES", customerPrinterConnection: "USB", customerPrinterPort: "9100", kitchenPrinterConnection: "USB", kitchenPrinterPort: "9100", customerPrintingEnabled: "YES", kitchenPrintingEnabled: "YES", autoPrintCustomerOnPayment: "NO", autoPrintUnpaidDineIn: "NO", unpaidDineInReceiptCopies: "1", customerReceiptCopies: "1", kitchenReceiptCopies: "1", customerReceiptFont: "STANDARD", customerReceiptSize: "NORMAL", kitchenReceiptFont: "STANDARD", kitchenReceiptSize: "NORMAL", customerReceiptFamily: "PRINTER", kitchenReceiptFamily: "PRINTER", kitchenReceiptLanguage: language })) form.set(key, value); return updatePrintingSettings(undefined, form); };

    await t.test("only staff with settings access manage translations, and only for menu names", async () => {
      await signIn(cashier);
      assert.equal((await saveTranslation({ text: "Chicken Burger", sd: "", ur: "چکن برگر" })).ok, false);
      await signIn(owner);
      const stray = await saveTranslation({ text: "Not on the menu", sd: "", ur: "کچھ" });
      assert.equal(stray.ok, false);
      assert.match(stray.message, /no longer on the menu/);
    });

    await t.test("the kitchen language setting saves, and English tickets stay in the printer font", async () => {
      const saved = await settings("EN_UR");
      assert.equal(saved.ok, true, JSON.stringify(saved));
      assert.equal((await Business.findById(business._id).lean()).kitchenReceiptLanguage, "EN_UR");
      assert.equal((await settings("KLINGON")).ok, undefined, "an unknown language is refused");
      const plain = await ticket();
      assert.deepEqual([plain.rtl, plain.family], [[], "PRINTER"], "nothing approved yet: English, raw printing");
    });

    await t.test("approved Urdu prints under the English name, drawn as an image", async () => {
      { const saved = await saveTranslation({ text: "Chicken Burger", sd: "", ur: "چکن برگر" }); assert.equal(saved.ok, true, saved.message); }
      assert.equal((await saveTranslation({ text: "Pizza (Small)", sd: "", ur: "پیزا (چھوٹا)" })).ok, true);
      const both = await ticket();
      assert.deepEqual(both.rtl, ["چکن برگر", "پیزا (چھوٹا)"]);
      assert.equal(both.family, "TAHOMA", "Urdu cannot print in the raw printer font");
      assert.ok(both.english.some(row => row.includes("Chicken Burger")) && both.english.some(row => row.includes("Beef Burger")));
      await settings("UR");
      const only = await ticket();
      assert.ok(!only.english.some(row => row.includes("Chicken Burger")), "Urdu only replaces the English name");
      assert.ok(only.english.some(row => row.includes("Beef Burger")), "an untranslated name stays English");
      await settings("SD");
      assert.deepEqual((await ticket()).rtl, [], "no Sindhi approved yet");
    });

    await t.test("emptying a box removes that translation from the ticket", async () => {
      await settings("UR");
      assert.equal((await saveTranslation({ text: "Pizza (Small)", sd: "", ur: "" })).ok, true);
      assert.deepEqual((await ticket()).rtl, ["چکن برگر"]);
      assert.equal((await MenuTranslation.findOne({ businessId: business._id, text: "Pizza (Small)" }).lean()).urStatus, undefined);
    });

    await t.test("NLLB suggests offline; a suggestion prints only after approval", { skip: !modelReady() && "translation model not installed (npm run translation:download)" }, async () => {
      await settings("SD");
      const result = await suggestTranslations({ texts: ["Beef Burger", "Chicken Burger"], language: "sd" });
      assert.equal(result.ok, true, result.message);
      for (const text of ["Beef Burger", "Chicken Burger"]) assert.match(result.suggestions[text], /[؀-ۿ]/, `${text}: ${result.suggestions[text]}`);
      const stored = await MenuTranslation.findOne({ businessId: business._id, text: "Beef Burger" }).lean();
      assert.equal(stored.sdStatus, "SUGGESTED");
      assert.deepEqual((await ticket()).rtl, [], "suggestions do not print");
      // The owner corrects one; approving all then accepts the other as suggested.
      assert.equal((await saveTranslation({ text: "Beef Burger", sd: "بيف برگر", ur: "" })).ok, true);
      const approved = await approveSuggestions("sd");
      assert.deepEqual([approved.ok, approved.approved], [true, 1]);
      const printed = await ticket();
      assert.equal(printed.rtl.length, 2);
      assert.ok(printed.rtl.includes("بيف برگر"), printed.rtl.join(" | "));
      // A new suggestion never replaces the owner's approved wording.
      await suggestTranslations({ texts: ["Beef Burger"], language: "sd" });
      assert.equal((await MenuTranslation.findOne({ businessId: business._id, text: "Beef Burger" }).lean()).sd, "بيف برگر");
    });
  } finally {
    assert.match(mongoose.connection.name, /^pos_translation_test_[a-f0-9]+$/);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    globalThis.mongooseConnection = undefined;
  }
});
