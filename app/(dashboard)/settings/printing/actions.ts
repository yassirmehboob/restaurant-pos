"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MasterState } from "@/app/(dashboard)/master-actions";
import { requireUser } from "@/data/auth";
import { writeAuditLog } from "@/lib/audit";
import { connectToDatabase } from "@/lib/db";
import { hasRole } from "@/lib/roles";
import { Business } from "@/models/Business";
const schema=z.object({receiptPaperWidth:z.enum(["58","80"]),receiptHeader:z.string().trim().max(200).optional(),receiptFooter:z.string().trim().max(300).optional(),showLogoOnCustomerReceipt:z.enum(["YES","NO"]),showPricesOnKitchenReceipt:z.enum(["YES","NO"]),printerMode:z.enum(["BROWSER","QZ"]),onePrinterMode:z.enum(["YES","NO"]),customerPrinterName:z.string().trim().max(150).optional(),kitchenPrinterName:z.string().trim().max(150).optional(),customerPrintingEnabled:z.enum(["YES","NO"]),kitchenPrintingEnabled:z.enum(["YES","NO"]),customerReceiptCopies:z.coerce.number().int().min(1).max(5),kitchenReceiptCopies:z.coerce.number().int().min(1).max(5)});
export async function updatePrintingSettings(_state:MasterState,data:FormData):Promise<MasterState>{const user=await requireUser();if(!hasRole(user.role,["OWNER","ADMIN"]))return{message:"You do not have permission to change printing settings."};const parsed=schema.safeParse(Object.fromEntries(data));if(!parsed.success)return{errors:parsed.error.flatten().fieldErrors};await connectToDatabase();const values={...parsed.data,showLogoOnCustomerReceipt:parsed.data.showLogoOnCustomerReceipt==="YES",showPricesOnKitchenReceipt:parsed.data.showPricesOnKitchenReceipt==="YES",onePrinterMode:parsed.data.onePrinterMode==="YES",customerPrintingEnabled:parsed.data.customerPrintingEnabled==="YES",kitchenPrintingEnabled:parsed.data.kitchenPrintingEnabled==="YES"};await Business.updateOne({_id:user.businessId,isActive:true},{$set:values});await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_PRINT_SETTINGS",entityType:"Business",entityId:user.businessId,description:"Updated receipt and printer routing settings"});revalidatePath("/settings/printing");return{ok:true,message:"Printing settings updated."}}
