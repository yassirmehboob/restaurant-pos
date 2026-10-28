"use server";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/auth/session";
import { allowAuthAttempt,consumeSecondFactor } from "@/lib/auth/two-factor";
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
  if(account){
   const securityChanged=Boolean(passwordHash)||account.username!==values.username||account.role!==values.role||account.isActive!==values.isActive||JSON.stringify([...(account.privileges??[])].sort())!==JSON.stringify([...values.privileges].sort());
   await User.updateOne({_id:account._id,businessId:owner.businessId,role:{$ne:"OWNER"}},{$set:{...values,...(passwordHash?{passwordHash}:{})},...(securityChanged?{$inc:{authVersion:1},$unset:{twoFactorPendingSecret:1,twoFactorPendingExpiresAt:1}}:{})});
  }
  else{const created=await User.create({...values,businessId:owner.businessId,passwordHash});accountId=String(created._id)}
  await writeAuditLog({businessId:owner.businessId,userId:owner.id,userName:owner.fullName,action:!id?"CREATE_USER_ACCOUNT":previous?.isActive!==values.isActive?(values.isActive?"ACTIVATE_USER_ACCOUNT":"DEACTIVATE_USER_ACCOUNT"):"UPDATE_USER_ACCOUNT",entityType:"User",entityId:accountId!,description:(id?"Updated":"Created")+" login account "+values.username,metadata:{before:previous,role:values.role,isActive:values.isActive,privileges:values.privileges,passwordChanged:Boolean(password)}});
  revalidatePath("/users");revalidatePath("/dashboard","layout");return {ok:true as const,message:id?"Account updated.":"Account created."};
 }catch(error){if(typeof error==="object"&&error&&"code" in error&&error.code===11000)return {ok:false as const,message:"This username is already in use. Choose another username."};return {ok:false as const,message:"The account could not be saved. Please try again."}}
}

export async function saveOwnerProfile(input:unknown){
 const owner=await requireOwner(),parsed=ownerProfileSchema.safeParse(input);
 if(!parsed.success)return {ok:false as const,message:parsed.error.issues[0]?.message??"Check your account details."};
 const {password,currentPassword,twoFactorCode,...profile}=parsed.data;
 try{
  const before=await User.findOne({_id:owner.id,businessId:owner.businessId,role:"OWNER",isActive:true}).select("+passwordHash +twoFactorSecret +twoFactorLastStep +twoFactorRecoveryHashes");
  if(!before)return{ok:false as const,message:"Your owner account could not be found."};
  const securityChanged=Boolean(password)||before.username!==profile.username;
  if(securityChanged){
   if(!(await allowAuthAttempt("owner-profile:"+owner.id)))return{ok:false as const,message:"Too many verification attempts. Wait five minutes and try again."};
   if(!currentPassword||!await bcrypt.compare(currentPassword,before.passwordHash))return{ok:false as const,message:"Enter your current password to change your username or password."};
   if(before.twoFactorEnabled&&!await consumeSecondFactor(before,twoFactorCode??""))return{ok:false as const,message:"Enter a valid authenticator or recovery code to change your username or password."};
  }
  const passwordHash=password?await bcrypt.hash(password,12):undefined;
  const account=await User.findOneAndUpdate({_id:owner.id,businessId:owner.businessId,role:"OWNER",isActive:true,passwordHash:before.passwordHash,...((before.authVersion??0)===0?{$or:[{authVersion:0},{authVersion:{$exists:false}}]}:{authVersion:before.authVersion})},{$set:{...profile,...(passwordHash?{passwordHash}:{})},...(securityChanged?{$inc:{authVersion:1},$unset:{twoFactorPendingSecret:1,twoFactorPendingExpiresAt:1}}:{})},{returnDocument:"after",runValidators:true});
  if(!account)return {ok:false as const,message:"Your account changed. Refresh and try again."};
  if(securityChanged)await createSession({userId:owner.id,businessId:owner.businessId,role:"OWNER",authVersion:account.authVersion});
  await writeAuditLog({businessId:owner.businessId,userId:owner.id,userName:profile.fullName,action:"UPDATE_OWNER_PROFILE",entityType:"User",entityId:owner.id,description:"Updated own account profile",metadata:{passwordChanged:Boolean(password)}});
  revalidatePath("/users");revalidatePath("/dashboard","layout");
  return {ok:true as const,message:"Your account has been updated."};
 }catch(error){if(typeof error==="object"&&error&&"code" in error&&error.code===11000)return {ok:false as const,message:"This username is already in use. Choose another username."};return {ok:false as const,message:"Your account could not be saved. Please try again."}}
}
