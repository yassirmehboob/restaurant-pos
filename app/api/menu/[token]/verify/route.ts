import { checkQrPhoneCode,sendQrPhoneCode } from "@/lib/qr-phone-verification";

// Public: texts a code to the guest's number ({phone}), or checks the code they typed ({phone,code}).
export async function POST(request:Request,context:{params:Promise<{token:string}>}){
 const{token}=await context.params;
 let body:unknown;
 try{body=await request.json()}catch{return Response.json({ok:false,code:"INVALID"},{status:400})}
 const address=(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||request.headers.get("x-real-ip")||"unknown").slice(0,64);
 const result=(body as {code?:unknown})?.code===undefined?await sendQrPhoneCode(token,body,address):await checkQrPhoneCode(token,body,address);
 const status=result.ok?200:result.code==="INVALID"?404:result.code==="BUSY"?429:result.code==="ERROR"?500:400;
 return Response.json(result,{status,headers:{"Cache-Control":"no-store"}});
}
