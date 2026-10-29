import "server-only";
import type { ClientSession } from "mongoose";
import type { DeliverySmsType } from "@/lib/sms-template";
import { queueOrderSms,type SmsOrder } from "@/lib/order-sms";
export async function queueDeliverySms(order:SmsOrder,type:DeliverySmsType,occurredAt:Date,session:ClientSession){
 return queueOrderSms(order,type,occurredAt,session);
}
