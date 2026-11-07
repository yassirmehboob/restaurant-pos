import "server-only";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import type { TicketCategory } from "@/lib/kitchen-tickets";

type Component={productId?:unknown;name:string;quantity:number};
type Line={productId?:unknown;dealItemsSnapshot?:Component[]|null};

// Tags each order line, and each item inside a deal, with its product's current menu category for
// per-category kitchen tickets (lib/kitchen-tickets.ts). Orders do not snapshot categories, so a
// product moved to another category prints at its new counter.
export async function withKitchenCategories<L extends Line>(businessId:string,items:L[]):Promise<(L&TicketCategory&{dealItemsSnapshot?:(Component&TicketCategory)[]})[]>{
  const ids=[...new Set(items.flatMap(line=>[line.productId,...(line.dealItemsSnapshot??[]).map(item=>item.productId)]).filter(Boolean).map(String))];
  const products=ids.length?await Product.find({_id:{$in:ids},businessId}).select("categoryId").lean():[];
  const categoryIds=[...new Set(products.map(product=>String(product.categoryId)))];
  const categories=categoryIds.length?await Category.find({_id:{$in:categoryIds},businessId}).select("name sortOrder").lean():[];
  const byCategory=new Map(categories.map(category=>[String(category._id),{categoryName:String(category.name),categorySort:Number(category.sortOrder??0)}]));
  const byProduct=new Map(products.map(product=>[String(product._id),byCategory.get(String(product.categoryId))]));
  const of=(productId:unknown):TicketCategory=>(productId?byProduct.get(String(productId)):undefined)??{};
  return items.map(line=>({...line,...of(line.productId),...(line.dealItemsSnapshot?{dealItemsSnapshot:line.dealItemsSnapshot.map(item=>({...item,...of(item.productId)}))}:{})}));
}
