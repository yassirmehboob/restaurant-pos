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
