"use server";
import mongoose from "mongoose";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { confirmOwner,findActiveOwner } from "@/lib/auth/owner-confirmation";
import { discountSettingsSchema } from "@/lib/invoice-discount";
import { normalizeSmsPhone } from "@/lib/sms-template";
import { Business } from "@/models/Business";

// Discount settings change what cashiers can take off an invoice, so the owner re-confirms with password (and 2FA).
export async function saveDiscountSettings(input:unknown){
 const owner=await requireOwner(),parsed=discountSettingsSchema.safeParse(input);
 if(!parsed.success)return{ok:false as const,message:parsed.error.issues[0]?.message??"Check the discount settings."};
 await connectToDatabase();
 const account=await findActiveOwner(owner);if(!account)return{ok:false as const,message:"Owner account not found."};
 const failure=await confirmOwner(account,parsed.data.currentPassword,parsed.data.twoFactorCode,"change discount settings");if(failure)return{ok:false as const,message:failure};
 // Existing types keep their ids so reports stay linked; new ones get fresh ids.
 const types=parsed.data.types.map(type=>({_id:type.id?new mongoose.Types.ObjectId(type.id):new mongoose.Types.ObjectId(),name:type.name,mode:type.mode,percent:type.mode==="FIXED"?type.percent:null,capAmount:type.capAmount,remarksRequired:type.remarksRequired}));
 const smsNumbers=[...new Set(parsed.data.smsNumbers.map(phone=>normalizeSmsPhone(phone)!))];
 const before=await Business.findOneAndUpdate({_id:owner.businessId,isActive:true},{$set:{invoiceDiscountEnabled:parsed.data.enabled,couponOnPayment:parsed.data.couponOnPayment,discountTypes:types,discountSmsNumbers:smsNumbers}},{returnDocument:"before"}).lean();
 if(!before)return{ok:false as const,message:"Business not found."};
 await writeAuditLog({businessId:owner.businessId,userId:owner.id,userName:owner.fullName,action:"UPDATE_DISCOUNT_SETTINGS",entityType:"Business",entityId:owner.businessId,description:`${parsed.data.enabled?"Updated":"Turned off"} invoice discounts`,metadata:{enabled:parsed.data.enabled,couponOnPayment:parsed.data.couponOnPayment,types:types.map(type=>({name:type.name,mode:type.mode,percent:type.percent,capAmount:type.capAmount,remarksRequired:type.remarksRequired})),smsNumbers:smsNumbers.length,previousTypes:(before.discountTypes??[]).length}});
 revalidatePath("/settings/discounts");revalidatePath("/pos");revalidatePath("/orders","layout");
 return{ok:true as const,message:"Discount settings saved.",types:types.map(type=>({id:String(type._id),name:type.name,mode:type.mode,percent:type.percent,capAmount:type.capAmount,remarksRequired:type.remarksRequired})),smsNumbers,couponOnPayment:parsed.data.couponOnPayment};
}
