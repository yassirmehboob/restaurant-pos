import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connectToDatabase } from "@/lib/db";
import { readSession } from "@/lib/auth/session";
import { User } from "@/models/User";
import { Business } from "@/models/Business";
import type { UserRole } from "@/lib/roles";
export type CurrentUser={id:string;businessId:string;businessName:string;businessLogoUrl?:string;fullName:string;username:string;role:UserRole};
export const getCurrentUser=cache(async():Promise<CurrentUser|null>=>{
  const session=await readSession();if(!session)return null;await connectToDatabase();
  const user=await User.findOne({_id:session.userId,businessId:session.businessId,isActive:true}).lean();if(!user)return null;
  const business=await Business.findOne({_id:session.businessId,isActive:true}).lean();if(!business)return null;
  return{id:String(user._id),businessId:String(user.businessId),businessName:business.name,businessLogoUrl:business.logoUrl,fullName:user.fullName,username:user.username,role:user.role as UserRole};
});
export async function requireUser(){const user=await getCurrentUser();if(!user)redirect("/login");return user;}
