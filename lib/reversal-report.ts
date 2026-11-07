import "server-only";
import { cents } from "@/lib/sale-session-totals";
import { resolveReportRange, type ReportQuery } from "@/lib/reporting";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";

// Dates are the business day of the reversal, not of the original sale, so a reversal never drops out of a past report.
export async function buildReversalReport(businessId: string, query: ReportQuery) {
  const range = resolveReportRange(query);
  const rows = await Payment.find({ businessId, "reversal.saleDate": { $gte: range.fromText, $lte: range.toText } }).sort({ "reversal.reversedAt": -1 }).limit(1000).lean();
  const orders = await Order.find({ businessId, _id: { $in: rows.map(row => row.orderId) } }).select("orderNumber orderType status paymentStatus").lean();
  const orderById = new Map(orders.map(order => [String(order._id), order]));
  const reversals = rows.map(row => {
    const order = orderById.get(String(row.orderId)), reversal = row.reversal!;
    return {
      id: String(row._id), orderId: String(row.orderId), orderNumber: String(order?.orderNumber ?? "Unknown"), orderType: String(order?.orderType ?? ""),
      amount: row.amount as number, method: String(row.method), paidAt: row.paidAt as Date, paidSaleDate: row.saleDate ? String(row.saleDate) : "", receivedBy: String(row.receivedByNameSnapshot ?? ""),
      reason: String(reversal.reason), reversedAt: reversal.reversedAt as Date, reversedBy: String(reversal.reversedByNameSnapshot ?? ""), saleDate: String(reversal.saleDate ?? ""), counter: String(reversal.counterNameSnapshot ?? ""),
      outcome: order?.status === "CANCELLED" ? "Cancelled" : order?.paymentStatus === "PAID" ? "Collected again" : "Still unpaid",
    };
  });
  const sum = (list: typeof reversals) => list.reduce((total, row) => total + cents(row.amount), 0) / 100;
  return { range, reversals, totals: { count: reversals.length, amount: sum(reversals), cash: sum(reversals.filter(row => row.method === "CASH")), other: sum(reversals.filter(row => row.method !== "CASH")) } };
}
