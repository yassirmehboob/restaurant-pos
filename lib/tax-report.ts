import "server-only";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";
import { paidSalesFilter, resolveReportRange, type ReportQuery } from "@/lib/reporting";

export async function buildTaxReport(businessId: string, query: ReportQuery) {
  const range = resolveReportRange(query);
  const rows = await Order.find({ ...await paidSalesFilter(businessId, range), taxAmount: { $gt: 0 } })
    .select("orderNumber saleDate createdAt completedAt orderType taxAmount grandTotal")
    .sort({ saleDate: -1, createdAt: -1 }).lean();
  const payments = await Payment.find({ businessId, orderId: { $in: rows.map(order => order._id) }, reversal: null })
    .select("orderId method").sort({ paidAt: 1 }).lean();
  const methods = new Map<string, Set<string>>();
  for (const payment of payments) {
    const id = String(payment.orderId), values = methods.get(id) ?? new Set<string>();
    values.add(payment.method);
    methods.set(id, values);
  }
  const orders = rows.map(order => ({ ...order, paymentMethods: [...(methods.get(String(order._id)) ?? [])] }));
  const totals = orders.reduce((sum, order) => ({
    orders: sum.orders + 1,
    taxedOrders: sum.taxedOrders + (order.taxAmount > 0 ? 1 : 0),
    tax: sum.tax + order.taxAmount,
    sales: sum.sales + order.grandTotal,
  }), { orders: 0, taxedOrders: 0, tax: 0, sales: 0 });
  return { range, orders, totals };
}
