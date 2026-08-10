"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { connectToDatabase } from "@/lib/db";
import { createSession, deleteSession } from "@/lib/auth/session";
import { loginSchema, registrationSchema } from "@/lib/validation/auth";
import { Business } from "@/models/Business";
import { User } from "@/models/User";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUser } from "@/data/auth";
import mongoose from "mongoose";
export type AuthState={error?:string;fieldErrors?:Record<string,string[]>}|undefined;
const values=(formData:FormData,fields:string[])=>Object.fromEntries(fields.map(field=>[field,formData.get(field)]));
export async function registerAction(_state:AuthState,formData:FormData):Promise<AuthState>{
  const result=registrationSchema.safeParse(values(formData,["businessName","fullName","username","password"]));
  if(!result.success)return{fieldErrors:result.error.flatten().fieldErrors};
  await connectToDatabase();
  if(await User.exists({username:result.data.username}))return{error:"This username is already in use."};
  const business=await Business.create({name:result.data.businessName});
  let createdUserId:string|undefined;
  try{
    const user=await User.create({businessId:business._id,fullName:result.data.fullName,username:result.data.username,passwordHash:await bcrypt.hash(result.data.password,12),role:"OWNER"});
    createdUserId=String(user._id);
    await writeAuditLog({businessId:String(business._id),userId:String(user._id),userName:user.fullName,action:"REGISTER_BUSINESS",entityType:"Business",entityId:String(business._id),description:"Business and owner account created"});
    await createSession({userId:String(user._id),businessId:String(business._id),role:"OWNER"});
  }catch(error){
    if(createdUserId)await User.deleteOne({_id:createdUserId,businessId:business._id});
    await Business.deleteOne({_id:business._id});
    if(typeof error==="object"&&error&&"code" in error&&error.code===11000)return{error:"This username is already in use."};
    if(error instanceof mongoose.Error.ValidationError){
      const issues=Object.values(error.errors).map(issue=>issue.message).join(" ");
      return{error:`Account validation failed: ${issues} Restart the development server if it still expects an email address.`};
    }
    console.error("Owner registration failed",error);
    return{error:"We could not create your account. Please try again."};
  }
  redirect("/settings/business");
}
export async function loginAction(_state:AuthState,formData:FormData):Promise<AuthState>{
  const result=loginSchema.safeParse(values(formData,["username","password"]));
  if(!result.success)return{fieldErrors:result.error.flatten().fieldErrors};
  await connectToDatabase();
  const user=await User.findOne({username:result.data.username,isActive:true}).select("+passwordHash");
  if(!user||!(await bcrypt.compare(result.data.password,user.passwordHash)))return{error:"Username or password is incorrect."};
  if(!(await Business.exists({_id:user.businessId,isActive:true})))return{error:"This restaurant account is inactive."};
  user.lastLoginAt=new Date();await user.save();
  await writeAuditLog({businessId:String(user.businessId),userId:String(user._id),userName:user.fullName,action:"LOGIN",entityType:"User",entityId:String(user._id),description:"User logged in"});
  await createSession({userId:String(user._id),businessId:String(user.businessId),role:user.role});
  redirect("/dashboard");
}
export async function logoutAction(){
  const user=await getCurrentUser();
  if(user)await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"LOGOUT",entityType:"User",entityId:user.id,description:"User logged out"});
  await deleteSession();redirect("/login");
}
