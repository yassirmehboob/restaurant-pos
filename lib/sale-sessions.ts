import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import type { CurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { calculateSessionTotals, uncollectedTotal } from "@/lib/sale-session-totals";
import { SaleSession } from "@/models/SaleSession";
import { Payment } from "@/models/Payment";
import { Expense } from "@/models/Expense";
import { Order } from "@/models/Order";

export async function activeSaleSession(user: Pick<CurrentUser, "id" | "businessId">) {
  await connectToDatabase();
  return SaleSession.findOne({ businessId: user.businessId, userId: user.id, status: "OPEN" }).lean();
}

export async function requireSaleSessionDatabase() {
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database is unavailable.");
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") {
    throw new Error("Sale sessions require MongoDB Atlas or a MongoDB replica set. Configure the database and try again.");
  }
}

// Every financial write also writes this session document. Closing and payments/
// expenses therefore conflict and retry rather than committing an incomplete close.
export async function withSaleSession<T>(user: CurrentUser, work: (sale: NonNullable<Awaited<ReturnType<typeof activeSaleSession>>>, transaction: ClientSession) => Promise<T>) {
  await requireSaleSessionDatabase();
  return mongoose.connection.transaction(async transaction => {
    const sale = await SaleSession.findOneAndUpdate(
      { businessId: user.businessId, userId: user.id, status: "OPEN" },
      { $inc: { revision: 1 } }, { returnDocument: "after", session: transaction },
    ).lean();
    if (!sale) throw new Error("Start a sale session before recording orders, payments, or expenses.");
    return work(sale, transaction);
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
}

export async function sessionTotals(businessId: string, sessionId: string, openingBalance: number, transaction?: ClientSession) {
  // Keep operations sequential: the MongoDB driver does not support parallel
  // operations within a transaction.
  const payments = await Payment.find({ businessId, saleSessionId: sessionId }).session(transaction ?? null).lean();
  const expenses = await Expense.find({ businessId, saleSessionId: sessionId, isActive: true }).session(transaction ?? null).lean();
  return calculateSessionTotals(openingBalance,
    payments.map(row => ({ amount: row.amount, method: row.method })),
    expenses.map(row => ({ amount: row.amount, method: row.paymentMethod })));
}

// An order with nothing left to collect (for example a fully discounted one) cannot take a payment, so it never holds a shift open.
const uncollectedFilter = { status: { $ne: "CANCELLED" }, paymentStatus: { $ne: "PAID" }, dueAmount: { $gt: 0 } };

export async function sessionUnpaidOrders(businessId: string, sessionId: string, transaction?: ClientSession) {
  return Order.find({ businessId, saleSessionId: sessionId, ...uncollectedFilter })
    .select("orderNumber orderType status paymentStatus tableNameSnapshot customerSnapshot.name grandTotal dueAmount createdAt")
    .sort({ createdAt: 1 }).session(transaction ?? null).lean();
}

// Unpaid amount and invoice count per counter, for the open counters list.
export async function sessionsUncollected(businessId: string, sessionIds: string[]) {
  const rows = await Order.find({ businessId, saleSessionId: { $in: sessionIds }, ...uncollectedFilter }).select("saleSessionId dueAmount").lean();
  const bySession = new Map<string, { dueAmount: number }[]>();
  for (const row of rows) bySession.set(String(row.saleSessionId), [...(bySession.get(String(row.saleSessionId)) ?? []), row]);
  return new Map([...bySession].map(([id, orders]) => [id, { count: orders.length, amount: uncollectedTotal(orders) }]));
}

// Runs inside the closing transaction. New orders on this session also write the
// session document, so one created during the close conflicts and retries rather than slipping past this check.
export async function requireNoUnpaidOrders(businessId: string, sessionId: string, transaction: ClientSession) {
  const unpaid = await sessionUnpaidOrders(businessId, sessionId, transaction);
  if (!unpaid.length) return;
  const numbers = unpaid.slice(0, 3).map(order => order.orderNumber).join(", ");
  const more = unpaid.length > 3 ? ` and ${unpaid.length - 3} more` : "";
  throw new Error(`This sale cannot close: Rs ${uncollectedTotal(unpaid).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} is uncollected on ${unpaid.length} unpaid ${unpaid.length === 1 ? "invoice" : "invoices"} (${numbers}${more}). Collect or cancel ${unpaid.length === 1 ? "it" : "them"} first.`);
}

export async function closeCounterAsOwner(owner:CurrentUser,id:string){
  if(owner.role!=="OWNER")throw new Error("Only the owner can close another counter.");
  if(!/^[a-f\d]{24}$/i.test(id))throw new Error("Invalid counter session.");
  await requireSaleSessionDatabase();
  return mongoose.connection.transaction(async transaction=>{
    const sale=await SaleSession.findOneAndUpdate({_id:id,businessId:owner.businessId,status:"OPEN"},{$inc:{revision:1}},{returnDocument:"after",session:transaction}).lean();
    if(!sale)throw new Error("This counter is already closed or unavailable. Refresh the list.");
    await requireNoUnpaidOrders(owner.businessId,id,transaction);
    const totals=await sessionTotals(owner.businessId,id,sale.openingBalance,transaction);
    await SaleSession.updateOne({_id:sale._id,businessId:owner.businessId,status:"OPEN"},{$set:{status:"CLOSED",closedAt:new Date(),closingTotals:totals,closedByUserId:owner.id,closedByNameSnapshot:owner.fullName,closedByOwner:true}},{session:transaction});
    return {counterName:String(sale.counterName),saleDate:String(sale.saleDate)};
  },{readConcern:{level:"snapshot"},writeConcern:{w:"majority"}});
}

export function saleSessionError(error: unknown) {
  if ((error as { code?: number })?.code === 20) return "Sale sessions require MongoDB Atlas or a MongoDB replica set. Configure the database and try again.";
  if ((error as { code?: number })?.code === 11000) return "This account or counter already has an active sale, or this payment was already submitted. Refresh and try again.";
  return error instanceof Error && error.constructor === Error ? error.message : "Could not save the sale session. Please try again.";
}
