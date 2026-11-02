"use server";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { orderWithDiscount } from "@/lib/tax";
import { allowAuthAttempt } from "@/lib/auth/two-factor";
import { couponDescription, couponProblem } from "@/lib/coupons";
import { claimCoupon, couponBusinessDate, couponsAllowed, COUPONS_OFF_MESSAGE, releaseOrderCoupon, resolveCoupon } from "@/lib/coupon-service";
import { Coupon } from "@/models/Coupon";
import { CouponBatch } from "@/models/CouponBatch";
import { Order } from "@/models/Order";

const id = z.string().regex(/^[a-f\d]{24}$/i);
const message = (error: unknown, fallback: string) => error instanceof Error && error.constructor === Error ? error.message : fallback;
const refresh = (orderId: string) => { for (const path of ["/orders", `/orders/${orderId}`, "/coupons"]) revalidatePath(path); };

// Applies (or replaces) a coupon on an unpaid order. The coupon is held until payment or removal.
export async function applyOrderCoupon(orderId: string, code: string) {
  try {
    const user = await requirePermission("payments");
    id.parse(orderId);
    await connectToDatabase();
    if (!(await couponsAllowed(user.businessId))) throw new Error(COUPONS_OFF_MESSAGE);
    if (!(await allowAuthAttempt("coupon-lookup:" + user.id, 40))) throw new Error("Too many coupon checks. Wait five minutes and try again.");
    const result = await mongoose.connection.transaction(async transaction => {
      const order = await Order.findOne({ _id: orderId, businessId: user.businessId, status: { $ne: "CANCELLED" }, paymentStatus: "UNPAID", paidAmount: 0 }).session(transaction).lean();
      if (!order) throw new Error("This order is paid or unavailable.");
      const resolved = await resolveCoupon({ businessId: user.businessId, code, customerId: order.customerId, saleDate: order.saleDate || await couponBusinessDate(user), subtotal: order.subtotal, session: transaction, currentOrderId: orderId });
      const same = order.couponId && String(order.couponId) === String(resolved.coupon._id);
      const totals = orderWithDiscount(order, resolved.discountAmount);
      if (!same) {
        if (order.couponId) await releaseOrderCoupon(user.businessId, order._id, transaction);
        await claimCoupon(resolved.coupon._id, { orderId: order._id, orderNumber: order.orderNumber, status: "APPLIED", discountAmount: totals.discountAmount }, transaction);
      }
      const updated = await Order.updateOne({ _id: order._id, paymentStatus: "UNPAID" }, { $set: { ...totals, discountType: resolved.batch.discountType, discountValue: resolved.batch.discountValue, couponId: resolved.coupon._id, couponCode: resolved.coupon.code, couponSnapshot: resolved.snapshot, lastUpdatedByUserId: user.id } }, { session: transaction });
      if (!updated.modifiedCount && !same) throw new Error("The order changed. Refresh and try again.");
      return { orderNumber: order.orderNumber, code: String(resolved.coupon.code), batchName: resolved.batch.name, discountAmount: totals.discountAmount, description: resolved.description };
    });
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "APPLY_COUPON", entityType: "Order", entityId: orderId, description: `Applied coupon ${result.code} (${result.batchName}) to ${result.orderNumber}`, metadata: { couponCode: result.code, discountAmount: result.discountAmount } });
    refresh(orderId);
    return { ok: true as const, ...result };
  } catch (error) { return { ok: false as const, message: message(error, "Could not apply this coupon. Please try again.") }; }
}

export async function removeOrderCoupon(orderId: string) {
  try {
    const user = await requirePermission("payments");
    id.parse(orderId);
    await connectToDatabase();
    const result = await mongoose.connection.transaction(async transaction => {
      const order = await Order.findOne({ _id: orderId, businessId: user.businessId, status: { $ne: "CANCELLED" }, paymentStatus: "UNPAID", paidAmount: 0, couponId: { $ne: null } }).session(transaction).lean();
      if (!order) throw new Error("This order has no removable coupon.");
      await releaseOrderCoupon(user.businessId, order._id, transaction);
      await Order.updateOne({ _id: order._id }, { $set: { ...orderWithDiscount(order, 0), discountType: "NONE", discountValue: 0, lastUpdatedByUserId: user.id }, $unset: { couponId: "", couponCode: "", couponSnapshot: "" } }, { session: transaction });
      return { orderNumber: order.orderNumber, code: String(order.couponCode) };
    });
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "REMOVE_COUPON", entityType: "Order", entityId: orderId, description: `Removed coupon ${result.code} from ${result.orderNumber}; it can be used again`, metadata: { couponCode: result.code } });
    refresh(orderId);
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: message(error, "Could not remove the coupon. Please try again.") }; }
}

// The customer's own coupons that are usable today, for one-tap selection at payment.
export async function customerCoupons(customerId: string) {
  try {
    const user = await requirePermission("payments");
    if (!id.safeParse(customerId).success) return { ok: true as const, coupons: [] };
    await connectToDatabase();
    const coupons = await Coupon.find({ businessId: user.businessId, customerId, status: "ACTIVE" }).sort({ assignedAt: -1 }).limit(20).lean();
    const batches = new Map((await CouponBatch.find({ businessId: user.businessId, _id: { $in: coupons.map(row => row.batchId) } }).lean()).map(row => [String(row._id), row]));
    const today = await couponBusinessDate(user);
    return { ok: true as const, coupons: coupons.flatMap(row => {
      const batch = batches.get(String(row.batchId));
      if (!batch || couponProblem(row, batch, { customerId, saleDate: today })) return [];
      return [{ code: String(row.code), batchName: String(batch.name), description: couponDescription(batch), expiresOn: batch.expiresOn ?? null }];
    }) };
  } catch { return { ok: false as const, coupons: [] }; }
}
