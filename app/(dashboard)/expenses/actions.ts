"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { expenseCategorySchema,expenseSchema } from "@/lib/validation/expenses";
import { ExpenseCategory } from "@/models/ExpenseCategory";
import { activeSaleSession,withSaleSession,saleSessionError } from "@/lib/sale-sessions";
import { Expense } from "@/models/Expense";
import type { MasterState } from "@/app/(dashboard)/master-actions";

async function context(managerOnly=true){const user=await requirePermission("expenses");void managerOnly;await connectToDatabase();return user}
const values=(data:FormData,names:string[])=>Object.fromEntries(names.map(name=>[name,data.get(name)]));
const duplicate=(error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:number}).code===11000;

export async function createExpenseCategory(_state:MasterState,data:FormData):Promise<MasterState>{const user=await context(),parsed=expenseCategorySchema.safeParse(values(data,["name","description"]));if(!parsed.success)return{errors:parsed.error.flatten().fieldErrors};try{const row=await ExpenseCategory.create({...parsed.data,businessId:user.businessId});await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"CREATE_EXPENSE_CATEGORY",entityType:"ExpenseCategory",entityId:String(row._id),description:`Created expense category ${row.name}`});revalidatePath("/expenses");return{ok:true,message:"Expense category added."}}catch(error){return{message:duplicate(error)?"An expense category with this name already exists.":"Could not add expense category."}}}
export async function updateExpenseCategory(id:string,_state:MasterState,data:FormData):Promise<MasterState>{const user=await context(),parsed=expenseCategorySchema.safeParse(values(data,["name","description"]));if(!/^[a-f\d]{24}$/i.test(id))return{message:"Invalid category."};if(!parsed.success)return{errors:parsed.error.flatten().fieldErrors};try{const row=await ExpenseCategory.findOneAndUpdate({_id:id,businessId:user.businessId},{$set:parsed.data},{returnDocument:"after"});if(!row)return{message:"Category not found."};await Expense.updateMany({businessId:user.businessId,categoryId:id,isActive:true,saleSessionId:{$exists:false}},{$set:{categoryNameSnapshot:row.name}});await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_EXPENSE_CATEGORY",entityType:"ExpenseCategory",entityId:id,description:"Updated expense category "+row.name});revalidatePath("/expenses");revalidatePath("/reports/profit-loss");return{ok:true,message:"Expense category updated."}}catch(error){return{message:duplicate(error)?"An expense category with this name already exists.":"Could not update expense category."}}}
export async function toggleExpenseCategory(id:string){const user=await context();if(!/^[a-f\d]{24}$/i.test(id))return;const row=await ExpenseCategory.findOne({_id:id,businessId:user.businessId});if(!row)return;row.isActive=!row.isActive;await row.save();await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:row.isActive?"ACTIVATE_EXPENSE_CATEGORY":"DEACTIVATE_EXPENSE_CATEGORY",entityType:"ExpenseCategory",entityId:id,description:(row.isActive?"Activated":"Deactivated")+" expense category "+row.name});revalidatePath("/expenses")}

function refreshExpenses(){for(const path of ["/expenses","/reports/profit-loss","/dashboard","/sale-sessions"])revalidatePath(path)}
export async function createExpense(_state:MasterState,data:FormData):Promise<MasterState>{
  const user=await context(false),sale=await activeSaleSession(user);if(!sale)return{message:"Start a sale before recording expenses."};const parsed=expenseSchema.safeParse({...values(data,["categoryId","title","amount","paymentMethod","reference","notes"]),expenseDate:sale.saleDate});
  if(!parsed.success)return{errors:parsed.error.flatten().fieldErrors};
  const category=await ExpenseCategory.findOne({_id:parsed.data.categoryId,businessId:user.businessId,isActive:true}).lean();
  if(!category)return{message:"Select an active expense category."};
  try{
    const row=await withSaleSession(user,async(sale,transaction)=>{
      const [expense]=await Expense.create([{...parsed.data,expenseDate:new Date(sale.saleDate+"T12:00:00+05:00"),saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,businessId:user.businessId,categoryNameSnapshot:category.name,createdByUserId:user.id,createdByNameSnapshot:user.fullName}],{session:transaction});
      return expense;
    });
    await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"CREATE_EXPENSE",entityType:"Expense",entityId:String(row._id),description:"Recorded expense "+row.title,metadata:{amount:row.amount,category:category.name}});
    refreshExpenses();return{ok:true,message:"Expense recorded against your active sale date."};
  }catch(error){return{message:saleSessionError(error)}}
}
export async function updateExpense(id:string,_state:MasterState,data:FormData):Promise<MasterState>{
  const user=await context(false),active=await activeSaleSession(user);
  if(!active)return{message:"Start a sale before editing expenses."};
  const parsed=expenseSchema.safeParse({...values(data,["categoryId","title","amount","paymentMethod","reference","notes"]),expenseDate:active.saleDate});
  if(!/^[a-f\d]{24}$/i.test(id))return{message:"Invalid expense."};
  if(!parsed.success)return{errors:parsed.error.flatten().fieldErrors};
  const category=await ExpenseCategory.findOne({_id:parsed.data.categoryId,businessId:user.businessId,isActive:true}).lean();
  if(!category)return{message:"Select an active expense category."};
  try{
    const before=await withSaleSession(user,async(sale,transaction)=>{
      const row=await Expense.findOneAndUpdate({_id:id,businessId:user.businessId,createdByUserId:user.id,saleSessionId:sale._id,isActive:true},{$set:{...parsed.data,expenseDate:new Date(sale.saleDate+"T12:00:00+05:00"),categoryNameSnapshot:category.name,updatedByUserId:user.id}},{returnDocument:"before",session:transaction});
      if(!row)throw new Error("Only expenses in your active shift can be edited. Closed shifts are final.");
      return row;
    });
    await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_EXPENSE",entityType:"Expense",entityId:id,description:"Updated expense "+parsed.data.title,metadata:{before:{title:before.title,amount:before.amount,category:before.categoryNameSnapshot,paymentMethod:before.paymentMethod,reference:before.reference},after:{title:parsed.data.title,amount:parsed.data.amount,category:category.name,paymentMethod:parsed.data.paymentMethod,reference:parsed.data.reference},saleDate:before.saleDate}});
    refreshExpenses();return{ok:true,message:"Expense updated."};
  }catch(error){return{message:saleSessionError(error)}}
}
export async function deactivateExpense(id:string){
  const user=await context(false);if(!/^[a-f\d]{24}$/i.test(id))return;
  const expense=await withSaleSession(user,async(sale,transaction)=>{
    return Expense.findOneAndUpdate({_id:id,businessId:user.businessId,createdByUserId:user.id,saleSessionId:sale._id,isActive:true},{$set:{isActive:false,updatedByUserId:user.id}},{session:transaction,returnDocument:"before"});
  });
  if(expense)await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"DEACTIVATE_EXPENSE",entityType:"Expense",entityId:id,description:"Deactivated expense "+expense.title,metadata:{amount:expense.amount,category:expense.categoryNameSnapshot,saleDate:expense.saleDate}});
  refreshExpenses();
}
