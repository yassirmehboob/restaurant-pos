import { guestOrderStatus } from "@/lib/qr-menu";

// Public: the guest's phone polls its own order using the key it created when ordering.
export async function GET(request:Request,context:{params:Promise<{token:string;id:string}>}){
 const{token,id}=await context.params,key=new URL(request.url).searchParams.get("key")??"";
 const status=await guestOrderStatus(token,id,key);
 if(!status)return Response.json({message:"Order not found."},{status:404,headers:{"Cache-Control":"no-store"}});
 return Response.json(status,{headers:{"Cache-Control":"no-store"}});
}
