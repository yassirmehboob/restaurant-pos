import mongoose from "mongoose";
import { MAX_IMAGE_BYTES,validateImageBytes } from "@/lib/image-upload";
import { resolveQrTable } from "@/lib/qr-menu";

// Public menu photos: only images belonging to the business behind this table's QR token.
export async function GET(_request:Request,context:{params:Promise<{token:string;id:string}>}){
 const{token,id}=await context.params;if(!/^[a-f\d]{24}$/i.test(id))return new Response("Not found",{status:404});
 const table=await resolveQrTable(token);if(!table)return new Response("Not found",{status:404});
 const db=mongoose.connection.db;if(!db)return new Response("Database unavailable",{status:503});
 const bucket=new mongoose.mongo.GridFSBucket(db,{bucketName:"images"}),objectId=new mongoose.Types.ObjectId(id);
 const file=(await bucket.find({_id:objectId,"metadata.businessId":table.business.id}).limit(1).toArray())[0];
 if(!file)return new Response("Not found",{status:404});
 if(file.length>MAX_IMAGE_BYTES)return new Response("Image too large",{status:413});
 const chunks:Buffer[]=[];
 try{
  await new Promise<void>((resolve,reject)=>bucket.openDownloadStream(objectId).on("data",(chunk:Buffer)=>chunks.push(chunk)).on("end",resolve).on("error",reject));
  const buffer=Buffer.concat(chunks),contentType=validateImageBytes(buffer,String(file.metadata?.contentType??""));
  return new Response(buffer,{headers:{"Content-Type":contentType,"Content-Length":String(buffer.length),"Cache-Control":"public, max-age=3600","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'"}});
 }catch{return new Response("Image unavailable",{status:404})}
}
