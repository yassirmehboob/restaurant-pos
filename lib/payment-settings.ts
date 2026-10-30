import { Business } from "@/models/Business";
// Owners can turn off prefilling so cashiers must type the cash they actually received.
export async function paymentPrefillDue(businessId:string){const business=await Business.findOne({_id:businessId,isActive:true}).select("paymentPrefillDueAmount").lean();return business?.paymentPrefillDueAmount!==false}
