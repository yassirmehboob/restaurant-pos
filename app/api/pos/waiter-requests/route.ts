import { getCurrentUser } from "@/data/auth";
import { can } from "@/lib/permissions";
import { COUNTER_ROLES } from "@/lib/roles";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { WaiterRequest } from "@/models/WaiterRequest";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ message: "Please sign in again." }, { status: 401 });
  if (!COUNTER_ROLES.includes(user.role) || !can(user, "pos")) return Response.json({ message: "Access denied." }, { status: 403 });
  await connectToDatabase();
  const [requests, business] = await Promise.all([
    WaiterRequest.find({ businessId: user.businessId, status: "PENDING" }).select("revision waiterName tableName displayLines summary createdAt").sort({ createdAt: 1 }).lean(),
    Business.findById(user.businessId).select("currency").lean(),
  ]);
  return Response.json({ currency: business?.currency ?? "PKR", requests: requests.map(row => ({
    id: String(row._id), revision: row.revision, waiterName: row.waiterName, tableName: row.tableName,
    createdAt: new Date(row.createdAt).toISOString(),
    lines: row.displayLines.map((line: { name: string; quantity: number; note?: string }) => ({ name: line.name, quantity: line.quantity, note: line.note ?? "" })),
    summary: { subtotal: row.summary?.subtotal ?? 0, taxAmount: row.summary?.taxAmount ?? 0, grandTotal: row.summary?.grandTotal ?? 0 },
  })) }, { headers: { "Cache-Control": "private, no-store" } });
}
