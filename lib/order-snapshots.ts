import "server-only";
import { randomUUID } from "crypto";
import { maxPreparationMinutes } from "@/lib/preparation-time";
import { businessTaxRates } from "@/lib/tax";
import { calculateOrderPreview,type PricedLine } from "@/lib/order-calculation";
import { productLinePrice } from "@/lib/weight";
import type { OrderInput } from "@/lib/validation/order";
import { Business } from "@/models/Business";
import { Deal } from "@/models/Deal";
import { Product } from "@/models/Product";

// Prices order lines from the live catalog. Kept out of the server-action file so it is never a client-callable endpoint.
export async function orderSnapshots(businessId:string,input:OrderInput){
  const productIds=input.lines.filter(line=>line.kind==="PRODUCT").map(line=>line.id),dealIds=input.lines.filter(line=>line.kind==="DEAL").map(line=>line.id);
  const[products,deals]=await Promise.all([Product.find({_id:{$in:productIds},businessId,isActive:true,isAvailable:true}).lean(),Deal.find({_id:{$in:dealIds},businessId,isActive:true,isAvailable:true}).lean()]);
  const componentIds=deals.flatMap(deal=>deal.items.map((item:{productId:unknown})=>item.productId));
  const components=await Product.find({_id:{$in:componentIds},businessId}).lean();
  const productMap=new Map(products.map(row=>[String(row._id),row])),dealMap=new Map(deals.map(row=>[String(row._id),row])),componentMap=new Map(components.map(row=>[String(row._id),row]));
  if(productMap.size!==new Set(productIds).size||dealMap.size!==new Set(dealIds).size)throw new Error("An item or deal is no longer available.");
  const priced:PricedLine[]=input.lines.map(line=>{const row=line.kind==="PRODUCT"?productMap.get(line.id):dealMap.get(line.id);if(!row)throw new Error("Catalog record unavailable.");const variant=line.kind==="PRODUCT"&&line.variantName?row.variants?.find((item:{name:string})=>item.name.toLowerCase()===line.variantName!.toLowerCase()):undefined;if(line.kind==="PRODUCT"&&line.variantName&&!variant)throw new Error(`The selected size for ${row.name} is unavailable.`);if(line.kind==="DEAL"&&line.weightGrams!==undefined)throw new Error(`${row.name} is not sold by weight.`);const price=line.kind==="PRODUCT"?productLinePrice(row,variant,line.weightGrams):{name:row.name,unitPrice:row.salePrice};return{key:`${line.kind}:${line.id}:${line.variantName??""}:${line.weightGrams??""}`,name:price.name,quantity:line.quantity,unitPrice:price.unitPrice,taxRate:line.kind==="PRODUCT"?row.taxRate:0,isTaxInclusive:line.kind==="PRODUCT"?row.isTaxInclusive:false}});
  const business=await Business.findOne({_id:businessId,isActive:true}).lean();if(!business)throw new Error("Business unavailable.");
  const paymentTaxRatesSnapshot=businessTaxRates(business),taxRateSnapshot=paymentTaxRatesSnapshot?.[input.paymentMethod],taxPaymentMethod=input.paymentMethod;
  // build(discount) re-prices the same snapshot lines with a coupon discount, without reloading the catalog.
  const build=(discount=0)=>{
  const totals=calculateOrderPreview(priced,input.orderType==="DELIVERY"?input.deliveryCharge:0,taxRateSnapshot,discount);
  const items=totals.lines.map((calculated,index)=>{const source=input.lines[index];if(source.kind==="PRODUCT"){const row=productMap.get(source.id)!,variant=source.variantName?row.variants?.find((item:{name:string})=>item.name.toLowerCase()===source.variantName!.toLowerCase()):undefined,price=productLinePrice(row,variant,source.weightGrams);return{lineId:source.lineId||randomUUID(),itemType:"PRODUCT",productId:row._id,preparationTimeMinutesSnapshot:row.preparationTimeMinutes??null,nameSnapshot:price.name,variantNameSnapshot:variant?.name,weightGrams:price.weightGrams,pricePerKgSnapshot:price.pricePerKg,imageUrlSnapshot:row.imageUrl,quantity:source.quantity,unitPrice:price.unitPrice,unitCost:price.unitCost,itemTaxRateSnapshot:row.taxRate??0,taxRate:calculated.taxRate,isTaxInclusive:calculated.isTaxInclusive,discountAmount:calculated.discountAmount,lineSubtotal:calculated.baseAmount,lineTax:calculated.taxAmount,lineTotal:calculated.lineTotal,notes:source.note||undefined,dealItemsSnapshot:[]}}const row=dealMap.get(source.id)!;const dealItemsSnapshot=row.items.map((component:{productId:unknown;quantity:number})=>{const product=componentMap.get(String(component.productId));return{productId:product?._id,name:product?.name??"Unavailable item",quantity:component.quantity,unitCost:product?.costPrice??0}});const unitCost=dealItemsSnapshot.reduce((sum:number,item:{quantity:number;unitCost:number})=>sum+item.quantity*item.unitCost,0);return{lineId:source.lineId||randomUUID(),itemType:"DEAL",dealId:row._id,preparationTimeMinutesSnapshot:maxPreparationMinutes(row.items.map((component:{productId:unknown})=>componentMap.get(String(component.productId))?.preparationTimeMinutes)),nameSnapshot:row.name,imageUrlSnapshot:row.imageUrl,quantity:source.quantity,unitPrice:row.salePrice,unitCost,itemTaxRateSnapshot:0,taxRate:calculated.taxRate,isTaxInclusive:calculated.isTaxInclusive,discountAmount:calculated.discountAmount,lineSubtotal:calculated.baseAmount,lineTax:calculated.taxAmount,lineTotal:calculated.lineTotal,notes:source.note||undefined,dealItemsSnapshot}});
  return{items,totals}};
  return{...build(),build,paymentTaxRatesSnapshot,taxRateSnapshot,taxPaymentMethod};
}
