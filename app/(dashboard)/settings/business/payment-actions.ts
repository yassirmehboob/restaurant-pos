"use server";
import { requireOwner } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { writeAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { z } from "zod";
export async function savePaymentPrefill(value:boolean){
 const user=await requireOwner();const prefill=z.boolean().parse(value);
 await connectToDatabase();
 await Business.updateOne({_id:user.businessId,isActive:true},{$set:{paymentPrefillDueAmount:prefill}});
 await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_PAYMENT_SETTINGS",entityType:"Business",entityId:user.businessId,description:`${prefill?"Enabled":"Disabled"} prefilled due amount when receiving cash payments`});
 revalidatePath("/settings/business");
}
