import "server-only";
import { randomInt } from "node:crypto";
import type { ClientSession, Types } from "mongoose";
import { Coupon } from "@/models/Coupon";
import { CouponBatch } from "@/models/CouponBatch";
import { Order } from "@/models/Order";
import { activeSaleSession } from "@/lib/sale-sessions";
import { dateISO } from "@/lib/dates";
import { couponDescription, couponDiscount, couponProblem, normalizeCouponCode, type CouponBatchRules } from "@/lib/coupons";

type Id = Types.ObjectId | string;
type Batch = CouponBatchRules & { _id: Types.ObjectId; maxDiscount?: number | null; minOrderAmount?: number | null };
type IssuedCoupon = { couponId: Types.ObjectId; code: string; batchName: string; description: string; expiresOn?: string | null; usage: string };

// Always 10 digits (no leading zero), from a cryptographic source so codes cannot be guessed.
export function generateCouponCode() { return String(randomInt(1_000_000_000, 10_000_000_000)); }

// Codes are unique across every restaurant and are never deleted, so none can ever repeat.
export async function generateUniqueCodes(count: number, session: ClientSession) {
  const codes = new Set<string>();
  while (codes.size < count) {
    const candidates = new Set<string>();
    while (candidates.size < (count - codes.size)) { const code = generateCouponCode(); if (!codes.has(code)) candidates.add(code); }
    const taken = new Set((await Coupon.find({ code: { $in: [...candidates] } }, { code: 1 }).session(session).lean()).map(row => String(row.code)));
    for (const code of candidates) if (!taken.has(code)) codes.add(code);
  }
  return [...codes];
}

export function couponSnapshot(batch: Batch) {
  return { batchId: batch._id, batchName: batch.name, discountType: batch.discountType, discountValue: batch.discountValue, maxDiscount: batch.maxDiscount ?? undefined, minOrderAmount: batch.minOrderAmount ?? 0 };
}

// currentOrderId lets an order re-check the coupon it already holds (for example after an edit).
export async function resolveCoupon({ businessId, code, customerId, saleDate, subtotal, session, currentOrderId }: { businessId: Id; code: unknown; customerId?: Id | null; saleDate: string; subtotal: number; session?: ClientSession; currentOrderId?: string }) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) throw new Error("Enter the 10-digit coupon code.");
  const coupon = await Coupon.findOne({ code: normalized, businessId }).session(session ?? null).lean();
  if (!coupon) throw new Error("Coupon code not found. Check the digits and try again.");
  const batch = await CouponBatch.findOne({ _id: coupon.batchId, businessId }).session(session ?? null).lean() as Batch | null;
  if (!batch) throw new Error("Coupon code not found. Check the digits and try again.");
  const heldHere = currentOrderId && coupon.status === "APPLIED" && String(coupon.orderId) === currentOrderId;
  const problem = couponProblem(heldHere ? { ...coupon, status: "ACTIVE" } : coupon, batch, { customerId: customerId ? String(customerId) : null, saleDate });
  if (problem) throw new Error(problem);
  return { coupon, batch, discountAmount: couponDiscount(batch, subtotal), description: couponDescription(batch), snapshot: couponSnapshot(batch) };
}

export async function claimCoupon(couponId: Id, { orderId, orderNumber, status, discountAmount }: { orderId: Id; orderNumber: string; status: "APPLIED" | "REDEEMED"; discountAmount: number }, session: ClientSession) {
  const now = new Date();
  const claimed = await Coupon.findOneAndUpdate({ _id: couponId, status: "ACTIVE" }, { $set: { status, orderId, orderNumber, appliedAt: now, discountAmount, ...(status === "REDEEMED" ? { redeemedAt: now } : {}) } }, { session, returnDocument: "after" });
  if (!claimed) throw new Error("This coupon was just used on another order.");
}

// Returns a coupon held by an unpaid order to the customer. Redeemed coupons are never released.
export async function releaseOrderCoupon(businessId: Id, orderId: Id, session: ClientSession) {
  await Coupon.updateOne({ businessId, orderId, status: "APPLIED" }, { $set: { status: "ACTIVE" }, $unset: { orderId: "", orderNumber: "", appliedAt: "", discountAmount: "" } }, { session });
}

type PaidOrder = { _id: Types.ObjectId; businessId: Types.ObjectId; orderNumber: string; couponId?: Types.ObjectId | null; customerId?: Types.ObjectId | null; customerSnapshot?: { name?: string; phone?: string } | null; discountAmount?: number; grandTotal: number };

// Final, single use: runs in the payment transaction, so a failed payment leaves the coupon applied.
export async function redeemOrderCoupon(order: PaidOrder, saleDate: string, session: ClientSession) {
  if (!order.couponId) return;
  const coupon = await Coupon.findOne({ _id: order.couponId, businessId: order.businessId, orderId: order._id, status: "APPLIED" }).session(session).lean();
  const batch = coupon ? await CouponBatch.findOne({ _id: coupon.batchId, businessId: order.businessId }).session(session).lean() as Batch | null : null;
  const problem = !coupon || !batch ? "The coupon on this order is no longer valid." : couponProblem({ ...coupon, status: "ACTIVE" }, batch, { customerId: order.customerId ? String(order.customerId) : null, saleDate });
  if (problem) throw new Error(`${problem} Remove the coupon before receiving payment.`);
  await Coupon.updateOne({ _id: coupon!._id, status: "APPLIED" }, { $set: { status: "REDEEMED", redeemedAt: new Date(), discountAmount: order.discountAmount ?? 0 } }, { session });
}

// Gives a paying customer one unassigned coupon from each offer whose spend rule they met.
export async function autoIssueCoupons(order: PaidOrder, saleDate: string, session: ClientSession): Promise<IssuedCoupon[]> {
  if (!order.customerId) return [];
  const batches = await CouponBatch.find({ businessId: order.businessId, isActive: true, autoIssueEnabled: true, autoIssueMinSpend: { $lte: order.grandTotal }, $or: [{ expiresOn: null }, { expiresOn: { $gte: saleDate } }] }).sort({ createdAt: 1 }).session(session).lean() as unknown as Batch[];
  const issued: IssuedCoupon[] = [], now = new Date();
  for (const batch of batches) {
    const coupon = await Coupon.findOneAndUpdate(
      { businessId: order.businessId, batchId: batch._id, status: "ACTIVE", customerId: null },
      { $set: { customerId: order.customerId, customerNameSnapshot: order.customerSnapshot?.name, customerPhoneSnapshot: order.customerSnapshot?.phone, assignmentSource: "AUTO", assignedAt: now, issuedSaleDate: saleDate, issuedOrderId: order._id, issuedOrderNumber: order.orderNumber } },
      { session, sort: { _id: 1 }, returnDocument: "after" },
    ).lean();
    if (coupon) issued.push({ couponId: coupon._id as Types.ObjectId, code: String(coupon.code), batchName: batch.name, description: couponDescription(batch), expiresOn: batch.expiresOn ?? null, usage: batch.usage });
  }
  if (issued.length) await Order.updateOne({ _id: order._id }, { $set: { issuedCoupons: issued } }, { session });
  return issued;
}

// Coupons follow the restaurant business day: an open sale keeps its date after midnight.
export async function couponBusinessDate(user: { id: string; businessId: string }) {
  return (await activeSaleSession(user))?.saleDate ?? dateISO();
}
