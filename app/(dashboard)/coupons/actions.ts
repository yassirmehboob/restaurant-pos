"use server";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { couponBatchSchema, couponDescription } from "@/lib/coupons";
import { couponBusinessDate, generateUniqueCodes } from "@/lib/coupon-service";
import { Coupon } from "@/models/Coupon";
import { CouponBatch } from "@/models/CouponBatch";
import { Customer } from "@/models/Customer";

const id = z.string().regex(/^[a-f\d]{24}$/i);
const PAGE_SIZE = 50;
const STATUSES = ["ACTIVE", "APPLIED", "REDEEMED", "VOID"] as const;
const message = (error: unknown, fallback: string) => error instanceof z.ZodError ? error.issues[0]?.message ?? fallback : error instanceof Error && error.constructor === Error ? error.message : fallback;

async function owner() {
  const user = await requireUser();
  if (user.role !== "OWNER") throw new Error("Only the owner can manage coupons.");
  await connectToDatabase();
  return user;
}

export async function loadCouponBatches() {
  const user = await owner(), businessId = new mongoose.Types.ObjectId(user.businessId);
  const [batches, counts] = await Promise.all([
    CouponBatch.find({ businessId }).sort({ createdAt: -1 }).limit(200).lean(),
    Coupon.aggregate<{ _id: { batchId: mongoose.Types.ObjectId; status: string; assigned: boolean }; count: number }>([
      { $match: { businessId } },
      { $group: { _id: { batchId: "$batchId", status: "$status", assigned: { $gt: ["$customerId", null] } }, count: { $sum: 1 } } },
    ]),
  ]);
  const stats = new Map<string, { available: number; given: number; applied: number; redeemed: number; void: number }>();
  for (const row of counts) {
    const entry = stats.get(String(row._id.batchId)) ?? { available: 0, given: 0, applied: 0, redeemed: 0, void: 0 };
    if (row._id.status === "ACTIVE") entry[row._id.assigned ? "given" : "available"] += row.count;
    else if (row._id.status === "APPLIED") entry.applied += row.count;
    else if (row._id.status === "REDEEMED") entry.redeemed += row.count;
    else entry.void += row.count;
    stats.set(String(row._id.batchId), entry);
  }
  return batches.map(batch => ({
    id: String(batch._id), name: String(batch.name), description: couponDescription(batch), usage: batch.usage as "INSTANT" | "NEXT_VISIT",
    discountType: batch.discountType as "PERCENT" | "FIXED", discountValue: Number(batch.discountValue), maxDiscount: batch.maxDiscount ?? null, minOrderAmount: Number(batch.minOrderAmount ?? 0),
    validFrom: batch.validFrom ?? null, expiresOn: batch.expiresOn ?? null, autoIssueEnabled: !!batch.autoIssueEnabled, autoIssueMinSpend: Number(batch.autoIssueMinSpend ?? 0),
    quantity: Number(batch.quantity), isActive: batch.isActive !== false, createdAt: new Date(batch.createdAt).toISOString(), createdByName: String(batch.createdByName ?? ""),
    stats: stats.get(String(batch._id)) ?? { available: 0, given: 0, applied: 0, redeemed: 0, void: 0 },
  }));
}
export type CouponBatchView = Awaited<ReturnType<typeof loadCouponBatches>>[number];

export async function createCouponBatch(raw: unknown) {
  try {
    const user = await owner(), values = couponBatchSchema.parse(raw);
    let batchId = "";
    // A code taken by a simultaneous batch aborts the transaction; retrying draws fresh codes.
    for (let attempt = 0; attempt < 3 && !batchId; attempt++) {
      try {
        batchId = await mongoose.connection.transaction(async transaction => {
          const [batch] = await CouponBatch.create([{ ...values, businessId: user.businessId, createdByUserId: user.id, createdByName: user.fullName }], { session: transaction });
          const codes = await generateUniqueCodes(values.quantity, transaction);
          for (let offset = 0; offset < codes.length; offset += 1000) await Coupon.insertMany(codes.slice(offset, offset + 1000).map(code => ({ businessId: user.businessId, batchId: batch._id, code, status: "ACTIVE" })), { session: transaction });
          return String(batch._id);
        });
      } catch (error) { if ((error as { code?: number }).code !== 11000 || attempt === 2) throw error; }
    }
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "CREATE_COUPONS", entityType: "CouponBatch", entityId: batchId, description: `Created ${values.quantity.toLocaleString()} coupon${values.quantity === 1 ? "" : "s"} for ${values.name}: ${couponDescription(values)}`, metadata: { quantity: values.quantity, usage: values.usage, autoIssueEnabled: values.autoIssueEnabled, expiresOn: values.expiresOn } });
    revalidatePath("/coupons");
    return { ok: true as const, batchId };
  } catch (error) { return { ok: false as const, message: message(error, "Could not create the coupons. Please try again.") }; }
}

export async function setCouponBatchActive(batchId: string, active: boolean) {
  try {
    const user = await owner(); id.parse(batchId); z.boolean().parse(active);
    const batch = await CouponBatch.findOneAndUpdate({ _id: batchId, businessId: user.businessId }, { $set: { isActive: active } }, { returnDocument: "after" }).lean();
    if (!batch) throw new Error("Coupon offer not found.");
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: active ? "RESUME_COUPONS" : "STOP_COUPONS", entityType: "CouponBatch", entityId: batchId, description: `${active ? "Resumed" : "Stopped"} the ${batch.name} coupon offer` });
    revalidatePath("/coupons");
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: message(error, "Could not update the offer.") }; }
}

export async function listBatchCoupons(batchId: string, options: { search?: string; status?: string; page?: number }) {
  try {
    const user = await owner(); id.parse(batchId);
    const filter: Record<string, unknown> = { businessId: user.businessId, batchId };
    const status = STATUSES.find(value => value === options.status);
    if (status) filter.status = status;
    const search = String(options.search ?? "").trim().slice(0, 40);
    if (search) {
      const digits = search.replace(/\D/g, ""), escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [...(digits ? [{ code: { $regex: digits } }, { customerPhoneSnapshot: { $regex: digits } }] : []), { customerNameSnapshot: { $regex: escaped, $options: "i" } }, { orderNumber: { $regex: escaped, $options: "i" } }];
    }
    const page = Math.max(1, Math.min(1000, Math.trunc(Number(options.page) || 1)));
    const [rows, total] = await Promise.all([Coupon.find(filter).sort({ _id: 1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(), Coupon.countDocuments(filter)]);
    return { ok: true as const, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, coupons: rows.map(row => ({
      id: String(row._id), code: String(row.code), status: String(row.status), customerName: row.customerNameSnapshot ?? "", customerPhone: row.customerPhoneSnapshot ?? "",
      source: row.assignmentSource ?? "", assignedAt: row.assignedAt ? new Date(row.assignedAt).toISOString() : null, issuedOrderNumber: row.issuedOrderNumber ?? "",
      orderNumber: row.orderNumber ?? "", redeemedAt: row.redeemedAt ? new Date(row.redeemedAt).toISOString() : null, discountAmount: row.discountAmount ?? null, voidReason: row.voidReason ?? "",
    })) };
  } catch (error) { return { ok: false as const, message: message(error, "Could not load coupons."), page: 1, pages: 1, total: 0, coupons: [] }; }
}

export async function searchCouponCustomers(query: string) {
  try {
    const user = await owner(), text = String(query ?? "").trim().slice(0, 40);
    if (text.length < 2) return [];
    const digits = text.replace(/\D/g, ""), escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rows = await Customer.find({ businessId: user.businessId, isActive: true, $or: [{ name: { $regex: escaped, $options: "i" } }, ...(digits.length >= 3 ? [{ phone: { $regex: digits } }] : [])] }).sort({ name: 1 }).limit(10).lean();
    return rows.map(row => ({ id: String(row._id), name: String(row.name), phone: String(row.phone ?? "") }));
  } catch { return []; }
}

// Gives the next unassigned coupon of an offer to a customer chosen by the owner.
export async function giveCouponToCustomer(batchId: string, customerId: string) {
  try {
    const user = await owner(); id.parse(batchId); id.parse(customerId);
    const [batch, customer] = await Promise.all([CouponBatch.findOne({ _id: batchId, businessId: user.businessId }).lean(), Customer.findOne({ _id: customerId, businessId: user.businessId, isActive: true }).lean()]);
    if (!batch) throw new Error("Coupon offer not found.");
    if (!batch.isActive) throw new Error("Resume this offer before giving its coupons.");
    const today = await couponBusinessDate(user);
    if (batch.expiresOn && batch.expiresOn < today) throw new Error("This offer has expired.");
    if (!customer) throw new Error("Customer not found.");
    const coupon = await Coupon.findOneAndUpdate({ businessId: user.businessId, batchId, status: "ACTIVE", customerId: null }, { $set: { customerId: customer._id, customerNameSnapshot: customer.name, customerPhoneSnapshot: customer.phone, assignmentSource: "MANUAL", assignedAt: new Date(), assignedByUserId: user.id, issuedSaleDate: today } }, { sort: { _id: 1 }, returnDocument: "after" }).lean();
    if (!coupon) throw new Error("All coupons of this offer have been given out. Create more coupons for it.");
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "GIVE_COUPON", entityType: "Coupon", entityId: String(coupon._id), description: `Gave coupon ${coupon.code} (${batch.name}) to ${customer.name}` });
    revalidatePath("/coupons");
    return { ok: true as const, code: String(coupon.code), customerName: String(customer.name), description: couponDescription(batch), usage: batch.usage as string, expiresOn: batch.expiresOn ?? null };
  } catch (error) { return { ok: false as const, message: message(error, "Could not give the coupon.") }; }
}

export async function takeBackCoupon(couponId: string) {
  try {
    const user = await owner(); id.parse(couponId);
    const coupon = await Coupon.findOneAndUpdate({ _id: couponId, businessId: user.businessId, status: "ACTIVE", customerId: { $ne: null } }, { $unset: { customerId: "", customerNameSnapshot: "", customerPhoneSnapshot: "", assignmentSource: "", assignedAt: "", assignedByUserId: "", issuedSaleDate: "", issuedOrderId: "", issuedOrderNumber: "" } }, { returnDocument: "before" }).lean();
    if (!coupon) throw new Error("Only an unused coupon that was given to a customer can be taken back.");
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "TAKE_BACK_COUPON", entityType: "Coupon", entityId: couponId, description: `Took back coupon ${coupon.code} from ${coupon.customerNameSnapshot ?? "a customer"}` });
    revalidatePath("/coupons");
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: message(error, "Could not take back the coupon.") }; }
}

// Voided codes are kept forever so they can never be issued or used again.
export async function voidCoupon(couponId: string, reason: string) {
  try {
    const user = await owner(); id.parse(couponId);
    const clean = z.string().trim().min(3, "Enter a reason of at least 3 characters.").max(200).parse(reason);
    const coupon = await Coupon.findOneAndUpdate({ _id: couponId, businessId: user.businessId, status: "ACTIVE" }, { $set: { status: "VOID", voidedAt: new Date(), voidReason: clean } }, { returnDocument: "after" }).lean();
    if (!coupon) throw new Error("Only an unused coupon can be cancelled. Remove it from its order first if it is applied.");
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "VOID_COUPON", entityType: "Coupon", entityId: couponId, description: `Cancelled coupon ${coupon.code}: ${clean}` });
    revalidatePath("/coupons");
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: message(error, "Could not cancel the coupon.") }; }
}
