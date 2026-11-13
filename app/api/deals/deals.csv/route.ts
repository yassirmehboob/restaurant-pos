import { getCurrentUser } from "@/data/auth";
import { csvCell } from "@/lib/csv";
import { connectToDatabase } from "@/lib/db";
import { can } from "@/lib/permissions";
import { dealComponentName } from "@/lib/weight";
import { Deal } from "@/models/Deal";
import { Product } from "@/models/Product";

type DealRow = { name: string; description?: string; salePrice: number; isAvailable: boolean; items: { productId: unknown; quantity: number; weightGrams?: number; variantName?: string }[] };

// Active deals only, in menu order, for building a printed/online menu.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!can(user, "catalog")) return new Response("Forbidden", { status: 403 });
  await connectToDatabase();
  const [deals, products] = await Promise.all([
    Deal.find({ businessId: user.businessId, isActive: true }).sort({ sortOrder: 1, name: 1 }).select("name description salePrice isAvailable items").lean<DealRow[]>(),
    Product.find({ businessId: user.businessId }).select("name").lean<{ _id: unknown; name: string }[]>(),
  ]);
  const names = new Map(products.map(product => [String(product._id), product.name]));
  const rows = [
    ["Deal Name", "Description", "Price", "Included Items", "Item Count", "Available"],
    ...deals.map(deal => [
      deal.name,
      deal.description ?? "",
      deal.salePrice,
      deal.items.map(item => `${dealComponentName(names.get(String(item.productId)) ?? "Inactive item", item)} - Qty ${item.quantity}`).join(", "),
      deal.items.reduce((sum, item) => sum + item.quantity, 0),
      deal.isAvailable ? "Yes" : "No",
    ]),
  ];
  const body = "﻿" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  return new Response(body, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="deals-menu.csv"',
    "Cache-Control": "private, no-store",
  } });
}
