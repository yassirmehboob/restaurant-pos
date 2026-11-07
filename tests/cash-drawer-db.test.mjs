import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { User } from "../models/User.ts";
import { Business } from "../models/Business.ts";
import { Order } from "../models/Order.ts";
import { Payment } from "../models/Payment.ts";
import { SaleSession } from "../models/SaleSession.ts";
import { Product } from "../models/Product.ts";
import { Category } from "../models/Category.ts";

const jar = new Map();
globalThis.__drawerCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__drawerCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("cash drawer: printing settings and the payment that opens it", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_drawer_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { updatePrintingSettings } = await import("../app/(dashboard)/settings/printing/actions.ts");
    const { saveOrder, completeTakeawayPayment, previewTakeawayPayment } = await import("../app/(dashboard)/orders/actions.ts");
    const { previewPaymentTax, completeOrderPayment } = await import("../app/(dashboard)/payments/actions.ts");
    await Promise.all([User.init(), Order.init(), Payment.init(), SaleSession.init()]);

    const business = await Business.create({ name: "Drawer test" });
    const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234567", username: "dr.owner", role: "OWNER", passwordHash: "x" });
    const cashier = await User.create({ businessId: business._id, fullName: "Cashier", phone: "03001234568", username: "dr.cashier", role: "CASHIER", passwordHash: "x" });
    const signIn = async user => { jar.clear(); await createSession({ userId: String(user._id), businessId: String(business._id), role: user.role, authVersion: 0 }); };
    await SaleSession.create({ businessId: business._id, userId: cashier._id, userNameSnapshot: cashier.fullName, counterName: cashier.username, counterKey: cashier.username, saleDate: "2026-11-07", openingBalance: 1000 });
    const category = await Category.create({ businessId: business._id, name: "Mains" });
    const product = await Product.create({ businessId: business._id, categoryId: category._id, name: "Karahi", salePrice: 1000, costPrice: 600 });
    const base = { paymentMethod: "CASH", tableId: "", waiterId: "", customerId: "", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines: [{ kind: "PRODUCT", id: String(product._id), quantity: 1, note: "" }] };

    const settings = (drawer = {}, mode = "QZ") => { const form = new FormData(); for (const [key, value] of Object.entries({ receiptPaperWidth: "80", showOrderReadyTime: "NO", showLogoOnCustomerReceipt: "YES", showPricesOnKitchenReceipt: "NO", printerMode: mode, onePrinterMode: "YES", customerPrinterConnection: "USB", customerPrinterName: "EPSON TM-T88V Receipt", customerPrinterPort: "9100", kitchenPrinterConnection: "USB", kitchenPrinterPort: "9100", customerPrintingEnabled: "YES", kitchenPrintingEnabled: "YES", autoPrintCustomerOnPayment: "NO", autoPrintUnpaidDineIn: "NO", unpaidDineInReceiptCopies: "1", customerReceiptCopies: "1", kitchenReceiptCopies: "1", customerReceiptFont: "STANDARD", customerReceiptSize: "NORMAL", kitchenReceiptFont: "STANDARD", kitchenReceiptSize: "NORMAL", customerReceiptFamily: "PRINTER", kitchenReceiptFamily: "PRINTER", ...drawer })) form.set(key, value); return updatePrintingSettings(undefined, form); };
    const dineIn = async method => {
      const saved = await saveOrder({ ...base, orderType: "DINE_IN" }); assert.equal(saved.ok, true, saved.message);
      const quote = await previewPaymentTax(saved.orderId, method); assert.equal(quote.ok, true, quote.message);
      const paid = await completeOrderPayment({ orderId: saved.orderId, idempotencyKey: randomUUID(), method, expectedGrandTotal: quote.grandTotal, tenderedAmount: quote.dueAmount, reference: method === "CASH" ? "" : "REF-1", notes: "" });
      assert.equal(paid.ok, true, paid.message); return paid;
    };
    const takeaway = async method => {
      const input = { ...base, orderType: "TAKEAWAY", paymentMethod: method }, quote = await previewTakeawayPayment(input);
      const paid = await completeTakeawayPayment(input, { idempotencyKey: randomUUID(), method, expectedGrandTotal: quote.grandTotal, tenderedAmount: quote.dueAmount, reference: method === "CASH" ? "" : "REF-1", notes: "" });
      assert.equal(paid.ok, true, paid.message); return paid;
    };
    const drawerOf = async () => { const row = await Business.findById(business._id).lean(); return [row.cashDrawerOpenOn, row.cashDrawerPin]; };
    const receiptPrinter = { connection: "USB", name: "EPSON TM-T88V Receipt", host: "", port: 9100 };

    await t.test("the drawer is off until the owner turns it on, and a form without drawer fields keeps it", async () => {
      await signIn(owner);
      assert.equal((await settings()).ok, true);
      assert.deepEqual(await drawerOf(), ["NEVER", "PIN2"]);
      await signIn(cashier);
      assert.equal((await dineIn("CASH")).cashDrawer, null, "nothing opens while it is off");
      await signIn(owner);
      assert.equal((await settings({ cashDrawerOpenOn: "CASH", cashDrawerPin: "PIN5" })).ok, true);
      assert.deepEqual(await drawerOf(), ["CASH", "PIN5"]);
      assert.equal((await settings()).ok, true);
      assert.deepEqual(await drawerOf(), ["CASH", "PIN5"], "an older form leaves the drawer as set");
      assert.equal((await settings({ cashDrawerOpenOn: "SOMETIMES" })).ok, undefined, "an unknown choice is refused");
    });

    await t.test("cash payments open it on the receipt printer: dine-in and takeaway, not card", async () => {
      await signIn(cashier);
      assert.deepEqual((await dineIn("CASH")).cashDrawer, { printer: receiptPrinter, pin: "PIN5" });
      assert.deepEqual((await takeaway("CASH")).cashDrawer, { printer: receiptPrinter, pin: "PIN5" });
      assert.equal((await dineIn("CARD")).cashDrawer, null);
      assert.equal((await takeaway("CARD")).cashDrawer, null);
    });

    await t.test("'every payment' opens it for card too; browser printing never does", async () => {
      await signIn(owner);
      assert.equal((await settings({ cashDrawerOpenOn: "ALL", cashDrawerPin: "PIN2" })).ok, true);
      await signIn(cashier);
      assert.deepEqual((await dineIn("CARD")).cashDrawer, { printer: receiptPrinter, pin: "PIN2" });
      await signIn(owner);
      assert.equal((await settings({}, "BROWSER")).ok, true);
      await signIn(cashier);
      assert.equal((await dineIn("CASH")).cashDrawer, null, "the print dialog cannot open a drawer");
    });
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});
