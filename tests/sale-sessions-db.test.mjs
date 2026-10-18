import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import { SaleSession } from "../models/SaleSession.ts";
import { Payment } from "../models/Payment.ts";
import { Expense } from "../models/Expense.ts";
import { activeSaleSession, withSaleSession, sessionTotals, saleSessionError,closeCounterAsOwner } from "../lib/sale-sessions.ts";

test("database shift isolation, uniqueness, business dates and transactional closing", { skip: !process.env.MONGODB_URI }, async t => {
  const dbName = `restaurant_pos_session_test_${randomUUID().replaceAll("-", "")}`;
  await mongoose.connect(process.env.MONGODB_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    await SaleSession.createIndexes();
    await Payment.createIndexes();
    await Expense.createIndexes();
    const businessId = new mongoose.Types.ObjectId(), userId = new mongoose.Types.ObjectId();
    const user = { id: String(userId), businessId: String(businessId), fullName: "Test cashier" };
    const values = { businessId, userId, userNameSnapshot: "Test cashier", counterName: "Counter 1", counterKey: "counter 1", saleDate: "2026-10-16", openingBalance: 1000 };
    const sale = await SaleSession.create(values);
    await t.test("shared logins find the same session; other businesses cannot see it", async () => {
      assert.equal(String((await activeSaleSession(user))._id), String(sale._id));
      assert.equal(await activeSaleSession({ ...user, businessId: String(new mongoose.Types.ObjectId()) }), null);
    });
    await t.test("account and counter each permit only one active session", async () => {
      await assert.rejects(SaleSession.create({ ...values, counterName: "Counter 2", counterKey: "counter 2" }), { code: 11000 });
      await assert.rejects(SaleSession.create({ ...values, userId: new mongoose.Types.ObjectId() }), { code: 11000 });
      const other = await SaleSession.create({ ...values, userId: new mongoose.Types.ObjectId(), counterKey: "counter 2", counterName: "Counter 2" });
      assert.notEqual(String(other._id), String(sale._id));
    });
    const payment = { businessId, saleSessionId: sale._id, saleDate: sale.saleDate, orderId: new mongoose.Types.ObjectId(), idempotencyKey: randomUUID(), amount: 500, method: "CASH", receivedByUserId: userId, paidAt: new Date("2026-10-17T01:00:00+05:00") };
    await Payment.create(payment);
    await Payment.create({ ...payment, idempotencyKey: randomUUID(), saleSessionId: new mongoose.Types.ObjectId(), amount: 9999 });
    await Expense.create({ businessId, saleSessionId: sale._id, saleDate: sale.saleDate, categoryId: new mongoose.Types.ObjectId(), categoryNameSnapshot: "Test", title: "Shift expense", amount: 100, expenseDate: new Date(), paymentMethod: "CASH", createdByUserId: userId });
    await t.test("after-midnight collections keep the sale date and exclude another shift's cash", async () => {
      assert.equal((await Payment.findOne({ _id: (await Payment.findOne({ idempotencyKey: payment.idempotencyKey }))._id })).saleDate, "2026-10-16");
      const totals = await sessionTotals(user.businessId, String(sale._id), 1000);
      assert.equal(totals.sales, 500);
      assert.equal(totals.expenses, 100);
      assert.equal(totals.balance, 1400);
    });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    await t.test("standalone configuration fails clearly without changing financial data", { skip: Boolean(hello.setName || hello.msg === "isdbgrid") }, async () => {
      const before = await SaleSession.findById(sale._id).lean();
      await assert.rejects(withSaleSession(user, async () => assert.fail("Must not execute financial writes")), error => /replica set/.test(saleSessionError(error)));
      assert.equal((await SaleSession.findById(sale._id).lean()).revision, before.revision);
    });
    await t.test("closing conflicts with financial writes and persists an exact snapshot", { skip: !hello.setName && hello.msg !== "isdbgrid" }, async () => {
      const close = async () => withSaleSession(user, async (row, transaction) => {
        const totals = await sessionTotals(user.businessId, String(row._id), row.openingBalance, transaction);
        await SaleSession.updateOne({ _id: row._id }, { $set: { status: "CLOSED", closingTotals: totals, closedAt: new Date() } }, { session: transaction });
      });
      const collect = async () => withSaleSession(user, async (row, transaction) => {
        await Payment.create([{ ...payment, saleSessionId: row._id, idempotencyKey: randomUUID(), amount: 75 }], { session: transaction });
      });
      const results = await Promise.allSettled([close(), collect()]);
      assert.equal(results[0].status, "fulfilled");
      const closed = await SaleSession.findById(sale._id).lean();
      assert.equal(closed.status, "CLOSED");
      assert.deepEqual({ ...closed.closingTotals }, await sessionTotals(user.businessId, String(sale._id), 1000));
      await assert.rejects(withSaleSession(user, async () => {}), /Start a sale session/);
    });
    await t.test("a second shift on the same date has independent opening cash and totals", async () => {
      await SaleSession.updateOne({ _id: sale._id }, { $set: { status: "CLOSED" } });
      const next = await SaleSession.create({ ...values, openingBalance: 200 });
      assert.notEqual(String(next._id), String(sale._id));
      assert.equal((await sessionTotals(user.businessId, String(next._id), next.openingBalance)).balance, 200);
    });
    await t.test("owner closes a different account's counter with isolated totals and attribution", {skip:!hello.setName&&hello.msg!=="isdbgrid"},async()=>{
      const owner={...user,id:String(new mongoose.Types.ObjectId()),role:"OWNER",fullName:"Test owner"};
      const counter=await SaleSession.findOne({businessId,counterKey:"counter 2",status:"OPEN"}).lean();
      await assert.rejects(closeCounterAsOwner({...owner,role:"ADMIN"},String(counter._id)),/Only the owner/);
      await assert.rejects(closeCounterAsOwner({...owner,businessId:String(new mongoose.Types.ObjectId())},String(counter._id)),/closed or unavailable/);
      await closeCounterAsOwner(owner,String(counter._id));
      const closed=await SaleSession.findById(counter._id).lean();
      assert.equal(closed.status,"CLOSED");assert.equal(String(closed.closedByUserId),owner.id);assert.equal(closed.closedByOwner,true);
      assert.deepEqual({...closed.closingTotals},await sessionTotals(owner.businessId,String(counter._id),counter.openingBalance));
      assert.ok(await activeSaleSession(user));
      await assert.rejects(closeCounterAsOwner(owner,String(counter._id)),/closed or unavailable/);
    });
  } finally {
    assert.match(mongoose.connection.name, /^restaurant_pos_session_test_[a-f0-9]+$/);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    globalThis.mongooseConnection = undefined;
  }
});
