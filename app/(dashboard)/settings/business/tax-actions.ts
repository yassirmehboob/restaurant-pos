"use server";
import { requireOwner } from "@/data/auth";
import { Business } from "@/models/Business";
import { businessTaxSchema } from "@/lib/validation/tax";
import { writeAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";
export async function saveBusinessTax(input:unknown){const owner=await requireOwner(),parsed=businessTaxSchema.safeParse(input);if(!parsed.success)return {ok:false as const,message:"Tax percentages must be numbers from 0 to 100."};const before=await Business.findOneAndUpdate({_id:owner.businessId,isActive:true},{$set:{saleTaxRate:parsed.data.rate,paymentTaxRates:parsed.data.overrides}},{returnDocument:"before"});if(!before)return {ok:false as const,message:"Business unavailable."};await writeAuditLog({businessId:owner.businessId,userId:owner.id,userName:owner.fullName,action:"UPDATE_TAX_SETTINGS",entityType:"Business",entityId:owner.businessId,description:"Updated business and payment-method tax percentages",metadata:{before:{rate:before.saleTaxRate,overrides:before.paymentTaxRates},after:parsed.data}});revalidatePath("/settings/business");revalidatePath("/pos");return {ok:true as const,message:"Tax settings saved. These rates apply to new invoices."};}
