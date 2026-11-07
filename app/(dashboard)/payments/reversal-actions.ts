"use server";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/data/auth";
import { writeAuditLog } from "@/lib/audit";
import { undoOrderCoupons } from "@/lib/coupon-service";
import { dateISO } from "@/lib/dates";
import { requireSaleSessionDatabase, saleSessionError } from "@/lib/sale-sessions";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";
import { SaleSession } from "@/models/SaleSession";

const inputSchema = z.object({
  orderId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid order."),
  reason: z.string().trim().min(3, "Enter a reason of at least 3 characters.").max(500, "Keep the reason under 500 characters."),
});

// For a payment recorded by mistake: the order goes back to unpaid and the payment stays on record, marked reversed.
// While the shift that recorded it is open, the amount comes off that shift's totals. Once it has closed, its totals stay
// frozen and no other drawer is touched, since the money never came in. The unpaid order is then held by the reverser's
// open sale, if any, so that shift cannot close until it is collected or cancelled.
export async function reverseOrderPayment(orderId: string, reason: string) {
  try {
    const user = await requirePermission("reverse_payments");
    const parsed = inputSchema.safeParse({ orderId, reason });
    if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check the reversal details." };
    const clean = parsed.data.reason;
    await requireSaleSessionDatabase();
    const result = await mongoose.connection.transaction(async transaction => {
      const order = await Order.findOne({ _id: orderId, businessId: user.businessId, paymentStatus: "PAID", status: { $ne: "CANCELLED" } }).session(transaction).lean();
      if (!order) throw new Error("This order is not paid, or its payment was already reversed.");
      const payments = await Payment.find({ businessId: user.businessId, orderId, reversal: null }).sort({ paidAt: -1 }).session(transaction).lean();
      if (!payments.length) throw new Error("This order has no payment to reverse.");

      // Writing the session makes a reversal and a close of that shift conflict, as for every other financial write.
      const bump = { $inc: { revision: 1 } }, options = { returnDocument: "after" as const, session: transaction };
      const original = payments[0].saleSessionId ? await SaleSession.findOneAndUpdate({ _id: payments[0].saleSessionId, businessId: user.businessId, status: "OPEN" }, bump, options).lean() : null;
      const own = original ? null : await SaleSession.findOneAndUpdate({ businessId: user.businessId, userId: user.id, status: "OPEN" }, bump, options).lean();
      const holder = original ?? own, saleDate = String(holder?.saleDate ?? dateISO());

      const reversedAt = new Date();
      const marked = await Payment.updateMany({ _id: { $in: payments.map(payment => payment._id) }, reversal: null }, { $set: { reversal: { reason: clean, reversedAt, reversedByUserId: user.id, reversedByNameSnapshot: user.fullName, saleDate, ...(original ? { saleSessionId: original._id, counterNameSnapshot: original.counterName } : {}) } } }, { session: transaction });
      if (marked.modifiedCount !== payments.length) throw new Error("This payment was just reversed by someone else. Refresh and check.");

      // Payment is what completes dine-in and delivery orders, so they step back to the last stage before it.
      const reopen = order.status === "COMPLETED";
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, businessId: user.businessId, paymentStatus: "PAID" },
        { $set: { paymentStatus: "UNPAID", paidAmount: 0, dueAmount: order.grandTotal, ...(holder ? { saleSessionId: holder._id } : {}), lastUpdatedByUserId: user.id, ...(reopen ? { status: "SERVED" } : {}) }, $unset: { collectedInSessionId: "", ...(reopen ? { completedAt: "" } : {}) } },
        { returnDocument: "after", session: transaction },
      );
      if (!updated) throw new Error("The order changed. Refresh and try again.");
      await undoOrderCoupons(order, transaction);
      return { orderNumber: String(order.orderNumber), saleDate, counterName: original ? String(original.counterName) : "", amount: payments.reduce((sum, payment) => sum + payment.amount, 0), methods: [...new Set(payments.map(payment => String(payment.method)))], paymentIds: payments.map(payment => String(payment._id)) };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "REVERSE_PAYMENT", entityType: "Order", entityId: orderId, description: `Reversed Rs ${result.amount.toLocaleString("en-PK")} payment on ${result.orderNumber}: ${clean}`, metadata: { reason: clean, amount: result.amount, methods: result.methods, paymentIds: result.paymentIds, saleDate: result.saleDate, counterName: result.counterName } });
    for (const path of ["/orders", `/orders/${orderId}`, "/kitchen", "/sale-sessions", "/sales", "/reports", "/reports/profit-loss", "/reports/discounts", "/reports/reversals", "/dashboard", "/coupons"]) revalidatePath(path);
    return { ok: true as const, orderNumber: result.orderNumber, amount: result.amount };
  } catch (error) { return { ok: false as const, message: saleSessionError(error) }; }
}
