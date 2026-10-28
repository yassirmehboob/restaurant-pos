import "server-only";
import { Order } from "@/models/Order";
import { SaleSession } from "@/models/SaleSession";

export async function loadKitchenOrders(businessId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const sessions = await SaleSession.find({
    businessId,
    $or: [
      { status: "OPEN" },
      { status: "CLOSED", closedAt: { $gte: cutoff, $lte: now } },
    ],
  }).select("_id").lean();
  const rows = await Order.find({
    businessId,
    saleSessionId: { $in: sessions.map(session => session._id) },
    status: { $in: ["SENT_TO_KITCHEN", "PREPARING", "READY"] },
  }).select("orderNumber status orderType customerSnapshot.name tableNameSnapshot waiterNameSnapshot createdAt kitchenSentAt preparingAt readyAt notes items.lineId items.nameSnapshot items.quantity items.notes items.dealItemsSnapshot.name items.dealItemsSnapshot.quantity").sort({ createdAt: 1 }).lean();
  return { rows, now: now.getTime() };
}
