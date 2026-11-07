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
import { Payment } from "../models/Payment.ts";
import { RestaurantTable } from "../models/RestaurantTable.ts";
import { WaiterRequest } from "../models/WaiterRequest.ts";

const jar = new Map();
globalThis.__kitchenPrintCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__kitchenPrintCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("one-printer mode prints the kitchen ticket from the counter", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_kitchen_print_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession } = await import("../lib/auth/session.ts");
    const { saveOrder, completeTakeawayPayment, saveWaiterRequest, confirmWaiterRequest } = await import("../app/(dashboard)/orders/actions.ts");
    const { completeOrderPayment } = await import("../app/(dashboard)/payments/actions.ts");
    const { buildPrintJob } = await import("../lib/receipt-print.ts");
    await Promise.all([User.init(), Order.init(), Payment.init(), SaleSession.init()]);
    const business = await Business.create({ name: "Kitchen print test", saleTaxRate: 0, printerMode: "QZ", customerPrinterConnection: "LAN", customerPrinterHost: "192.168.1.50", kitchenPrinterConnection: "LAN", kitchenPrinterHost: "192.168.1.60" });
    const cashier = await User.create({ businessId: business._id, fullName: "Cashier", phone: "03001234567", username: "print.cashier", role: "CASHIER", passwordHash: "x" });
    await createSession({ userId: String(cashier._id), businessId: String(business._id), role: "CASHIER", authVersion: 0 });
    await SaleSession.create({ businessId: business._id, userId: cashier._id, userNameSnapshot: cashier.fullName, counterName: "Main", counterKey: "main", saleDate: "2026-11-02", openingBalance: 0 });
    const category = await Category.create({ businessId: business._id, name: "Mains" });
    const karahi = await Product.create({ businessId: business._id, categoryId: category._id, name: "Chicken Karahi", salePrice: 1000, costPrice: 600 });
    const order = orderType => ({ paymentMethod: "CASH", orderType, tableId: "", waiterId: "", customerId: "", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines: [{ kind: "PRODUCT", id: String(karahi._id), quantity: 1, note: "" }] });
    const pay = (orderId, grandTotal) => ({ orderId, idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: grandTotal, tenderedAmount: grandTotal, reference: "", notes: "" });
    const settings = values => Business.updateOne({ _id: business._id }, { $set: values });

    await t.test("a new dine-in order asks the counter to print the kitchen ticket", async () => {
      const created = await saveOrder(order("DINE_IN"));
      assert.equal(created.ok, true, created.message);
      assert.deepEqual([created.printKitchen, created.printerMode], [true, "QZ"]);
      const job = await buildPrintJob(String(business._id), created.orderId, "kitchen");
      assert.deepEqual([job.role, job.printer.host], ["customer", "192.168.1.50"]);
      // Editing the order or paying for it later does not reprint the ticket.
      const edited = await saveOrder(order("DINE_IN"), created.orderId);
      assert.equal(edited.ok, true, edited.message);
      assert.equal(edited.printKitchen, false);
      const paid = await completeOrderPayment(pay(created.orderId, 1000));
      assert.equal(paid.ok, true, paid.message);
      assert.equal(paid.printKitchen, false);
    });

    await t.test("a paid takeaway order prints the kitchen ticket", async () => {
      const paid = await completeTakeawayPayment(order("TAKEAWAY"), { idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: 1000, tenderedAmount: 1000, reference: "", notes: "" });
      assert.equal(paid.ok, true, paid.message);
      assert.equal(paid.printKitchen, true);
    });

    await t.test("separate printers or kitchen printing off skip the counter kitchen ticket", async () => {
      await settings({ onePrinterMode: false });
      const separate = await saveOrder(order("DINE_IN"));
      assert.equal(separate.printKitchen, false);
      assert.equal((await buildPrintJob(String(business._id), separate.orderId, "kitchen")).role, "kitchen");
      await settings({ onePrinterMode: true, kitchenPrintingEnabled: false });
      assert.equal((await saveOrder(order("DINE_IN"))).printKitchen, false);
    });

    await t.test("saved receipt font and size reach the printed job", async () => {
      const { updatePrintingSettings } = await import("../app/(dashboard)/settings/printing/actions.ts");
      const owner = await User.create({ businessId: business._id, fullName: "Owner", phone: "03001234568", username: "print.owner", role: "OWNER", passwordHash: "x" });
      jar.clear();
      await createSession({ userId: String(owner._id), businessId: String(business._id), role: "OWNER", authVersion: 0 });
      const form = new FormData();
      for (const [name, value] of Object.entries({ receiptPaperWidth: "80", receiptHeader: "", receiptFooter: "Thanks", showOrderReadyTime: "NO", showLogoOnCustomerReceipt: "NO", showPricesOnKitchenReceipt: "NO", printerMode: "QZ", onePrinterMode: "YES", customerPrinterName: "", kitchenPrinterName: "", customerPrinterConnection: "LAN", customerPrinterHost: "192.168.1.50", customerPrinterPort: "9100", kitchenPrinterConnection: "LAN", kitchenPrinterHost: "192.168.1.60", kitchenPrinterPort: "9100", customerPrintingEnabled: "YES", kitchenPrintingEnabled: "YES", autoPrintCustomerOnPayment: "NO", autoPrintUnpaidDineIn: "NO", unpaidDineInReceiptCopies: "1", customerReceiptCopies: "1", kitchenReceiptCopies: "1", customerReceiptFont: "BOLD", customerReceiptSize: "NORMAL", kitchenReceiptFont: "COMPACT", kitchenReceiptSize: "LARGE", customerReceiptFamily: "ARIAL", kitchenReceiptFamily: "PRINTER" })) form.set(name, value);
      const saved = await updatePrintingSettings(undefined, form);
      assert.equal(saved.ok, true, JSON.stringify(saved));
      const stored = await Business.findById(business._id).lean();
      assert.deepEqual([stored.customerReceiptFont, stored.customerReceiptSize, stored.kitchenReceiptFont, stored.kitchenReceiptSize], ["BOLD", "NORMAL", "COMPACT", "LARGE"]);
      const orderId = String((await Order.findOne({ businessId: business._id }).lean())._id);
      const bytes = job => Buffer.from(job.parts.at(-1).base64, "base64").toString("latin1");
      assert.match(bytes(await buildPrintJob(String(business._id), orderId, "kitchen")), /^\x1b@\x1bt\x10\x1bM\x01\x1d!\x11/);
      assert.match(bytes(await buildPrintJob(String(business._id), orderId, "customer")), /^\x1b@\x1bt\x10\x1bE\x01/);
      assert.deepEqual([(await buildPrintJob(String(business._id), orderId, "customer")).family, (await buildPrintJob(String(business._id), orderId, "kitchen")).family], ["ARIAL", "PRINTER"]);
      form.set("customerReceiptFamily", "COMIC");
      assert.ok((await updatePrintingSettings(undefined, form)).errors?.customerReceiptFamily);
      form.set("customerReceiptFamily", "ARIAL");
      form.set("kitchenReceiptSize", "HUGE");
      assert.ok((await updatePrintingSettings(undefined, form)).errors?.kitchenReceiptSize);
      form.set("kitchenReceiptSize", "LARGE");
      form.set("autoPrintUnpaidDineIn", "YES");
      form.set("unpaidDineInReceiptCopies", "2");
      assert.equal((await updatePrintingSettings(undefined, form)).ok, true);
      const stored2 = await Business.findById(business._id).lean();
      assert.deepEqual([stored2.autoPrintUnpaidDineIn, stored2.unpaidDineInReceiptCopies], [true, 2]);
    });

    await t.test("unpaid dine-in bills print on placing, with their own copies and an UNPAID banner", async () => {
      await settings({ autoPrintUnpaidDineIn: true, unpaidDineInReceiptCopies: 2, customerReceiptCopies: 1, customerPrintingEnabled: true });
      jar.clear();
      await createSession({ userId: String(cashier._id), businessId: String(business._id), role: "CASHIER", authVersion: 0 });
      const created = await saveOrder(order("DINE_IN"));
      assert.equal(created.ok, true, created.message);
      assert.equal(created.printBill, true);
      assert.equal((await saveOrder(order("DINE_IN"), created.orderId)).printBill, false);
      const text = job => job.parts.map(part => part.type === "command" ? Buffer.from(part.base64, "base64").toString("latin1") : "").join("");
      const bill = await buildPrintJob(String(business._id), created.orderId, "customer");
      assert.equal(bill.copies, 2);
      assert.ok(text(bill).includes("UNPAID BILL"));
      assert.equal((await completeOrderPayment(pay(created.orderId, 1000))).ok, true);
      const receipt = await buildPrintJob(String(business._id), created.orderId, "customer");
      assert.equal(receipt.copies, 1);
      assert.ok(!text(receipt).includes("UNPAID BILL"));
      // Takeaway is paid before it is placed, so there is no unpaid bill to print.
      assert.equal((await completeTakeawayPayment(order("TAKEAWAY"), { idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: 1000, tenderedAmount: 1000, reference: "", notes: "" })).printBill, undefined);
      await settings({ autoPrintUnpaidDineIn: false });
      assert.equal((await saveOrder(order("DINE_IN"))).printBill, false);
    });

    await t.test("confirming a waiter order prints the kitchen ticket and the unpaid bill", async () => {
      await settings({ autoPrintUnpaidDineIn: true, kitchenPrintingEnabled: true, onePrinterMode: true });
      await WaiterRequest.init();
      const table = await RestaurantTable.create({ businessId: business._id, name: "Table 9" });
      const waiter = await User.create({ businessId: business._id, fullName: "Waiter", phone: "03001234569", username: "print.waiter", role: "WAITER", passwordHash: "x" });
      jar.clear();
      await createSession({ userId: String(waiter._id), businessId: String(business._id), role: "WAITER", authVersion: 0 });
      const sent = await saveWaiterRequest({ submissionKey: randomUUID(), revision: 0, input: { ...order("DINE_IN"), tableId: String(table._id) } });
      assert.equal(sent.ok, true, JSON.stringify(sent));
      jar.clear();
      await createSession({ userId: String(cashier._id), businessId: String(business._id), role: "CASHIER", authVersion: 0 });
      const confirmed = await confirmWaiterRequest(sent.id, 0);
      assert.equal(confirmed.ok, true, confirmed.message);
      assert.deepEqual([confirmed.printKitchen, confirmed.printBill, confirmed.printerMode], [true, true, "QZ"]);
      assert.equal((await Order.findById(confirmed.orderId).lean()).paymentStatus, "UNPAID");
    });

    await t.test("a waiter can send an order without a table, and the cashier sees it as No table", async () => {
      const { GET } = await import("../app/api/pos/waiter-requests/route.ts");
      const waiter = await User.findOne({ username: "print.waiter" });
      jar.clear();
      await createSession({ userId: String(waiter._id), businessId: String(business._id), role: "WAITER", authVersion: 0 });
      const sent = await saveWaiterRequest({ submissionKey: randomUUID(), revision: 0, input: { ...order("DINE_IN"), tableId: "" } });
      assert.equal(sent.ok, true, JSON.stringify(sent));
      const takeaway = await saveWaiterRequest({ submissionKey: randomUUID(), revision: 0, input: { ...order("TAKEAWAY"), tableId: "" } });
      assert.equal(takeaway.ok, false, "waiter orders stay dine-in");
      jar.clear();
      await createSession({ userId: String(cashier._id), businessId: String(business._id), role: "CASHIER", authVersion: 0 });
      const queue = await (await GET()).json();
      assert.equal(queue.requests.find(request => request.id === sent.id)?.tableName, "No table");
      const confirmed = await confirmWaiterRequest(sent.id, 0);
      assert.equal(confirmed.ok, true, confirmed.message);
      const placed = await Order.findById(confirmed.orderId).lean();
      assert.deepEqual([placed.orderType, placed.tableId, placed.tableNameSnapshot, placed.status], ["DINE_IN", undefined, undefined, "SENT_TO_KITCHEN"]);
    });
  } finally {
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
