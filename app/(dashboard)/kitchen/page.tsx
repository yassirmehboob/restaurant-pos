import mongoose from "mongoose";
import { Business } from "@/models/Business";
import { advanceKitchenOrders } from "@/lib/kitchen-timing.mjs";
import { requirePagePermission } from "@/data/auth";
import { KitchenBoard } from "@/components/kitchen-board";
import { connectToDatabase } from "@/lib/db";
import { loadKitchenOrders } from "@/lib/kitchen-orders";

export default async function KitchenPage() {
  const user = await requirePagePermission("kitchen");
  await connectToDatabase();
  const business = await Business.findOne({ _id: user.businessId, isActive: true }).lean();
  if (business && mongoose.connection.db) await advanceKitchenOrders(mongoose.connection.db, business);
  const { rows, now } = await loadKitchenOrders(user.businessId);
  return <KitchenBoard initialNow={now} timing={business?.kitchenTimingEnabled ? { preparingSeconds: business.kitchenPreparingDelaySeconds ?? 60, readyMinutes: business.kitchenReadyDelayMinutes ?? 25 } : undefined}
    orders={rows.map(order => ({
      id: String(order._id), orderNumber: order.orderNumber,
      status: order.status as "SENT_TO_KITCHEN" | "PREPARING" | "READY", orderType: order.orderType,
      customer: order.customerSnapshot?.name || "Walk-in customer", table: order.tableNameSnapshot || "", waiter: order.waiterNameSnapshot || "",
      createdAt: order.createdAt.toISOString(), kitchenSentAt: (order.kitchenSentAt ?? order.createdAt).toISOString(),
      preparingAt: order.preparingAt?.toISOString(), readyAt: order.readyAt?.toISOString(), notes: order.notes,
      items: order.items.map((item: { lineId: string; nameSnapshot: string; quantity: number; notes?: string; dealItemsSnapshot?: { name: string; quantity: number }[] }) => ({
        id: item.lineId, name: item.nameSnapshot, quantity: item.quantity, notes: item.notes,
        dealItems: (item.dealItemsSnapshot ?? []).map(component => ({ name: component.name, quantity: component.quantity * item.quantity })),
      })),
    }))}/>
}
