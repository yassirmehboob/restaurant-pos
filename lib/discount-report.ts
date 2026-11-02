import "server-only";
import { Order } from "@/models/Order";
import { paidSalesFilter,resolveReportRange,type ReportQuery } from "@/lib/reporting";

export type DiscountReportQuery=ReportQuery&{type?:string};
// Paid invoices that carried an invoice discount, newest first, for the selected sale dates.
export async function buildDiscountReport(businessId:string,query:DiscountReportQuery){
 const range=resolveReportRange(query),type=typeof query.type==="string"?query.type.trim().slice(0,60):"";
 const rows=await Order.find({...await paidSalesFilter(businessId,range),"invoiceDiscount.amount":{$gt:0},...(type?{"invoiceDiscount.name":type}:{})}).select("orderNumber saleDate createdAt grandTotal invoiceDiscount waiterNameSnapshot cashierNameSnapshot").sort({saleDate:-1,createdAt:-1}).limit(1000).lean();
 const invoices=rows.map(row=>{const discount=row.invoiceDiscount!;return{id:String(row._id),orderNumber:row.orderNumber,saleDate:row.saleDate??"",createdAt:row.createdAt as Date,name:discount.name??"Discount",percent:discount.percent??0,amount:discount.amount??0,amountBefore:discount.amountBefore??row.grandTotal+(discount.amount??0),amountAfter:row.grandTotal,remarks:discount.remarks??"",cashier:discount.appliedByName||row.cashierNameSnapshot||"",waiter:row.waiterNameSnapshot??""}});
 const totals=invoices.reduce((sum,row)=>({count:sum.count+1,before:sum.before+row.amountBefore,discount:sum.discount+row.amount,after:sum.after+row.amountAfter}),{count:0,before:0,discount:0,after:0});
 return{range,type,invoices,totals};
}
