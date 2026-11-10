import mongoose from "mongoose";
import { getCurrentUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { MAX_IMAGE_BYTES, validateImageBytes } from "@/lib/image-upload";
import { Business } from "@/models/Business";

// The app icon (browser tab, home-screen shortcut, installed app) is the business logo.
// Signed in: the user's own business. Signed out (login page, installed-app launch): the business when this server
// runs only one, so a multi-restaurant server never shows one restaurant's logo to another's staff.
export async function appIconBusiness(){
  await connectToDatabase();
  const user=await getCurrentUser().catch(()=>null);
  if(user)return{_id:user.businessId,name:user.businessName,logoUrl:user.businessLogoUrl};
  const only=await Business.find({isActive:true}).select("name logoUrl").limit(2).lean();
  return only.length===1?only[0]:null;
}

// The logo's GridFS id, from its stored "/api/images/<id>" URL.
export function logoImageId(logoUrl?:string|null){return /^\/api\/images\/([a-f\d]{24})$/i.exec(logoUrl??"")?.[1]??null}

export async function logoBytes(businessId:string,logoUrl?:string|null){
  const id=logoImageId(logoUrl);const db=mongoose.connection.db;if(!id||!db)return null;
  const bucket=new mongoose.mongo.GridFSBucket(db,{bucketName:"images"}),objectId=new mongoose.Types.ObjectId(id);
  const[file]=await bucket.find({_id:objectId,"metadata.businessId":businessId}).limit(1).toArray();
  if(!file||file.length>MAX_IMAGE_BYTES)return null;
  const chunks:Buffer[]=[];
  try{
    await new Promise<void>((resolve,reject)=>bucket.openDownloadStream(objectId).on("data",(chunk:Buffer)=>chunks.push(chunk)).on("end",resolve).on("error",reject));
    const buffer=Buffer.concat(chunks);
    return{buffer,contentType:validateImageBytes(buffer,String(file.metadata?.contentType??""))};
  }catch{return null}
}
