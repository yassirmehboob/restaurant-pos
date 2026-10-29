"use server";
import { requireOwner } from "@/data/auth";
import { Business } from "@/models/Business";
import { writeAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { z } from "zod";
export async function saveWaiterVisibility(value:boolean){
 const user=await requireOwner();const show=z.boolean().parse(value);
 await Business.updateOne({_id:user.businessId,isActive:true},{$set:{waiterShowBillSummary:show}});
 await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_WAITER_SETTINGS",entityType:"Business",entityId:user.businessId,description:`${show?"Enabled":"Disabled"} bill amounts on waiter screens`});
 revalidatePath("/settings/business");revalidatePath("/waiter");
}
