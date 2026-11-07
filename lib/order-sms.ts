import "server-only";
import type { ClientSession } from "mongoose";
import { Business } from "@/models/Business";
import { SmsMessage } from "@/models/SmsMessage";
import { Payment } from "@/models/Payment";
import { DEFAULT_PAYMENT_SMS,DELIVERY_SMS_STAGES,normalizeSmsPhone,renderPaymentSms,type DeliverySmsType } from "@/lib/sms-template";

export type SmsOrder={_id:unknown;businessId:unknown;orderNumber:string;orderType?:string;status?:string;deliveryStatus?:string;paymentStatus:string;grandTotal:number;paidAmount:number;deliveryChargeAmount?:number;customerSnapshot?:{name?:string;phone?:string;address?:string;area?:string};tableNameSnapshot?:string;taxPaymentMethod?:string};
export async function queueOrderSms(order:SmsOrder,type:"PAYMENT_RECEIPT"|DeliverySmsType,occurredAt:Date,session:ClientSession){
 const stage=DELIVERY_SMS_STAGES.find(stage=>stage.type===type);
 if(type==="PAYMENT_RECEIPT"&&order.paymentStatus!=="PAID")return;
 if(stage&&(order.orderType!=="DELIVERY"||order.status==="CANCELLED"))return;
 const business=await Business.findOne({_id:order.businessId,isActive:true}).select("name phone currency timezone smsEnabled smsPaymentReceiptEnabled smsIncludeOptOut smsPaymentTemplate smsEvidenceReference smsDeliveryMessages").session(session).lean();
 if(!business?.smsEnabled)return;
 const config=stage?business.smsDeliveryMessages?.[stage.key]:{enabled:business.smsPaymentReceiptEnabled,includeOptOut:business.smsIncludeOptOut,template:business.smsPaymentTemplate};
 if(!config?.enabled)return;
 const to=normalizeSmsPhone(order.customerSnapshot?.phone??"");let body="",failureCode:string|undefined;
 if(!to)failureCode="NO_VALID_CUSTOMER_PHONE";
 else try{
  const date=(value:Date)=>new Intl.DateTimeFormat("en-GB",{timeZone:business.timezone||"Asia/Karachi",dateStyle:"short",timeStyle:"short",hour12:true}).format(value);
  const payment=stage&&order.paymentStatus==="PAID"?await Payment.findOne({businessId:order.businessId,orderId:order._id,reversal:null}).select("paidAt").sort({paidAt:-1}).session(session).lean():null;
  body=renderPaymentSms(config.template||(stage?.template??DEFAULT_PAYMENT_SMS),{
   customer_name:order.customerSnapshot?.name||"Customer",business_name:business.name,business_phone:business.phone||"",order_number:order.orderNumber,currency:business.currency||"PKR",
   amount_paid:order.paidAmount.toFixed(2),order_total:order.grandTotal.toFixed(2),payment_method:order.taxPaymentMethod||"CASH",customer_phone:to,table_name:order.tableNameSnapshot||"Not applicable",
   paid_at:type==="PAYMENT_RECEIPT"?date(occurredAt):payment?.paidAt?date(payment.paidAt):"Not paid",event_at:date(occurredAt),
   delivery_address:order.customerSnapshot?.address||"Not applicable",delivery_area:order.customerSnapshot?.area||"",delivery_charge:(order.deliveryChargeAmount??0).toFixed(2),delivery_status:stage?.label??(order.deliveryStatus??"Not applicable").replaceAll("_"," ").toLowerCase(),
  });
 }catch{failureCode="INVALID_MESSAGE_TEMPLATE"}
 await SmsMessage.updateOne({_id:`${order.businessId}:${order._id}:${type}`},{$setOnInsert:{businessId:order.businessId,orderId:order._id,orderNumber:order.orderNumber,messageType:type,to:to??"",body,includeOptOut:config.includeOptOut!==false,evidenceReference:business.smsEvidenceReference||"customer-acknowledgement",status:failureCode?"SKIPPED":"PENDING",...(failureCode?{failureCode,finishedAt:new Date()}:{})}},{upsert:true,session});
}
