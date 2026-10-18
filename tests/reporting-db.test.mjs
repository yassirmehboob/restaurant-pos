import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import { businessDateQuery, buildSalesReport, paidSalesFilter, resolveReportRange, saleDateFilter } from "../lib/reporting.ts";
import { buildProfitLoss } from "../lib/profit-loss.ts";
import { Order } from "../models/Order.ts";

test("Today follows the open sale date and explicit historical ranges remain unchanged", () => {
  for (const query of [{}, {range:"TODAY",from:"2026-10-17",to:"2026-10-17"}]) {
    assert.deepEqual(businessDateQuery(query,"2026-10-16"),{range:"CUSTOM",from:"2026-10-16",to:"2026-10-16"});
  }
  const custom={range:"CUSTOM",from:"2026-10-01",to:"2026-10-02"};
  assert.deepEqual(businessDateQuery(custom,"2026-10-16"),custom);
  assert.deepEqual(businessDateQuery({range:"TODAY"}),{range:"TODAY"});
});

test("paid sales appear independently of kitchen status across sales and profit reports", { skip: !process.env.MONGODB_URI }, async t => {
  const dbName = `restaurant_pos_reporting_test_${randomUUID().replaceAll("-", "")}`;
  await mongoose.connect(process.env.MONGODB_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  try {
    const db = mongoose.connection.db, businessId = new mongoose.Types.ObjectId(), otherBusiness = new mongoose.Types.ObjectId();
    const date = new Date("2026-01-31T12:00:00+05:00");
    const row = (amount, status, paymentStatus = "PAID", extra = {}) => ({
      _id: new mongoose.Types.ObjectId(), businessId, saleDate: "2026-01-31", status, paymentStatus,
      grandTotal: amount, subtotal: amount, discountAmount: 0, taxAmount: 0, deliveryChargeAmount: 0, orderType: "TAKEAWAY", updatedAt: date,
      items: [{ itemType: "PRODUCT", nameSnapshot: "Test item", quantity: 1, lineTotal: amount, unitCost: amount * 0.4 }], ...extra,
    });
    const sent = row(100, "SENT_TO_KITCHEN", "PAID", {createdAt:new Date("2026-02-01T01:30:00+05:00")}), preparing = row(200, "PREPARING"), completed = row(300, "COMPLETED", "PAID", { completedAt: date });
    const legacyCompleted = row(50, "COMPLETED", "PAID", { completedAt: date }), legacyReady = row(25, "READY");
    delete legacyCompleted.saleDate; delete legacyReady.saleDate;
    await db.collection("orders").insertMany([sent, preparing, completed, legacyCompleted, legacyReady,
      row(400, "COMPLETED", "UNPAID", { completedAt: date }), row(500, "CANCELLED"), row(600, "READY", "PAID", { businessId: otherBusiness }), row(700, "READY", "PAID", { saleDate: "2026-02-02" }),
    ]);
    await db.collection("payments").insertMany([sent, preparing, completed, legacyCompleted, legacyReady].map((order, index) => ({
      businessId, orderId: order._id, amount: order.grandTotal, method: index === 1 ? "CARD" : "CASH",
      ...(order.saleDate ? { saleDate: order.saleDate } : {}), paidAt: index === 0 ? new Date("2026-02-01T01:00:00+05:00") : date,
    })));
    await db.collection("expenses").insertMany([
      { businessId, saleDate: "2026-01-31", amount: 30, expenseDate: new Date("2026-02-01T01:00:00+05:00"), isActive: true, categoryNameSnapshot: "Session expense" },
      { businessId, amount: 5, expenseDate: date, isActive: true, categoryNameSnapshot: "Legacy expense" },
      { businessId, amount: 999, expenseDate: date, isActive: false },
      { businessId: otherBusiness, amount: 888, expenseDate: date, isActive: true },
    ]);
    const query = { range: "CUSTOM", from: "2026-01-31", to: "2026-01-31" };
    await t.test("Orders uses saleDate rather than the after-midnight creation date", async () => {
      const orders=await Order.find({businessId,...saleDateFilter(resolveReportRange(query),"createdAt")}).lean();
      assert.ok(orders.some(order=>String(order._id)===String(sent._id)));
      const nextDay=await Order.find({businessId,...saleDateFilter(resolveReportRange({range:"CUSTOM",from:"2026-02-01",to:"2026-02-01"}),"createdAt")}).lean();
      assert.ok(!nextDay.some(order=>String(order._id)===String(sent._id)));
    });
    await t.test("sales history and aggregate reports select the same paid orders", async () => {
      const range = resolveReportRange(query), filter = await paidSalesFilter(String(businessId), range);
      const history = await Order.find(filter).lean(), report = await buildSalesReport(String(businessId), query);
      assert.equal(history.length, 5);
      assert.equal(report.summary.orders, 5);
      assert.equal(report.summary.netSales, 675);
      assert.equal(report.summary.cogs, 270);
      assert.equal(report.paymentMethods.reduce((sum, row) => sum + row.amount, 0), 675);
      assert.ok(history.some(order => order.status === "SENT_TO_KITCHEN"));
      assert.ok(history.some(order => order.status === "PREPARING"));
      assert.ok(history.every(order => order.paymentStatus === "PAID" && order.status !== "CANCELLED"));
    });
    await t.test("profit/loss uses the same sales and business-date expenses", async () => {
      const report = await buildProfitLoss(String(businessId), query);
      assert.equal(report.netSales, 675);
      assert.equal(report.expenses, 35);
      assert.equal(report.netProfit, 370);
    });
    await t.test("after-midnight sales stay on their selected business date", async () => {
      const report = await buildSalesReport(String(businessId), { range: "CUSTOM", from: "2026-02-01", to: "2026-02-01" });
      assert.equal(report.summary.orders, 0);
      assert.equal(report.summary.netSales, 0);
    });
    await t.test("reports remain isolated by business", async () => {
      const report = await buildSalesReport(String(otherBusiness), query);
      assert.equal(report.summary.orders, 1);
      assert.equal(report.summary.netSales, 600);
    });
  } finally {
    assert.match(mongoose.connection.name, /^restaurant_pos_reporting_test_[a-f0-9]+$/);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
