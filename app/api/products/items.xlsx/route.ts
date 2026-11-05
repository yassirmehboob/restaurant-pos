import { getCurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { itemExportWorkbook } from "@/lib/item-export";
import { can } from "@/lib/permissions";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!can(user, "catalog")) return new Response("Forbidden", { status: 403 });
  await connectToDatabase();
  // Cost prices are deliberately left out.
  const [categories, products] = await Promise.all([
    Category.find({ businessId: user.businessId }).select("name").lean(),
    Product.find({ businessId: user.businessId }).select("categoryId name sellBy salePrice variants.name variants.salePrice isActive isAvailable").lean(),
  ]);
  const file = await itemExportWorkbook(categories, products);
  return new Response(new Uint8Array(file), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="items.xlsx"',
    "Cache-Control": "private, no-store",
  } });
}
