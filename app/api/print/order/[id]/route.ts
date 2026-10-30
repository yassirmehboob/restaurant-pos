import { getCurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { can } from "@/lib/permissions";
import { buildPrintJob } from "@/lib/receipt-print";

// ESC/POS print job for QZ Tray; the browser sends it to a USB or LAN printer.
export async function GET(request:Request,context:RouteContext<"/api/print/order/[id]">){
  const user=await getCurrentUser();
  if(!user)return Response.json({message:"Please sign in again."},{status:401});
  if(!can(user,"printing"))return Response.json({message:"You do not have permission to print receipts."},{status:403});
  const kind=new URL(request.url).searchParams.get("kind");
  if(kind!=="customer"&&kind!=="kitchen")return Response.json({message:"Unknown receipt type."},{status:400});
  const{id}=await context.params;
  await connectToDatabase();
  const job=await buildPrintJob(user.businessId,id,kind);
  if("error" in job)return Response.json({message:job.error},{status:404});
  return Response.json(job,{headers:{"Cache-Control":"private, no-store"}});
}
