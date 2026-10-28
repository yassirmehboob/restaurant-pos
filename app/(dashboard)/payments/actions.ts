"use server";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/data/auth";
import { writeAuditLog } from "@/lib/audit";
import { saleSessionError, withSaleSession } from "@/lib/sale-sessions";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";
import { paymentTaxQuote,type PaymentMethod } from "@/lib/tax";
import { connectToDatabase } from "@/lib/db";

const schema=z.object({orderId:z.string().regex(/^[a-f\d]{24}$/i),idempotencyKey:z.string().uuid(),method:z.enum(["CASH","CARD","BANK","OTHER"]),expectedGrandTotal:z.number().nonnegative(),tenderedAmount:z.number().positive(),reference:z.string().trim().max(100),notes:z.string().trim().max(300)});

export async function previewPaymentTax(orderId:string,method:PaymentMethod){
 const user=await requirePermission("payments");
 if(!/^[a-f\d]{24}$/i.test(orderId)||!["CASH","CARD","BANK","OTHER"].includes(method))return{ok:false as const,message:"Invalid payment details."};
 await connectToDatabase();const order=await Order.findOne({_id:orderId,businessId:user.businessId,status:{$ne:"CANCELLED"},paymentStatus:{$ne:"PAID"}}).lean();
 if(!order)return{ok:false as const,message:"This order is already paid or unavailable."};
 try{const quote=paymentTaxQuote(order,method);return{ok:true as const,subtotal:quote.subtotal,taxAmount:quote.taxAmount,grandTotal:quote.grandTotal,dueAmount:quote.dueAmount,taxRate:quote.taxRate,method:quote.method}}catch(error){return{ok:false as const,message:error instanceof Error?error.message:"Could not calculate invoice tax."}}
}

export async function completeOrderPayment(input:z.infer<typeof schema>){
  const user=await requirePermission("payments"),parsed=schema.safeParse(input);
  if(!parsed.success)return{ok:false as const,message:parsed.error.issues[0]?.message??"Check payment details."};
  let result;
  try {
    result = await withSaleSession(user, async (sale, transaction) => {
      const existing=await Payment.findOne({businessId:user.businessId,idempotencyKey:parsed.data.idempotencyKey}).session(transaction).lean();
      if(existing)throw new Error("This payment was already submitted.");
      const order=await Order.findOne({_id:parsed.data.orderId,businessId:user.businessId,status:{$ne:"CANCELLED"},paymentStatus:{$ne:"PAID"}}).session(transaction).lean();
      if(!order)throw new Error("This order is already paid or cannot accept payment.");
      const quote=paymentTaxQuote(order,parsed.data.method);
      if(Math.abs(quote.grandTotal-parsed.data.expectedGrandTotal)>0.005)throw new Error("The invoice changed. Refresh its payment calculation before receiving payment.");
      const due=quote.dueAmount,tendered=Math.round(parsed.data.tenderedAmount*100)/100;
      if(parsed.data.method==="CASH"&&tendered<due)throw new Error(`Cash received must be at least Rs ${due.toLocaleString()}.`);
      if(parsed.data.method!=="CASH"&&tendered!==due)throw new Error(`Payment amount must equal Rs ${due.toLocaleString()}.`);
      const change=parsed.data.method==="CASH"?Math.round((tendered-due)*100)/100:0;
      const [payment]=await Payment.create([{businessId:user.businessId,saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,orderId:order._id,idempotencyKey:parsed.data.idempotencyKey,amount:due,tenderedAmount:tendered,changeAmount:change,method:parsed.data.method,reference:parsed.data.reference||undefined,notes:parsed.data.notes||undefined,receivedByUserId:user.id,receivedByNameSnapshot:user.fullName,paidAt:new Date()}],{session:transaction});
      const items=quote.lines?order.items.map((line:Record<string,unknown>,index:number)=>({...line,taxRate:quote.taxRate,isTaxInclusive:false,lineTax:quote.lines![index].taxAmount,lineTotal:quote.lines![index].lineTotal})):order.items;
      const completeDineIn=order.orderType==="DINE_IN";
      const sendToKitchen=order.orderType==="TAKEAWAY"&&["DRAFT","CONFIRMED"].includes(order.status);
      const paid=await Order.findOneAndUpdate({_id:order._id,businessId:user.businessId,status:{$ne:"CANCELLED"},paymentStatus:{$ne:"PAID"}},{$set:{...(completeDineIn?{status:"COMPLETED",completedAt:order.completedAt??new Date()}:{}),...(sendToKitchen?{status:"SENT_TO_KITCHEN",kitchenSentAt:new Date(),kitchenStatusSource:"MANUAL"}:{}),items,taxAmount:quote.taxAmount,grandTotal:quote.grandTotal,taxRateSnapshot:quote.taxRate,taxPaymentMethod:parsed.data.method,paidAmount:quote.grandTotal,dueAmount:0,paymentStatus:"PAID",saleDate:order.saleDate||sale.saleDate,collectedInSessionId:sale._id}},{returnDocument:"after",session:transaction});
      if(!paid)throw new Error("Another payment completed this order first.");
      return {completed:completeDineIn,sentToKitchen:sendToKitchen,change,taxRate:quote.taxRate,taxAmount:quote.taxAmount,previousGrandTotal:order.grandTotal,grandTotal:quote.grandTotal,saleDate:order.saleDate||sale.saleDate,orderNumber:order.orderNumber,orderId:String(order._id),paymentId:String(payment._id),amount:due};
    });
  } catch(error) { return {ok:false as const,message:saleSessionError(error)}; }
  await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"COMPLETE_PAYMENT",entityType:"Order",entityId:result.orderId,description:`Received payment for ${result.orderNumber}`,metadata:{completed:result.completed,sentToKitchen:result.sentToKitchen,saleDate:result.saleDate,paymentId:result.paymentId,method:parsed.data.method,amount:result.amount,change:result.change,taxRate:result.taxRate,taxAmount:result.taxAmount,previousGrandTotal:result.previousGrandTotal,grandTotal:result.grandTotal}});
  const business=await Business.findOne({_id:user.businessId,isActive:true}).lean();
  for(const path of ["/orders","/kitchen",`/orders/${result.orderId}`,"/sale-sessions","/sales","/reports","/reports/profit-loss","/dashboard"])revalidatePath(path);
  return{ok:true as const,orderId:result.orderId,amount:result.amount,change:result.change,orderNumber:result.orderNumber,autoPrint:Boolean(can(user,"printing")&&business?.autoPrintCustomerOnPayment&&business.customerPrintingEnabled!==false),printerMode:(business?.printerMode??"BROWSER") as "BROWSER"|"QZ"};
}
