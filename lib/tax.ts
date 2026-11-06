import { calculateOrderPreview } from "@/lib/order-calculation";
export const PAYMENT_METHODS=["CASH","CARD","BANK","OTHER"] as const;
export type PaymentMethod=(typeof PAYMENT_METHODS)[number];
export type TaxRates=Record<PaymentMethod,number>;
const money=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
export function businessTaxRates(business:{saleTaxRate?:number|null;paymentTaxRates?:Partial<Record<PaymentMethod,number|null>>|null}):TaxRates|undefined{
 if(typeof business.saleTaxRate!=="number")return undefined;
 return Object.fromEntries(PAYMENT_METHODS.map(method=>[method,business.paymentTaxRates?.[method]??business.saleTaxRate])) as TaxRates;
}
type StoredLine={lineId:string;nameSnapshot:string;quantity:number;unitPrice:number;taxRate:number;isTaxInclusive:boolean};
export type TaxOrder={items:StoredLine[];subtotal:number;taxAmount:number;grandTotal:number;dueAmount:number;paidAmount:number;deliveryChargeAmount?:number;serviceChargeAmount?:number;discountAmount?:number;paymentTaxRatesSnapshot?:Partial<TaxRates>;taxPaymentMethod?:PaymentMethod;taxRateSnapshot?:number};
export function paymentTaxQuote(order:TaxOrder,method:PaymentMethod){
 const rates=order.paymentTaxRatesSnapshot;
 const discountAmount=order.discountAmount??0;
 if(!rates||!PAYMENT_METHODS.every(key=>typeof rates[key]==="number"))return {subtotal:order.subtotal,discountAmount,taxAmount:order.taxAmount,grandTotal:order.grandTotal,dueAmount:order.dueAmount,taxRate:order.taxRateSnapshot,method,lines:undefined};
 if(order.paidAmount>0){if(method!==(order.taxPaymentMethod??"CASH"))throw new Error("A partially paid invoice cannot change its tax payment method.");return {subtotal:order.subtotal,discountAmount,taxAmount:order.taxAmount,grandTotal:order.grandTotal,dueAmount:order.dueAmount,taxRate:order.taxRateSnapshot,method,lines:undefined}}
 // A coupon discount is a fixed amount off the pre-tax subtotal, so it is unchanged by the tax rate.
 const rate=rates[method]!;
 const result=calculateOrderPreview(order.items.map(line=>({key:line.lineId,name:line.nameSnapshot,quantity:line.quantity,unitPrice:line.unitPrice,taxRate:line.taxRate,isTaxInclusive:line.isTaxInclusive})),order.deliveryChargeAmount??0,rate,discountAmount);
 const grandTotal=money(result.grandTotal+(order.serviceChargeAmount??0));
 return {subtotal:result.subtotal,discountAmount:result.discountAmount,taxAmount:result.taxAmount,grandTotal,dueAmount:money(grandTotal-order.paidAmount),taxRate:rate,method,lines:result.lines};
}
// Recalculates a saved, unpaid invoice with a new discount, keeping its stored prices and tax rates.
export function orderWithDiscount<Line extends StoredLine>(order:Omit<TaxOrder,"items">&{items:Line[]},discount:number){
 const rates=order.paymentTaxRatesSnapshot,businessTax=!!rates&&PAYMENT_METHODS.every(key=>typeof rates[key]==="number");
 const rate=businessTax?(order.taxRateSnapshot??rates![order.taxPaymentMethod??"CASH"]):undefined;
 const result=calculateOrderPreview(order.items.map(line=>({key:line.lineId,name:line.nameSnapshot,quantity:line.quantity,unitPrice:line.unitPrice,taxRate:line.taxRate,isTaxInclusive:line.isTaxInclusive})),order.deliveryChargeAmount??0,rate,discount);
 const items=order.items.map((line,index)=>({...line,discountAmount:result.lines[index].discountAmount,lineTax:result.lines[index].taxAmount,lineTotal:result.lines[index].lineTotal}));
 const grandTotal=money(result.grandTotal+(order.serviceChargeAmount??0));
 return{items,discountAmount:result.discountAmount,taxAmount:result.taxAmount,grandTotal,dueAmount:money(grandTotal-order.paidAmount)};
}
// Payment-time pricing: the tax quote for the method plus an optional invoice discount stacked on any coupon,
// with the recalculated lines ready to store on the paid order. amountBefore is the total without the invoice discount.
export function paymentPricing<Line extends StoredLine>(order:Omit<TaxOrder,"items">&{items:Line[]},method:PaymentMethod,invoiceDiscount=0){
 const businessTax=!!order.paymentTaxRatesSnapshot&&PAYMENT_METHODS.every(key=>typeof order.paymentTaxRatesSnapshot![key]==="number");
 if(invoiceDiscount>0&&order.paidAmount>0)throw new Error("A discount cannot be added to a partly paid invoice.");
 if(invoiceDiscount>0&&!businessTax){const result=orderWithDiscount(order,(order.discountAmount??0)+invoiceDiscount);return{subtotal:order.subtotal,discountAmount:result.discountAmount,taxAmount:result.taxAmount,grandTotal:result.grandTotal,amountBefore:orderWithDiscount(order,order.discountAmount??0).grandTotal,dueAmount:result.dueAmount,taxRate:order.taxRateSnapshot,method,items:result.items}}
 const quote=paymentTaxQuote(invoiceDiscount>0?{...order,discountAmount:(order.discountAmount??0)+invoiceDiscount}:order,method);
 const items=quote.lines?order.items.map((line,index)=>({...line,taxRate:quote.taxRate!,isTaxInclusive:false,discountAmount:quote.lines![index].discountAmount,lineTax:quote.lines![index].taxAmount,lineTotal:quote.lines![index].lineTotal})):order.items;
 return{subtotal:quote.subtotal,discountAmount:quote.discountAmount,taxAmount:quote.taxAmount,grandTotal:quote.grandTotal,amountBefore:invoiceDiscount>0?paymentTaxQuote(order,method).grandTotal:quote.grandTotal,dueAmount:quote.dueAmount,taxRate:quote.taxRate,method,items};
}
