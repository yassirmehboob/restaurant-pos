import { getCurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { csvCell } from "@/lib/csv";
import { formatDate, formatDateTime } from "@/lib/dates";
import { couponDescription } from "@/lib/coupons";
import { Coupon } from "@/models/Coupon";
import { CouponBatch } from "@/models/CouponBatch";

const STATUS: Record<string, string> = { ACTIVE: "Unused", APPLIED: "On unpaid order", REDEEMED: "Used", VOID: "Cancelled" };

export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ message: "Please sign in again." }, { status: 401 });
  if (user.role !== "OWNER") return Response.json({ message: "Only the owner can download coupon codes." }, { status: 403 });
  const { batchId } = await params;
  if (!/^[a-f\d]{24}$/i.test(batchId)) return Response.json({ message: "Coupon offer not found." }, { status: 404 });
  await connectToDatabase();
  const batch = await CouponBatch.findOne({ _id: batchId, businessId: user.businessId }).lean();
  if (!batch) return Response.json({ message: "Coupon offer not found." }, { status: 404 });
  const coupons = await Coupon.find({ businessId: user.businessId, batchId }).sort({ _id: 1 }).lean();
  const offer = couponDescription(batch), usage = batch.usage === "NEXT_VISIT" ? "Next visit" : "Use now";
  const header = ["Code", "Offer", "Discount", "Usable", "Valid from", "Expires", "Status", "Customer", "Phone", "Given on", "Order", "Used on", "Discount given"];
  const rows = coupons.map(coupon => [coupon.code, batch.name, offer, usage, batch.validFrom ? formatDate(batch.validFrom) : "", batch.expiresOn ? formatDate(batch.expiresOn) : "", STATUS[String(coupon.status)] ?? coupon.status, coupon.customerNameSnapshot ?? "", coupon.customerPhoneSnapshot ?? "", coupon.assignedAt ? formatDateTime(coupon.assignedAt) : "", coupon.orderNumber ?? "", coupon.redeemedAt ? formatDateTime(coupon.redeemedAt) : "", coupon.discountAmount ?? ""]);
  // Codes never start with 0, so spreadsheets keep all ten digits.
  const csv = "﻿" + [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  const name = String(batch.name).replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "coupons";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-coupons.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
