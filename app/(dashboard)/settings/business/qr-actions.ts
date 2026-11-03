"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner,requireUser } from "@/data/auth";
import { writeAuditLog } from "@/lib/audit";
import { connectToDatabase } from "@/lib/db";
import { newQrToken } from "@/lib/qr-menu";
import { orderIdSchema } from "@/lib/validation/order";
import { Business } from "@/models/Business";
import { RestaurantTable } from "@/models/RestaurantTable";

// The address printed in every QR code. Blank means "the address this page was opened on".
const baseUrl=z.string().trim().max(200).refine(value=>{if(!value)return true;try{const url=new URL(value);return["http:","https:"].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash}catch{return false}},"Enter a full web address such as https://order.myrestaurant.pk or http://192.168.1.10:3000.");
const qrSettingsSchema=z.object({enabled:z.boolean(),showSummary:z.boolean(),verifyPhone:z.boolean().default(false),baseUrl});

export async function saveQrOrderingSettings(raw:unknown){
 const user=await requireOwner(),parsed=qrSettingsSchema.safeParse(raw);
 if(!parsed.success)return{ok:false as const,message:parsed.error.issues[0]?.message??"Check the QR ordering settings."};
 const{enabled,showSummary,verifyPhone}=parsed.data,url=parsed.data.baseUrl.replace(/\/+$/,"");
 await connectToDatabase();
 // The codes are sent by SMS, so the check cannot be switched on before texting works.
 if(verifyPhone&&(!process.env.SMS_API||!await Business.exists({_id:user.businessId,isActive:true,smsEnabled:true})))return{ok:false as const,message:"Turn on SMS messaging first. Phone codes are sent by SMS."};
 const values={qrOrderingEnabled:enabled,qrShowBillSummary:showSummary,qrPhoneVerification:verifyPhone};
 await Business.updateOne({_id:user.businessId,isActive:true},url?{$set:{...values,qrMenuBaseUrl:url}}:{$set:values,$unset:{qrMenuBaseUrl:1}});
 await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_QR_ORDERING_SETTINGS",entityType:"Business",entityId:user.businessId,description:`${enabled?"Enabled":"Disabled"} QR table ordering; bill summary ${showSummary?"shown":"hidden"} to guests; SMS phone code ${verifyPhone?"required":"not required"}`,metadata:{enabled,showSummary,verifyPhone,baseUrl:url||null}});
 revalidatePath("/settings/business");revalidatePath("/tables");
 return{ok:true as const,message:"QR ordering settings saved.",baseUrl:url};
}

// A new code retires the old printed one (e.g. a photo of it was shared outside the restaurant).
export async function regenerateTableQr(id:string){
 const user=await requireUser();
 if(!["OWNER","ADMIN"].includes(user.role))return{ok:false as const,message:"Only the owner or an admin can change table QR codes."};
 if(!orderIdSchema.safeParse(id).success)return{ok:false as const,message:"Invalid table."};
 await connectToDatabase();
 const table=await RestaurantTable.findOneAndUpdate({_id:id,businessId:user.businessId},{$set:{qrToken:newQrToken()}},{returnDocument:"after"});
 if(!table)return{ok:false as const,message:"Table not found."};
 await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"REGENERATE_TABLE_QR",entityType:"RestaurantTable",entityId:id,description:`Issued a new QR code for ${table.name}; the old printed code no longer works`});
 revalidatePath("/tables");
 return{ok:true as const};
}
