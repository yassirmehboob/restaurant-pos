import "server-only";
import { buildSalesReport,saleDateFilter,type ReportQuery } from "@/lib/reporting";
import { Expense } from "@/models/Expense";

export async function buildProfitLoss(businessId:string,query:ReportQuery){
  const sales=await buildSalesReport(businessId,query);
  const expenses=await Expense.find({businessId,isActive:true,...saleDateFilter(sales.range,"expenseDate")}).sort({expenseDate:-1}).lean();
  const expenseTotal=expenses.reduce((sum,row)=>sum+row.amount,0);
  const categoryMap=new Map<string,{name:string;amount:number;count:number}>();
  for(const expense of expenses){const key=String(expense.categoryId),current=categoryMap.get(key)??{name:expense.categoryNameSnapshot,amount:0,count:0};current.amount+=expense.amount;current.count+=1;categoryMap.set(key,current)}
  const grossProfit=sales.summary.netSales-sales.summary.cogs;
  return{range:sales.range,netSales:sales.summary.netSales,cogs:sales.summary.cogs,grossProfit,expenses:expenseTotal,netProfit:grossProfit-expenseTotal,expenseCount:expenses.length,categories:[...categoryMap.values()].sort((a,b)=>b.amount-a.amount)};
}
