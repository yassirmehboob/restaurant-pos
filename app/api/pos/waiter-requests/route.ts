import { getCurrentUser } from "@/data/auth";
import { can } from "@/lib/permissions";
import { COUNTER_ROLES } from "@/lib/roles";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { WaiterRequest } from "@/models/WaiterRequest";
import { Staff } from "@/models/Staff";
import { activeSaleSession } from "@/lib/sale-sessions";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ message: "Please sign in again." }, { status: 401 });
  if (!COUNTER_ROLES.includes(user.role) || !can(user, "pos")) return Response.json({ message: "Access denied." }, { status: 403 });
  await connectToDatabase();
  // Only orders for the open sale: those sent from the start of its sale date (Pakistan time), so a waiter
  // order sent just before the counter opened still shows, and requests left pending on earlier days do not.
  const sale = await activeSaleSession(user);
  if (!sale) return Response.json({ currency: "PKR", saleDate: "", waiters: [], requests: [] }, { headers: { "Cache-Control": "private, no-store" } });
  const saleDate = String(sale.saleDate);
  const [requests, business, waiters] = await Promise.all([
    WaiterRequest.find({ businessId: user.businessId, status: "PENDING", createdAt: { $gte: new Date(`${saleDate}T00:00:00+05:00`) } }).select("revision waiterName source guest tableName displayLines summary createdAt").sort({ createdAt: 1 }).lean(),
    Business.findById(user.businessId).select("currency printerMode").lean(),
    Staff.find({ businessId: user.businessId, isActive: true, role: "WAITER" }).select("fullName").sort({ fullName: 1 }).lean(),
  ]);
  return Response.json({ currency: business?.currency ?? "PKR", saleDate, printerMode: business?.printerMode === "QZ" ? "QZ" : "BROWSER", waiters: waiters.map(row => ({ id: String(row._id), name: row.fullName })), requests: requests.map(row => ({
    id: String(row._id), revision: row.revision, waiterName: row.waiterName, tableName: row.tableName || "No table",
    source: row.source === "QR" ? "QR" : "WAITER", guest: row.source === "QR" ? { name: row.guest?.name ?? "", phone: row.guest?.phone ?? "", verified: row.guest?.verified === true } : undefined,
    createdAt: new Date(row.createdAt).toISOString(),
    lines: row.displayLines.map((line: { name: string; quantity: number; note?: string }) => ({ name: line.name, quantity: line.quantity, note: line.note ?? "" })),
    summary: { subtotal: row.summary?.subtotal ?? 0, taxAmount: row.summary?.taxAmount ?? 0, grandTotal: row.summary?.grandTotal ?? 0 },
  })) }, { headers: { "Cache-Control": "private, no-store" } });
}
