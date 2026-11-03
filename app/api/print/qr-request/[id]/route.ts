import { getCurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { can } from "@/lib/permissions";
import { COUNTER_ROLES } from "@/lib/roles";
import { buildQrSlipJob } from "@/lib/receipt-print";

// ESC/POS slip for a pending QR order, for QZ Tray.
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();
  if(!user)return Response.json({message:"Please sign in again."},{status:401});
  if(!COUNTER_ROLES.includes(user.role)||!can(user,"pos"))return Response.json({message:"You cannot print QR order slips."},{status:403});
  const{id}=await context.params;
  await connectToDatabase();
  const job=await buildQrSlipJob(user.businessId,id);
  if("error" in job)return Response.json({message:job.error},{status:404});
  return Response.json(job,{headers:{"Cache-Control":"private, no-store"}});
}
