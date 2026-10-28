import "server-only";
import mongoose from "mongoose";import { connectToDatabase } from "@/lib/db";
import { MAX_IMAGE_BYTES, validateImageBytes } from "@/lib/image-upload";
function uploadScope(scope:string){const match=/^business-([a-f\d]{24})\/(products|deals|branding)$/i.exec(scope);if(!match)throw new Error("Invalid image storage scope.");return{businessId:match[1],kind:match[2]}}
export async function uploadImage(file:File|undefined,scope:string){
  if(!file)return undefined;
  if(!(file instanceof File))throw new Error("Select an image file.");
  if(file.size===0)return undefined;
  if(file.size>MAX_IMAGE_BYTES)throw new Error("Image must be 5 MB or smaller.");
  const buffer=Buffer.from(await file.arrayBuffer()),contentType=validateImageBytes(buffer,file.type);
  const{businessId,kind}=uploadScope(scope);await connectToDatabase();const db=mongoose.connection.db;
  if(!db)throw new Error("Database is not available.");
  const bucket=new mongoose.mongo.GridFSBucket(db,{bucketName:"images"});
  const stream=bucket.openUploadStream((file.name||`${kind}-image`).slice(0,200),{metadata:{businessId,kind,size:buffer.length,contentType}});
  await new Promise<void>((resolve,reject)=>{stream.on("finish",resolve);stream.on("error",reject);stream.end(buffer)});
  return`/api/images/${stream.id.toString()}`;
}
