import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { loadKitchenOrders } from "../lib/kitchen-orders.ts";

test("kitchen includes all open counters and five hours of closed sales only", { skip: !process.env.MONGODB_URI }, async () => {
  const dbName = "pos_kitchen_test_" + randomUUID().replaceAll("-", "");
  await mongoose.connect(process.env.MONGODB_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  try {
    const db = mongoose.connection.db, id = () => new mongoose.Types.ObjectId();
    const businessId = id(), otherBusinessId = id(), now = new Date("2026-10-28T12:00:00Z");
    const session = (status, elapsed, business = businessId) => ({ _id: id(), businessId: business, status, userId: id(), counterKey: randomUUID(), ...(elapsed === undefined ? {} : { closedAt: new Date(now.getTime() - elapsed) }) });
    const hour = 3600000;
    const firstCounter = session("OPEN"), secondCounter = session("OPEN"), recentlyClosed = session("CLOSED", 2 * hour);
    const boundary = session("CLOSED", 5 * hour), expired = session("CLOSED", 5 * hour + 1), missingTime = session("CLOSED"), foreign = session("OPEN", undefined, otherBusinessId);
    await db.collection("salesessions").insertMany([firstCounter, secondCounter, recentlyClosed, boundary, expired, missingTime, foreign]);
    const order = (number, sale, status = "SENT_TO_KITCHEN", extra = {}) => ({ _id: id(), businessId, orderNumber: number, saleSessionId: sale?._id, status, createdAt: new Date("2026-09-01T12:00:00Z"), ...extra });
    await db.collection("orders").insertMany([
      order("counter-1", firstCounter), order("counter-2", secondCounter, "PREPARING"), order("closed-recently", recentlyClosed, "READY"), order("five-hours", boundary),
      order("expired", expired), order("missing-close-time", missingTime), order("no-session", null), order("foreign-session", foreign),
      order("foreign-order", firstCounter, "READY", { businessId: otherBusinessId }),
      order("completed", firstCounter, "COMPLETED"), order("cancelled", secondCounter, "CANCELLED"), order("draft", firstCounter, "DRAFT"),
    ]);
    const result = await loadKitchenOrders(String(businessId), now);
    assert.deepEqual(result.rows.map(row => row.orderNumber).sort(), ["closed-recently", "counter-1", "counter-2", "five-hours"]);
    assert.equal(result.now, now.getTime());
    // Closing a counter keeps its orders visible, even when it was the last open sale.
    await db.collection("salesessions").updateMany({ businessId, status: "OPEN" }, { $set: { status: "CLOSED", closedAt: now } });
    assert.ok((await loadKitchenOrders(String(businessId), new Date(now.getTime() + 4 * hour))).rows.some(row => row.orderNumber === "counter-1"));
    assert.equal((await loadKitchenOrders(String(businessId), new Date(now.getTime() + 5 * hour + 1))).rows.length, 0);
    assert.equal(await db.collection("orders").countDocuments({ businessId }), 11);
  } finally {
    assert.match(mongoose.connection.name, /^pos_kitchen_test_[a-f0-9]+$/);
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
