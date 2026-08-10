import "server-only";
import { v2 as cloudinary } from "cloudinary";
const ALLOWED_TYPES=new Set(["image/jpeg","image/png","image/webp"]),MAX_BYTES=5*1024*1024;
export async function uploadImage(file:File|undefined,folder:string){
  if(!file||file.size===0)return undefined;
  if(!ALLOWED_TYPES.has(file.type))throw new Error("Use a JPG, PNG, or WebP image.");
  if(file.size>MAX_BYTES)throw new Error("Image must be 5 MB or smaller.");
  const cloud_name=process.env.CLOUDINARY_CLOUD_NAME,api_key=process.env.CLOUDINARY_API_KEY,api_secret=process.env.CLOUDINARY_API_SECRET;
  if(!cloud_name||!api_key||!api_secret)throw new Error("Image uploads are not configured. Add the Cloudinary variables to .env.local.");
  cloudinary.config({cloud_name,api_key,api_secret,secure:true});
  const data=Buffer.from(await file.arrayBuffer()).toString("base64");
  const result=await cloudinary.uploader.upload(`data:${file.type};base64,${data}`,{folder:`restaurant-pos/${folder}`,resource_type:"image",transformation:[{width:1200,height:1200,crop:"limit"},{quality:"auto",fetch_format:"auto"}]});
  return result.secure_url;
}
