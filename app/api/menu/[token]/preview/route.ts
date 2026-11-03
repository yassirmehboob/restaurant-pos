import { previewGuestOrder } from "@/lib/qr-menu";

// Public: live bill summary for the guest's cart, priced on the server like the final order.
export async function POST(request:Request,context:{params:Promise<{token:string}>}){
 const{token}=await context.params;
 let body:unknown;
 try{body=await request.json()}catch{return Response.json({ok:false},{status:400})}
 const address=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||request.headers.get("x-real-ip")||"unknown";
 const result=await previewGuestOrder(token,body,address.slice(0,64));
 return Response.json(result,{status:result?200:404,headers:{"Cache-Control":"no-store"}});
}
