import { getCurrentUser } from "@/data/auth";
import { can } from "@/lib/permissions";
import { qzSign } from "@/lib/qz-signing";

// QZ Tray asks the site to sign each request; only signed-in printing users get signatures.
export async function POST(request:Request){
  const user=await getCurrentUser();
  if(!user||!can(user,"printing"))return new Response("",{status:403});
  const message=await request.text();
  if(!message||message.length>10000)return new Response("",{status:400});
  try{return new Response(qzSign(message),{headers:{"Content-Type":"text/plain","Cache-Control":"private, no-store"}})}
  catch{return new Response("",{status:500})}
}
