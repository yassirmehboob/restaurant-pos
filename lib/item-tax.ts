import "server-only";
import { Product } from "@/models/Product";
type Line={lineId:string;productId?:unknown;itemTaxRateSnapshot?:number;taxRate?:number};
export async function receiptItemTaxes(businessId:string,order:{items:Line[];paymentTaxRatesSnapshot?:{CASH?:number}}){
 const invoiceTax=typeof order.paymentTaxRatesSnapshot?.CASH==="number";
 const ids=order.items.filter(line=>line.productId&&line.itemTaxRateSnapshot===undefined&&(invoiceTax||line.taxRate===undefined)).map(line=>line.productId);
 const products=ids.length?await Product.find({businessId,_id:{$in:ids}}).select("taxRate").lean():[];
 const rates=new Map(products.map(product=>[String(product._id),Number(product.taxRate??0)]));
 return new Map(order.items.map(line=>{
  if(typeof line.itemTaxRateSnapshot==="number")return [line.lineId,{rate:line.itemTaxRateSnapshot,current:false}];
  if(!invoiceTax&&typeof line.taxRate==="number")return [line.lineId,{rate:line.taxRate,current:false}];
  return [line.lineId,{rate:rates.get(String(line.productId))??0,current:true}];
 }));
}
