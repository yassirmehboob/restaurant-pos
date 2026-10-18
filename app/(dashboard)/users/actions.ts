"use server";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/data/auth";
import { User } from "@/models/User";
import { SaleSession } from "@/models/SaleSession";
import { userAccountSchema,ownerProfileSchema } from "@/lib/validation/user-account";
import { writeAuditLog } from "@/lib/audit";
export async function saveUserAccount(id:string|undefined,input:unknown){
 const owner=await requireOwner();
 if(id&&!/^[a-f\d]{24}$/i.test(id))return {ok:false as const,message:"Invalid account."};
 if(id===owner.id)return saveOwnerProfile(input);
 const parsed=userAccountSchema.safeParse(input);if(!parsed.success)return {ok:false as const,message:parsed.error.issues[0]?.message??"Check account details."};
 const {password,...values}=parsed.data;
 if(!id&&!password)return {ok:false as const,message:"A password is required for a new account."};
 try{
  const account=id?await User.findOne({_id:id,businessId:owner.businessId}):null;
  if(id&&(!account||account.role==="OWNER"))return {ok:false as const,message:"This account cannot be changed."};
  if(account&&(!values.isActive||!values.privileges.includes("sale_sessions"))&&await SaleSession.exists({businessId:owner.businessId,userId:id,status:"OPEN"}))return {ok:false as const,message:"Close this user's open sale before deactivating the account or removing Start / Close Sale."};
  const previous=account?{isActive:account.isActive,role:account.role,privileges:account.privileges}:undefined;
  const passwordHash=password?await bcrypt.hash(password,12):undefined;
  let accountId=id;
  if(account){Object.assign(account,values,...(passwordHash?[{passwordHash}]:[]));await account.save()}
  else{const created=await User.create({...values,businessId:owner.businessId,passwordHash});accountId=String(created._id)}
  await writeAuditLog({businessId:owner.businessId,userId:owner.id,userName:owner.fullName,action:!id?"CREATE_USER_ACCOUNT":previous?.isActive!==values.isActive?(values.isActive?"ACTIVATE_USER_ACCOUNT":"DEACTIVATE_USER_ACCOUNT"):"UPDATE_USER_ACCOUNT",entityType:"User",entityId:accountId!,description:(id?"Updated":"Created")+" login account "+values.username,metadata:{before:previous,role:values.role,isActive:values.isActive,privileges:values.privileges,passwordChanged:Boolean(password)}});
  revalidatePath("/users");revalidatePath("/dashboard","layout");return {ok:true as const,message:id?"Account updated.":"Account created."};
 }catch(error){if(typeof error==="object"&&error&&"code" in error&&error.code===11000)return {ok:false as const,message:"This username is already in use. Choose another username."};return {ok:false as const,message:"The account could not be saved. Please try again."}}
}

export async function saveOwnerProfile(input:unknown){
 const owner=await requireOwner(),parsed=ownerProfileSchema.safeParse(input);
 if(!parsed.success)return {ok:false as const,message:parsed.error.issues[0]?.message??"Check your account details."};
 const {password,...profile}=parsed.data;
 try{
  const passwordHash=password?await bcrypt.hash(password,12):undefined;
  const account=await User.findOneAndUpdate({_id:owner.id,businessId:owner.businessId,role:"OWNER",isActive:true},{$set:{...profile,...(passwordHash?{passwordHash}:{})}},{returnDocument:"after",runValidators:true});
  if(!account)return {ok:false as const,message:"Your owner account could not be found."};
  await writeAuditLog({businessId:owner.businessId,userId:owner.id,userName:profile.fullName,action:"UPDATE_OWNER_PROFILE",entityType:"User",entityId:owner.id,description:"Updated own account profile",metadata:{passwordChanged:Boolean(password)}});
  revalidatePath("/users");revalidatePath("/dashboard","layout");
  return {ok:true as const,message:"Your account has been updated."};
 }catch(error){if(typeof error==="object"&&error&&"code" in error&&error.code===11000)return {ok:false as const,message:"This username is already in use. Choose another username."};return {ok:false as const,message:"Your account could not be saved. Please try again."}}
}
