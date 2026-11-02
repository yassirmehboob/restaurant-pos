import "server-only";
import type { ClientSession } from "mongoose";
import { Business } from "@/models/Business";
import { SmsMessage } from "@/models/SmsMessage";
import { MAX_DISCOUNT_SMS_NUMBERS,discountLabel,type AppliedDiscount } from "@/lib/invoice-discount";
import { normalizeSmsPhone } from "@/lib/sms-template";

const money=(value:number)=>value.toLocaleString("en-PK",{minimumFractionDigits:2,maximumFractionDigits:2});
export function discountSmsBody(values:{businessName:string;currency:string;orderNumber:string;amountBefore:number;discount:AppliedDiscount;amountAfter:number;cashier:string}){
 const {discount}=values,currency=values.currency||"PKR";
 return [`${values.businessName}: discount given on ${values.orderNumber}.`,`Amount: ${currency} ${money(values.amountBefore)}`,`Discount: ${discountLabel(discount)} ${currency} ${money(discount.amount)}`,`After discount: ${currency} ${money(values.amountAfter)}`,`Cashier: ${values.cashier}`,...(discount.remarks?[`Remarks: ${discount.remarks}`]:[])].join("\n").slice(0,1600);
}

// Alerts the owner's numbers about an invoice discount; queued in the payment transaction like other order SMS.
export async function queueDiscountSms(order:{_id:unknown;businessId:unknown;orderNumber:string},values:{amountBefore:number;discount:AppliedDiscount;amountAfter:number;cashier:string},session:ClientSession){
 const business=await Business.findOne({_id:order.businessId,isActive:true}).select("name currency smsEnabled discountSmsNumbers").session(session).lean();
 if(!business?.smsEnabled)return;
 const numbers=[...new Set((business.discountSmsNumbers??[]).map((phone:string)=>normalizeSmsPhone(phone)).filter(Boolean) as string[])].slice(0,MAX_DISCOUNT_SMS_NUMBERS);
 const body=discountSmsBody({businessName:business.name,currency:business.currency,orderNumber:order.orderNumber,...values});
 for(const [index,to] of numbers.entries()){
  const type=`DISCOUNT_ALERT_${index+1}`;
  await SmsMessage.updateOne({_id:`${order.businessId}:${order._id}:${type}`},{$setOnInsert:{businessId:order.businessId,orderId:order._id,orderNumber:order.orderNumber,messageType:type,to,body,includeOptOut:false,evidenceReference:"owner-discount-alert",status:"PENDING"}},{upsert:true,session});
 }
}
