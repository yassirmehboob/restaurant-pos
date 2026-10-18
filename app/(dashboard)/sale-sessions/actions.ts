"use server";

import { revalidatePath } from "next/cache";
import { startSaleSchema } from "@/lib/validation/sale-session";
import { requirePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { SaleSession } from "@/models/SaleSession";
import { requireSaleSessionDatabase, saleSessionError, sessionTotals, withSaleSession } from "@/lib/sale-sessions";
import type { MasterState } from "@/app/(dashboard)/master-actions";
import bcrypt from "bcryptjs";
import { requireOwner } from "@/data/auth";
import { User } from "@/models/User";
import { closeCounterAsOwner } from "@/lib/sale-sessions";
import { writeAuditLog } from "@/lib/audit";

function refresh() {
  for (const path of ["/sale-sessions", "/pos", "/sales", "/expenses", "/dashboard", "/reports"]) revalidatePath(path);
}

export async function ownerCloseCounter(id:string,password:string){
  const owner=await requireOwner();
  if(typeof password!=="string"||!password||password.length>128)return {ok:false as const,message:"Enter your owner account password."};
  const account=await User.findOne({_id:owner.id,businessId:owner.businessId,role:"OWNER",isActive:true}).select("+passwordHash");
  if(!account||!await bcrypt.compare(password,account.passwordHash))return {ok:false as const,message:"Incorrect owner password. The counter remains open."};
  try{
    const sale=await closeCounterAsOwner(owner,id);
    await writeAuditLog({businessId:owner.businessId,userId:owner.id,userName:owner.fullName,action:"OWNER_CLOSE_COUNTER",entityType:"SaleSession",entityId:id,description:`Owner closed ${sale.counterName} for ${sale.saleDate}`});
    refresh();return {ok:true as const,message:`${sale.counterName} closed successfully.`};
  }catch(error){return {ok:false as const,message:saleSessionError(error)}}
}

export async function startSale(_state: MasterState, data: FormData): Promise<MasterState> {
  const user = await requirePermission("sale_sessions");
  const parsed = startSaleSchema.safeParse(Object.fromEntries(["saleDate", "counterName", "openingBalance"].map(key => [key, data.get(key)])));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  await connectToDatabase();
  try {
    await requireSaleSessionDatabase();
    // Explicitly ensure uniqueness even when production disables automatic indexes.
    await SaleSession.createIndexes();
    // Verify transaction support before opening a session the account cannot use.
    const opened=await SaleSession.db.transaction(async transaction => {
      const [session]=await SaleSession.create([{ ...parsed.data, counterKey: parsed.data.counterName.toLowerCase(), businessId: user.businessId, userId: user.id, userNameSnapshot: user.fullName }], { session: transaction });
      return session;
    });
    await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"START_SALE",entityType:"SaleSession",entityId:String(opened._id),description:"Started sale at "+opened.counterName,metadata:{saleDate:opened.saleDate,openingBalance:opened.openingBalance}});
    refresh();
    return { ok: true, message: "Sale started. Its sale date stays the same until you close it." };
  } catch (error) { return { message: saleSessionError(error) }; }
}

export async function closeSale(id: string, _state: MasterState, data: FormData): Promise<MasterState> {
  const user = await requirePermission("sale_sessions");
  if (!/^[a-f\d]{24}$/i.test(id)) return { message: "Invalid sale session." };
  if (data.get("confirm") !== "yes") return { message: "Confirm that you want to close this sale session." };
  try {
    const closed=await withSaleSession(user, async (sale, transaction) => {
      if (String(sale._id) !== id) throw new Error("This sale session is already closed. Refresh the page.");
      const totals = await sessionTotals(user.businessId, id, sale.openingBalance, transaction);
      await SaleSession.updateOne({ _id: sale._id, businessId: user.businessId, status: "OPEN" },
        { $set: { status: "CLOSED", closedAt: new Date(), closingTotals: totals } }, { session: transaction });
      return {counterName:sale.counterName,saleDate:sale.saleDate,totals};
    });
    refresh();
    await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"CLOSE_SALE",entityType:"SaleSession",entityId:id,description:"Closed sale at "+closed.counterName,metadata:{saleDate:closed.saleDate,closingTotals:closed.totals}});
    return { ok: true, message: "Sale closed. You can start another shift on the same sale date." };
  } catch (error) { return { message: saleSessionError(error) }; }
}
