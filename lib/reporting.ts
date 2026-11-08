import "server-only";
import { dateISO, isISODate } from "@/lib/dates";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";
import { formatWeight } from "@/lib/weight";
export type ReportQuery={range?:string;from?:string;to?:string};
// Today follows the open business day even when the calendar passes midnight.
export function businessDateQuery(query:ReportQuery,saleDate?:string):ReportQuery{
  return saleDate&&((!query.range&&!query.from&&!query.to)||query.range==="TODAY")
    ?{range:"CUSTOM",from:saleDate,to:saleDate}:query;
}
const pakistanDate=()=>dateISO();
const atStart=(date:string)=>new Date(`${date}T00:00:00+05:00`),atEnd=(date:string)=>new Date(`${date}T23:59:59.999+05:00`);
const dateText=dateISO;
export function resolveReportRange(query:ReportQuery){const today=pakistanDate(),preset=query.range??"TODAY";if(preset==="CUSTOM"&&isISODate(query.from??"")&&isISODate(query.to??"")&&query.from!<=query.to!)return{from:atStart(query.from!),to:atEnd(query.to!),fromText:query.from!,toText:query.to!,preset};const now=atStart(today),from=new Date(now);if(preset==="YESTERDAY"){from.setUTCDate(from.getUTCDate()-1);const value=dateText(from);return{from:atStart(value),to:atEnd(value),fromText:value,toText:value,preset}}if(preset==="WEEK"){const weekday=Number(new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Karachi",weekday:"short"}).format(new Date()).replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/,match=>String(["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(match))));from.setUTCDate(from.getUTCDate()-((weekday+6)%7))}if(preset==="MONTH")from.setUTCDate(1);const fromText=dateText(from);return{from:atStart(fromText),to:atEnd(today),fromText,toText:today,preset}}
// Historical records without a business date retain their original timestamp behavior.
export function saleDateFilter(range:ReturnType<typeof resolveReportRange>,timestampField:string){return {$or:[{saleDate:{$gte:range.fromText,$lte:range.toText}},{saleDate:{$exists:false},[timestampField]:{$gte:range.from,$lte:range.to}}]}}
// Payment status determines a sale. Kitchen completion is tracked independently.
// Preserve legacy completion dates; older paid orders without completion timestamps
// can still be reported using the timestamp on their payment record.
export async function paidSalesFilter(businessId:string,range:ReturnType<typeof resolveReportRange>){
  const timestamps={$gte:range.from,$lte:range.to};
  const legacyPaidIds=await Payment.distinct("orderId",{businessId,saleDate:{$exists:false},paidAt:timestamps,reversal:null});
  return{businessId,paymentStatus:"PAID",status:{$ne:"CANCELLED"},$or:[
    {saleDate:{$gte:range.fromText,$lte:range.toText}},
    {saleDate:{$exists:false},$or:[{completedAt:timestamps},{completedAt:null,_id:{$in:legacyPaidIds}}]},
  ]};
}
// CSV uses invoice-level fields only. Avoid loading item arrays and aggregating
// every payment/product just to discard those summaries when exporting.
export async function buildSalesExport(businessId:string,query:ReportQuery){
  const range=resolveReportRange(query);
  const orders=await Order.find(await paidSalesFilter(businessId,range))
    .select("orderNumber saleDate completedAt orderType customerSnapshot.name tableNameSnapshot waiterNameSnapshot subtotal taxAmount deliveryChargeAmount grandTotal paymentStatus")
    .sort({saleDate:-1,updatedAt:-1}).lean();
  return {range,orders};
}
export async function buildSalesReport(businessId:string,query:ReportQuery){const range=resolveReportRange(query),orders=await Order.find(await paidSalesFilter(businessId,range)).select("orderNumber saleDate completedAt createdAt updatedAt orderType customerSnapshot tableNameSnapshot waiterNameSnapshot subtotal discountAmount taxAmount deliveryChargeAmount grandTotal paymentStatus status items.itemType items.productId items.weightGrams items.nameSnapshot items.quantity items.lineTotal items.unitCost").sort({saleDate:-1,updatedAt:-1}).lean(),ids=orders.map(order=>order._id),payments=await Payment.find({businessId,orderId:{$in:ids},reversal:null}).select("method amount").lean();const summary={orders:orders.length,grossSales:0,discount:0,tax:0,delivery:0,netSales:0,cogs:0,grossProfit:0};const products=new Map<string,{name:string;quantity:number;weightGrams?:number;revenue:number;cost:number}>(),deals=new Map<string,{name:string;quantity:number;weightGrams?:number;revenue:number;cost:number}>(),waiters=new Map<string,{name:string;orders:number;sales:number}>(),types=new Map<string,{orders:number;sales:number}>();for(const order of orders){summary.grossSales+=order.subtotal;summary.discount+=order.discountAmount;summary.tax+=order.taxAmount;summary.delivery+=order.deliveryChargeAmount;summary.netSales+=order.grandTotal;const type=types.get(order.orderType)??{orders:0,sales:0};type.orders++;type.sales+=order.grandTotal;types.set(order.orderType,type);const waiterName=order.waiterNameSnapshot||"Unassigned";const waiter=waiters.get(waiterName)??{name:waiterName,orders:0,sales:0};waiter.orders++;waiter.sales+=order.grandTotal;waiters.set(waiterName,waiter);for(const line of order.items){const target=line.itemType==="DEAL"?deals:products,weighed=line.itemType==="PRODUCT"&&line.weightGrams?line.weightGrams:0,suffix=weighed?` (${formatWeight(weighed)})`:"",name=suffix&&line.nameSnapshot.endsWith(suffix)?line.nameSnapshot.slice(0,-suffix.length):line.nameSnapshot,key=weighed?`KG:${line.productId}`:line.nameSnapshot,entry=target.get(key)??{name,quantity:0,revenue:0,cost:0,...(weighed?{weightGrams:0}:{})};entry.quantity+=line.quantity;if(weighed)entry.weightGrams=(entry.weightGrams??0)+weighed*line.quantity;entry.revenue+=line.lineTotal;entry.cost+=line.unitCost*line.quantity;target.set(key,entry);summary.cogs+=line.unitCost*line.quantity}}summary.grossProfit=summary.netSales-summary.cogs;const paymentMethods=new Map<string,number>();for(const payment of payments)paymentMethods.set(payment.method,(paymentMethods.get(payment.method)??0)+payment.amount);return{range,orders,summary,products:[...products.values()].sort((a,b)=>b.revenue-a.revenue),deals:[...deals.values()].sort((a,b)=>b.revenue-a.revenue),waiters:[...waiters.values()].sort((a,b)=>b.sales-a.sales),types:[...types.entries()].map(([type,value])=>({type,...value})).sort((a,b)=>b.sales-a.sales),paymentMethods:[...paymentMethods.entries()].map(([method,amount])=>({method,amount}))}}
