import "server-only";
import bcrypt from "bcryptjs";
import { allowAuthAttempt,consumeSecondFactor } from "@/lib/auth/two-factor";
import { User } from "@/models/User";

export type OwnerAccount=NonNullable<Awaited<ReturnType<typeof findActiveOwner>>>;
export function findActiveOwner(owner:{id:string;businessId:string}){return User.findOne({_id:owner.id,businessId:owner.businessId,role:"OWNER",isActive:true}).select("+passwordHash +twoFactorSecret +twoFactorLastStep +twoFactorRecoveryHashes")}
/** Re-checks the acting owner's password (and 2FA when enabled); returns an error message or null. */
export async function confirmOwner(account:OwnerAccount,currentPassword:string|undefined,twoFactorCode:string|undefined,action:string){
 if(!(await allowAuthAttempt("owner-profile:"+String(account._id))))return "Too many verification attempts. Wait five minutes and try again.";
 if(!currentPassword||!await bcrypt.compare(currentPassword,account.passwordHash))return "Enter your current password to "+action+".";
 if(account.twoFactorEnabled&&!await consumeSecondFactor(account,twoFactorCode??""))return "Enter a valid authenticator or recovery code to "+action+".";
 return null;
}
