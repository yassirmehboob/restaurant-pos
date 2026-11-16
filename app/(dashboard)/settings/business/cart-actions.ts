"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { Business } from "@/models/Business";
import { CART_INCREASE_MODES } from "@/lib/pos-cart";

export async function saveCartSettings(value: string) {
  const user = await requirePermission("settings"), mode = z.enum(CART_INCREASE_MODES).parse(value);
  await connectToDatabase();
  const update = { cartIncreaseMode: mode };
  const result = await Business.updateOne({ _id: user.businessId, isActive: true }, { $set: update });
  if (!result.matchedCount) throw new Error("Business unavailable.");
  await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "UPDATE_CART_SETTINGS", entityType: "Business", entityId: user.businessId,
    description: "Updated cart behavior", metadata: update });
  revalidatePath("/settings/business");
  revalidatePath("/pos");
}
