import { z } from "zod";
import { smsTemplateError } from "@/lib/sms-template";
export const smsSettingsSchema=z.object({
 enabled:z.boolean(),paymentReceiptEnabled:z.boolean(),includeOptOut:z.boolean().default(true),
 token:z.string().trim().max(4096).refine(value=>!/[\r\n]/.test(value),"The token must be on one line.").refine(value=>!/^Bearer\s/i.test(value),"Paste the token only, without the Bearer prefix."),
 removeToken:z.boolean().default(false),
 template:z.string().trim().max(1000).superRefine((value,ctx)=>{const error=smsTemplateError(value);if(error)ctx.addIssue({code:"custom",message:error})}),
 evidenceReference:z.string().trim().min(1,"Enter the acknowledgement reference.").max(200),
}).superRefine((value,ctx)=>{if(value.removeToken&&value.token)ctx.addIssue({code:"custom",path:["token"],message:"Choose either replacing or removing the token."});if(value.removeToken&&value.enabled)ctx.addIssue({code:"custom",path:["enabled"],message:"Turn SMS off before removing its token."})});
const deliveryMessageSchema=z.object({enabled:z.boolean(),includeOptOut:z.boolean(),template:z.string().trim().max(1000).superRefine((value,ctx)=>{const error=smsTemplateError(value);if(error)ctx.addIssue({code:"custom",message:error})})});
const orderMessageSchema=deliveryMessageSchema.extend({dineIn:z.boolean(),takeaway:z.boolean()}).refine(value=>!value.enabled||value.dineIn||value.takeaway,{message:"Choose dine-in, takeaway or both for each enabled message.",path:["dineIn"]});
export const orderSmsSettingsSchema=z.object({placed:orderMessageSchema,ready:orderMessageSchema});
export const deliverySmsSettingsSchema=z.object({placed:deliveryMessageSchema,outForDelivery:deliveryMessageSchema,delivered:deliveryMessageSchema});
