import { getCurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { can } from "@/lib/permissions";
import { readStaffPhoto } from "@/lib/staff-photos";
import { Staff } from "@/models/Staff";
export async function GET(_request:Request,context:RouteContext<"/api/staff-photos/[id]">){
 const user=await getCurrentUser();if(!user)return new Response("Unauthorized",{status:401});
 if(!can(user,"staff"))return new Response("Access denied",{status:403});
 const{id}=await context.params;if(!/^[a-f\d]{24}$/i.test(id))return new Response("Not found",{status:404});
 await connectToDatabase();const row=await Staff.findOne({_id:id,businessId:user.businessId},{photoPath:1}).lean<{photoPath?:string}>();
 if(!row?.photoPath)return new Response("Not found",{status:404});
 try{
  const{buffer,contentType}=await readStaffPhoto(row.photoPath);
  return new Response(new Uint8Array(buffer),{headers:{"Content-Type":contentType,"Content-Length":String(buffer.length),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'"}});
 }catch{return new Response("Photo unavailable",{status:404})}
}
