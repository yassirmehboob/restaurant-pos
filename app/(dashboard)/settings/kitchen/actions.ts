"use server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/data/auth";
import { Business } from "@/models/Business";
import { kitchenTimingSchema } from "@/lib/validation/kitchen-timing";
import { writeAuditLog } from "@/lib/audit";
export async function saveKitchenTiming(input:unknown){const owner=await requireOwner(),parsed=kitchenTimingSchema.safeParse(input);if(!parsed.success)return {ok:false as const,message:"Use whole seconds (1-3600) and whole minutes (1-1440)."};const values=parsed.data;await Business.updateOne({_id:owner.businessId,isActive:true},{$set:{kitchenTimingUpdatedBy:owner.id,kitchenTimingEnabled:values.enabled,kitchenPreparingDelaySeconds:values.preparingSeconds,kitchenReadyDelayMinutes:values.readyMinutes}});await writeAuditLog({businessId:owner.businessId,userId:owner.id,userName:owner.fullName,action:"UPDATE_KITCHEN_TIMING",entityType:"Business",entityId:owner.businessId,description:"Updated optional automatic kitchen status timing",metadata:values});revalidatePath("/settings/kitchen");revalidatePath("/kitchen");return {ok:true as const,message:"Kitchen timing settings saved."};}
