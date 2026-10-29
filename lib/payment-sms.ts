import "server-only";
import type { ClientSession } from "mongoose";
import { queueOrderSms,type SmsOrder } from "@/lib/order-sms";

// Share the transactional outbox with delivery updates.
export async function queuePaymentSms(order:SmsOrder,paidAt:Date,session:ClientSession){
 return queueOrderSms(order,"PAYMENT_RECEIPT",paidAt,session);
}
