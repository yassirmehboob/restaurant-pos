import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connectToDatabase } from "@/lib/db";
import { readSession } from "@/lib/auth/session";
import { User } from "@/models/User";
import { Business } from "@/models/Business";
import type { UserRole } from "@/lib/roles";
import { can,permissionsFor,type Privilege } from "@/lib/permissions";
export type CurrentUser={id:string;businessId:string;businessName:string;businessLogoUrl?:string;fullName:string;username:string;role:UserRole;privileges:Privilege[]};
export const getCurrentUser=cache(async():Promise<CurrentUser|null>=>{
  const session=await readSession();if(!session)return null;await connectToDatabase();
  const user=await User.findOne({_id:session.userId,businessId:session.businessId,isActive:true}).lean();if(!user)return null;
  const business=await Business.findOne({_id:session.businessId,isActive:true}).lean();if(!business)return null;
  return{id:String(user._id),businessId:String(user.businessId),businessName:business.name,businessLogoUrl:business.logoUrl,fullName:user.fullName,username:user.username,role:user.role as UserRole,privileges:permissionsFor({role:user.role as UserRole,privileges:user.privileges})};
});
export async function requireUser(){const user=await getCurrentUser();if(!user)redirect("/login");return user;}
export async function requirePermission(permission:Privilege){const user=await requireUser();if(!can(user,permission))throw new Error("You do not have permission to perform this action.");return user;}
export async function requireOwner(){const user=await requireUser();if(user.role!=="OWNER")throw new Error("Only the restaurant owner can manage user accounts.");return user;}
export async function requirePagePermission(permission:Privilege){const user=await requireUser();if(!can(user,permission))redirect("/access-denied");return user;}
