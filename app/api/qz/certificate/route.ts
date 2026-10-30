import { getCurrentUser } from "@/data/auth";
import { qzCertificate } from "@/lib/qz-signing";

export async function GET(){
  if(!await getCurrentUser())return new Response("",{status:401});
  return new Response(qzCertificate(),{headers:{"Content-Type":"text/plain","Cache-Control":"private, no-store"}});
}
