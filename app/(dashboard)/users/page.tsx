import { redirect } from "next/navigation";
import { requireUser,findMainOwnerId } from "@/data/auth";
import { User } from "@/models/User";
import { permissionsFor } from "@/lib/permissions";
import type { UserRole } from "@/lib/roles";
import { MasterHeader } from "@/components/master-shell";
import { UserAccounts } from "@/components/user-accounts";
export default async function UsersPage(){const owner=await requireUser();if(owner.role!=="OWNER")redirect("/access-denied");const [accounts,mainOwnerId]=await Promise.all([User.find({businessId:owner.businessId}).sort({isActive:-1,fullName:1}).lean(),findMainOwnerId(owner.businessId)]);return <main className="master-page"><MasterHeader eyebrow="Owner controls" title="User Accounts" description="Create POS logins, assign roles and choose exactly what each user can do."/><UserAccounts currentUserId={owner.id} mainOwnerId={mainOwnerId}accounts={accounts.map(account=>({id:String(account._id),fullName:account.fullName,phone:account.phone||"",username:account.username,role:account.role,isActive:account.isActive,privileges:permissionsFor({role:account.role as UserRole,privileges:account.privileges})}))}/></main>}
