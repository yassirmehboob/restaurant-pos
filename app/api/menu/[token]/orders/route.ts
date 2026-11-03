import { submitGuestOrder } from "@/lib/qr-menu";

// Public: a guest's phone sends the order here. The table comes from the token, never from the body.
export async function POST(request:Request,context:{params:Promise<{token:string}>}){
 const{token}=await context.params;
 let body:unknown;
 try{body=await request.json()}catch{return Response.json({ok:false,code:"INVALID"},{status:400})}
 const address=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||request.headers.get("x-real-ip")||"unknown";
 const result=await submitGuestOrder(token,body,address.slice(0,64));
 const status=result.ok?200:result.code==="INVALID"?404:result.code==="BUSY"||result.code==="LIMIT"?429:result.code==="ERROR"?500:400;
 return Response.json(result,{status,headers:{"Cache-Control":"no-store"}});
}
