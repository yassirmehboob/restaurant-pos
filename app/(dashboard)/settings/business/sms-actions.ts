"use server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/data/auth";
import { Business } from "@/models/Business";
import { smsSettingsSchema,deliverySmsSettingsSchema,orderSmsSettingsSchema } from "@/lib/validation/sms";
import { encryptSmsToken } from "@/lib/sms-crypto.mjs";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";

export async function saveSmsSettings(raw:unknown){
 const user=await requireOwner();const parsed=smsSettingsSchema.safeParse(raw);
 if(!parsed.success)return{ok:false as const,message:parsed.error.issues[0]?.message??"Check the SMS settings."};
 const values=parsed.data;
 const hasToken=!!await Business.exists({_id:user.businessId,isActive:true,smsTokenEncrypted:{$type:"string",$ne:""}});
 if(values.enabled&&!process.env.SMS_API)return{ok:false as const,message:"The SMS gateway is not configured on this server."};
 if(values.enabled){try{const url=new URL(process.env.SMS_API!);if(!["https:","http:"].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error()}catch{return{ok:false as const,message:"The SMS gateway configuration is invalid. Check SMS_API on the server."}}}
 if(values.enabled&&!values.token&&!hasToken)return{ok:false as const,message:"Add your business subscription token before enabling SMS."};
 try{
  const encrypted=values.token?encryptSmsToken(values.token,env().AUTH_SECRET,user.businessId):undefined;
  const update={smsEnabled:values.enabled,smsPaymentReceiptEnabled:values.paymentReceiptEnabled,smsIncludeOptOut:values.includeOptOut,smsPaymentTemplate:values.template,smsEvidenceReference:values.evidenceReference,...(encrypted?{smsTokenEncrypted:encrypted}:{})};
  const result=await Business.updateOne({_id:user.businessId,isActive:true},{$set:update,...(values.removeToken?{$unset:{smsTokenEncrypted:1}}:{})});
  if(!result.matchedCount)return{ok:false as const,message:"Business not found."};
  await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_SMS_SETTINGS",entityType:"Business",entityId:user.businessId,description:"Updated SMS subscription and payment message settings",metadata:{enabled:values.enabled,paymentReceiptEnabled:values.paymentReceiptEnabled,includeOptOut:values.includeOptOut,tokenChanged:Boolean(values.token||values.removeToken)}});
  revalidatePath("/settings/sms-messaging");
  return{ok:true as const,message:"SMS settings saved.",hasToken:!values.removeToken&&(hasToken||!!values.token)};
 }catch{return{ok:false as const,message:"Could not save SMS settings. Please try again."}}
}

export async function saveDeliverySmsSettings(raw:unknown){
 const user=await requireOwner(),parsed=deliverySmsSettingsSchema.safeParse(raw);
 if(!parsed.success)return{ok:false as const,message:parsed.error.issues[0]?.message??"Check each delivery message."};
 try{
  const result=await Business.updateOne({_id:user.businessId,isActive:true},{$set:{smsDeliveryMessages:parsed.data}});
  if(!result.matchedCount)return{ok:false as const,message:"Business not found."};
  await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_DELIVERY_SMS_SETTINGS",entityType:"Business",entityId:user.businessId,description:"Updated delivery SMS templates and sending preferences",metadata:{placedEnabled:parsed.data.placed.enabled,outForDeliveryEnabled:parsed.data.outForDelivery.enabled,deliveredEnabled:parsed.data.delivered.enabled}});
  revalidatePath("/settings/sms-messaging");return{ok:true as const,message:"Delivery SMS settings saved."};
 }catch{return{ok:false as const,message:"Could not save delivery SMS settings. Please try again."}}
}

export async function saveOrderSmsSettings(raw:unknown){
 const user=await requireOwner(),parsed=orderSmsSettingsSchema.safeParse(raw);
 if(!parsed.success)return{ok:false as const,message:parsed.error.issues[0]?.message??"Check each order message."};
 try{
  const result=await Business.updateOne({_id:user.businessId,isActive:true},{$set:{smsOrderMessages:parsed.data}});
  if(!result.matchedCount)return{ok:false as const,message:"Business not found."};
  await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_ORDER_SMS_SETTINGS",entityType:"Business",entityId:user.businessId,description:"Updated dine-in and takeaway SMS templates and sending preferences",metadata:Object.fromEntries(Object.entries(parsed.data).map(([key,value])=>[key,{enabled:value.enabled,dineIn:value.dineIn,takeaway:value.takeaway}]))});
  revalidatePath("/settings/sms-messaging");return{ok:true as const,message:"Dine-in and takeaway SMS settings saved."};
 }catch{return{ok:false as const,message:"Could not save dine-in and takeaway SMS settings. Please try again."}}
}
