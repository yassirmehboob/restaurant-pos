import "server-only";
import { Product } from "@/models/Product";
import { maxPreparationMinutes } from "@/lib/preparation-time";

type Line = { productId?: unknown; preparationTimeMinutesSnapshot?: number | null; dealItemsSnapshot?: { productId?: unknown }[] };
export async function receiptPreparationMinutes(businessId: string, order: { items: Line[] }) {
  const ids = order.items.filter(line => line.preparationTimeMinutesSnapshot === undefined)
    .flatMap(line => line.productId ? [line.productId] : (line.dealItemsSnapshot ?? []).map(item => item.productId)).filter(Boolean);
  const products = ids.length ? await Product.find({ businessId, _id: { $in: ids } }).select("preparationTimeMinutes").lean() : [];
  const times = new Map(products.map(product => [String(product._id), product.preparationTimeMinutes as number | null | undefined]));
  return maxPreparationMinutes(order.items.map(line => {
    if (line.preparationTimeMinutesSnapshot !== undefined) return line.preparationTimeMinutesSnapshot;
    return line.productId ? times.get(String(line.productId)) : maxPreparationMinutes((line.dealItemsSnapshot ?? []).map(item => times.get(String(item.productId))));
  }));
}
