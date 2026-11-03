export const DEFAULT_PAYMENT_SMS="Hi {{customer_name}}, thank you for visiting {{business_name}}. Payment of {{currency}} {{amount_paid}} received for order {{order_number}}.";
export const DELIVERY_SMS_STAGES=[
 {key:"placed",type:"DELIVERY_PLACED",label:"Order placed",description:"Sent when a delivery order is saved and sent to the kitchen.",template:"Hi {{customer_name}}, your delivery order {{order_number}} at {{business_name}} has been placed. Total: {{currency}} {{order_total}}. Delivery to {{delivery_address}}."},
 {key:"outForDelivery",type:"DELIVERY_OUT_FOR_DELIVERY",label:"Out for delivery",description:"Sent when staff mark the order as out for delivery.",template:"Hi {{customer_name}}, your order {{order_number}} from {{business_name}} is out for delivery to {{delivery_address}}."},
 {key:"delivered",type:"DELIVERY_DELIVERED",label:"Delivered",description:"Sent when staff confirm the order has been delivered.",template:"Hi {{customer_name}}, your order {{order_number}} from {{business_name}} has been delivered. Thank you for ordering with us!"},
] as const;
export const ORDER_SMS_STAGES=[
 {key:"placed",type:"ORDER_PLACED",label:"Order placed",description:"Sent when a dine-in or takeaway order is sent to the kitchen.",template:"Hi {{customer_name}}, your order {{order_number}} at {{business_name}} has been placed. Total: {{currency}} {{order_total}}."},
 {key:"preparing",type:"ORDER_PREPARING",label:"Preparing",description:"Sent when the kitchen starts preparing the order, by hand or by the kitchen timer.",template:"Hi {{customer_name}}, the kitchen at {{business_name}} is now preparing your order {{order_number}}."},
 {key:"ready",type:"ORDER_READY",label:"Order ready",description:"Sent when the kitchen marks the order ready, by hand or by the kitchen timer.",template:"Hi {{customer_name}}, your order {{order_number}} at {{business_name}} is ready. Thank you!"},
 {key:"served",type:"ORDER_SERVED",label:"Served",description:"Sent when staff mark a dine-in order served, or a takeaway order handed over.",template:"Hi {{customer_name}}, your order {{order_number}} has been served. Enjoy your meal at {{business_name}}!"},
 {key:"completed",type:"ORDER_COMPLETED",label:"Completed",description:"Sent when the order is closed after payment.",template:"Hi {{customer_name}}, your order {{order_number}} at {{business_name}} is complete. Thank you for visiting!"},
] as const;
export type OrderSmsStage=(typeof ORDER_SMS_STAGES)[number]["key"];
export type OrderSmsSettings=Record<OrderSmsStage,{enabled:boolean;includeOptOut:boolean;template:string;dineIn:boolean;takeaway:boolean}>;
export type DeliverySmsStage=(typeof DELIVERY_SMS_STAGES)[number]["key"];
export type DeliverySmsType=(typeof DELIVERY_SMS_STAGES)[number]["type"];
export type DeliverySmsSettings=Record<DeliverySmsStage,{enabled:boolean;includeOptOut:boolean;template:string}>;
export const SMS_FIELDS=[
 ["customer_name","Customer name"],["business_name","Restaurant name"],["order_number","Order number"],
 ["currency","Currency"],["amount_paid","Amount paid"],["order_total","Order total"],
 ["payment_method","Payment method"],["paid_at","Payment date & time"],["customer_phone","Customer phone"],["table_name","Table name"],
 ["delivery_address","Delivery address"],["delivery_area","Delivery area"],["delivery_charge","Delivery charge"],["delivery_status","Delivery status"],["event_at","Update date & time"],["business_phone","Restaurant phone"],
] as const;
export type SmsField=(typeof SMS_FIELDS)[number][0];
export type SmsValues=Record<SmsField,string>;
export function smsTemplateError(template:string):string|null{
 if(!template.trim())return "Write a message.";
 if(template.length>1000)return "Keep the template within 1,000 characters.";
 const supported=new Set<string>(SMS_FIELDS.map(([key])=>key));
 for(const match of template.matchAll(/\{\{([a-z_]+)\}\}/g))if(!supported.has(match[1]))return `Unknown field: {{${match[1]}}}.`;
 if(/[{}]/.test(template.replace(/\{\{([a-z_]+)\}\}/g,"")))return "Use the field buttons to insert valid {{field_name}} placeholders.";
 return null;
}
export function renderPaymentSms(template:string,values:SmsValues):string{
 const error=smsTemplateError(template);if(error)throw new Error(error);
 const body=template.replace(/\{\{([a-z_]+)\}\}/g,(_,key:SmsField)=>values[key]).trim();
 if(!body||body.length>1600)throw new Error("The completed message must be between 1 and 1,600 characters.");
 return body;
}
// Shared with the kitchen timer worker, which cannot load TypeScript.
export { normalizeSmsPhone } from "@/lib/order-stage-sms.mjs";
