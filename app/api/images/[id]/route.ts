import mongoose from "mongoose";
import { getCurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { MAX_IMAGE_BYTES, validateImageBytes } from "@/lib/image-upload";
export async function GET(_request:Request,context:RouteContext<"/api/images/[id]">){
 const user=await getCurrentUser();if(!user)return new Response("Unauthorized",{status:401});
 const{id}=await context.params;if(!/^[a-f\d]{24}$/i.test(id))return new Response("Not found",{status:404});
 await connectToDatabase();const db=mongoose.connection.db;if(!db)return new Response("Database unavailable",{status:503});
 const bucket=new mongoose.mongo.GridFSBucket(db,{bucketName:"images"}),objectId=new mongoose.Types.ObjectId(id);
 const files=await bucket.find({_id:objectId,"metadata.businessId":user.businessId}).limit(1).toArray();
 const file=files[0];if(!file)return new Response("Not found",{status:404});
 if(file.length>MAX_IMAGE_BYTES)return new Response("Image too large",{status:413});
 const chunks:Buffer[]=[];
 try{
  await new Promise<void>((resolve,reject)=>bucket.openDownloadStream(objectId).on("data",(chunk:Buffer)=>chunks.push(chunk)).on("end",resolve).on("error",reject));
  const buffer=Buffer.concat(chunks),contentType=validateImageBytes(buffer,String(file.metadata?.contentType??""));
  return new Response(buffer,{headers:{"Content-Type":contentType,"Content-Length":String(buffer.length),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'"}});
 }catch{return new Response("Image unavailable",{status:404})}
}
