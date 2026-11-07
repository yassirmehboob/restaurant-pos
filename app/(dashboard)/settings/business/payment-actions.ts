"use server";
import { requireOwner,requirePermission } from "@/data/auth";
import { uploadImage } from "@/lib/uploads";
import { PAYMENT_QR_SHOW_ON } from "@/lib/receipt-layout";
import type { MasterState } from "@/app/(dashboard)/master-actions";
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

// Payment QR code printed on customer receipts (lib/receipt-layout.ts): the image, its caption, and which bills carry it.
const paymentQrSchema=z.object({showOn:z.enum(PAYMENT_QR_SHOW_ON),caption:z.string().trim().max(80,"Keep the caption under 80 characters.").default(""),remove:z.enum(["YES","NO"]).default("NO")});
// url: the saved image after this save, so the form shows what will print (null once removed).
export type PaymentQrState=NonNullable<MasterState>&{url?:string|null};
export async function savePaymentQr(_state:PaymentQrState|undefined,data:FormData):Promise<PaymentQrState>{
 const user=await requirePermission("settings");
 const parsed=paymentQrSchema.safeParse({showOn:data.get("showOn"),caption:data.get("caption")??undefined,remove:data.get("remove")??undefined});
 if(!parsed.success)return{errors:parsed.error.flatten().fieldErrors};
 await connectToDatabase();
 try{
  const uploaded=await uploadImage(data.get("paymentQr") as File|undefined,`business-${user.businessId}/branding`);
  const{showOn,caption,remove}=parsed.data,removing=!uploaded&&remove==="YES";
  const set:Record<string,string>={paymentQrShowOn:showOn,...(caption?{paymentQrCaption:caption}:{}),...(uploaded?{paymentQrUrl:uploaded}:{})};
  const unset:Record<string,1>={...(caption?{}:{paymentQrCaption:1}),...(removing?{paymentQrUrl:1}:{})};
  await Business.updateOne({_id:user.businessId,isActive:true},{$set:set,...(Object.keys(unset).length?{$unset:unset}:{})});
  await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_PAYMENT_QR",entityType:"Business",entityId:user.businessId,description:uploaded?"Uploaded a payment QR code for receipts":removing?"Removed the payment QR code from receipts":"Updated payment QR code receipt settings",metadata:{showOn}});
  revalidatePath("/settings/business");revalidatePath("/settings/printing");
  return{ok:true,message:uploaded?"Payment QR code uploaded.":removing?"Payment QR code removed.":"Payment QR settings saved.",...(uploaded?{url:uploaded}:removing?{url:null}:{})};
 }catch(error){return{message:error instanceof Error?error.message:"Could not save the payment QR code."}}
}
