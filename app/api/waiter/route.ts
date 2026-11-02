import { getCurrentUser } from "@/data/auth";
import { waiterWorkspace } from "@/data/waiter";
import { can } from "@/lib/permissions";
import { COUNTER_ROLES } from "@/lib/roles";
export async function GET(){
 const user=await getCurrentUser();
 if(!user)return Response.json({message:"Please sign in again."},{status:401});
 if(user.role!=="WAITER"&&(!COUNTER_ROLES.includes(user.role)||!can(user,"pos")))return Response.json({message:"Access denied."},{status:403});
 return Response.json(await waiterWorkspace(),{headers:{"Cache-Control":"private, no-store"}});
}
