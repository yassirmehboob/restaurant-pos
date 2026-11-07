"use server";
import { can } from "@/lib/permissions";
import { counterPrintsKitchen } from "@/lib/printer-target";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/data/auth";
import { writeAuditLog } from "@/lib/audit";
import { saleSessionError, withSaleSession } from "@/lib/sale-sessions";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";
import { paymentPricing,type PaymentMethod } from "@/lib/tax";
import { businessDiscountTypes,discountInputSchema,resolveInvoiceDiscount,storedDiscount,withStoredDiscountType,type AppliedDiscount,type DiscountInput,type StoredDiscount } from "@/lib/invoice-discount";
import { queueDiscountSms } from "@/lib/discount-sms";
import { connectToDatabase } from "@/lib/db";
import { paymentPrefillDue } from "@/lib/payment-settings";
import { paymentInputSchema } from "@/lib/validation/payment";
import { queuePaymentSms } from "@/lib/payment-sms";
import { queueDeliverySms } from "@/lib/delivery-sms";
import { queueOrderStageSms } from "@/lib/order-stage-sms.mjs";
import mongoose from "mongoose";
import { autoIssueCoupons,redeemOrderCoupon } from "@/lib/coupon-service";

// The discount chosen at Review & send is saved on the order. At payment it can be kept (discount left out),
// removed (null) or changed (a new choice), with the same discount types as Review & send.
const schema=paymentInputSchema.omit({discount:true}).extend({orderId:z.string().regex(/^[a-f\d]{24}$/i),discount:discountInputSchema.nullable().optional()});
type DiscountChoice=DiscountInput|null|undefined;
type PayableOrder=Parameters<typeof paymentPricing>[0]&{invoiceDiscount?:StoredDiscount|null};

// Prices an invoice for payment. Tax can change with the method, so it is priced from the coupon-only amount.
function priceForPayment(order:PayableOrder,method:PaymentMethod,types:ReturnType<typeof businessDiscountTypes>=[],choice?:DiscountChoice,requireRemarks=false){
 const stored=storedDiscount(order.invoiceDiscount),couponOnly={...order,discountAmount:Math.max(0,(order.discountAmount??0)-(stored?.amount??0))};
 let discount:AppliedDiscount|null=stored;
 if(choice!==undefined){const base=paymentPricing(couponOnly,method);discount=choice?resolveInvoiceDiscount(types,choice,Math.max(0,base.subtotal-base.discountAmount),{requireRemarks}):null}
 return{priced:discount?paymentPricing(couponOnly,method,discount.amount):paymentPricing(couponOnly,method),discount,changed:choice!==undefined};
}
async function paymentDiscountTypes(businessId:string,order:PayableOrder,session?:mongoose.ClientSession){
 const business=await Business.findOne({_id:businessId,isActive:true}).select("invoiceDiscountEnabled discountTypes").session(session??null).lean();
 return withStoredDiscountType(business?businessDiscountTypes(business):[],order.invoiceDiscount);
}

export async function previewPaymentTax(orderId:string,method:PaymentMethod,choice?:DiscountChoice){
 const user=await requirePermission("payments");
 if(!/^[a-f\d]{24}$/i.test(orderId)||!["CASH","CARD","BANK","OTHER"].includes(method))return{ok:false as const,message:"Invalid payment details."};
 await connectToDatabase();const [order,prefillDue,business]=await Promise.all([Order.findOne({_id:orderId,businessId:user.businessId,status:{$ne:"CANCELLED"},paymentStatus:{$ne:"PAID"}}).lean(),paymentPrefillDue(user.businessId),Business.findOne({_id:user.businessId,isActive:true}).select("couponOnPayment").lean()]);
 if(!order)return{ok:false as const,message:"This order is already paid or unavailable."};
 try{
  const discountTypes=await paymentDiscountTypes(user.businessId,order);
  let result=priceForPayment(order,method),discountError="";
  // A discount that cannot apply leaves the saved totals and explains why.
  if(choice!==undefined)try{result=priceForPayment(order,method,discountTypes,choice)}catch(error){discountError=error instanceof Error?error.message:"Could not apply this discount."}
  const {priced,discount}=result;
  return{ok:true as const,orderType:String(order.orderType),discountTypes,discountError,subtotal:priced.subtotal,discountAmount:priced.discountAmount,coupon:order.couponCode?{code:String(order.couponCode),batchName:String(order.couponSnapshot?.batchName??"")}:null,customerId:order.customerId?String(order.customerId):"",taxAmount:priced.taxAmount,grandTotal:priced.grandTotal,dueAmount:priced.dueAmount,taxRate:priced.taxRate,method:priced.method,prefillDue,invoiceDiscount:discount,couponOnPayment:business?.couponOnPayment!==false}
 }catch(error){return{ok:false as const,message:error instanceof Error?error.message:"Could not calculate invoice tax."}}
}

async function recordOrderPayment(input:z.infer<typeof schema>,completeDelivery:boolean){
  const user=await requirePermission("payments"),parsed=schema.safeParse(input);
  if(!parsed.success)return{ok:false as const,message:parsed.error.issues[0]?.message??"Check payment details."};
  let result;
  try {
    if(completeDelivery){await requirePermission("orders");await requirePermission("edit_orders")}
    result = await withSaleSession(user, async (sale, transaction) => {
      const existing=await Payment.findOne({businessId:user.businessId,idempotencyKey:parsed.data.idempotencyKey}).session(transaction).lean();
      if(existing)throw new Error("This payment was already submitted.");
      const order=await Order.findOne({_id:parsed.data.orderId,businessId:user.businessId,status:{$ne:"CANCELLED"},paymentStatus:{$ne:"PAID"}}).session(transaction).lean();
      if(!order)throw new Error("This order is already paid or cannot accept payment.");
      if(completeDelivery&&(order.orderType!=="DELIVERY"||order.status!=="SERVED"||(order.deliveryStatus&&order.deliveryStatus!=="OUT_FOR_DELIVERY")))throw new Error("Only an out-for-delivery order can be paid and marked delivered.");
      if(order.orderType==="DELIVERY"&&order.deliveryStatus!=="DELIVERED"&&!completeDelivery)throw new Error("Use Mark delivered to receive payment and confirm this delivery together.");
      const types=parsed.data.discount===undefined?[]:await paymentDiscountTypes(user.businessId,order,transaction);
      const {priced:quote,discount,changed}=priceForPayment(order,parsed.data.method,types,parsed.data.discount,true);
      if(Math.abs(quote.grandTotal-parsed.data.expectedGrandTotal)>0.005)throw new Error("The invoice changed. Refresh its payment calculation before receiving payment.");
      const due=quote.dueAmount,tendered=Math.round(parsed.data.tenderedAmount*100)/100;
      if(parsed.data.method==="CASH"&&tendered<due)throw new Error(`Cash received must be at least Rs ${due.toLocaleString()}.`);
      if(parsed.data.method!=="CASH"&&tendered!==due)throw new Error(`Payment amount must equal Rs ${due.toLocaleString()}.`);
      const change=parsed.data.method==="CASH"?Math.round((tendered-due)*100)/100:0;
      await redeemOrderCoupon(order,order.saleDate||sale.saleDate,transaction);
      const [payment]=await Payment.create([{businessId:user.businessId,saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,orderId:order._id,idempotencyKey:parsed.data.idempotencyKey,amount:due,tenderedAmount:tendered,changeAmount:change,method:parsed.data.method,reference:parsed.data.reference||undefined,notes:parsed.data.notes||undefined,receivedByUserId:user.id,receivedByNameSnapshot:user.fullName,paidAt:new Date()}],{session:transaction});
      const deliveryCompleted=completeDelivery||(order.orderType==="DELIVERY"&&order.deliveryStatus==="DELIVERED");
      // An unpaid takeaway can only be served after a reversal; collecting it again finishes it.
      const completeOrder=order.orderType==="DINE_IN"||deliveryCompleted||(order.orderType==="TAKEAWAY"&&order.status==="SERVED");
      const sendToKitchen=order.orderType==="TAKEAWAY"&&["DRAFT","CONFIRMED"].includes(order.status);
      const paid=await Order.findOneAndUpdate({_id:order._id,businessId:user.businessId,status:{$ne:"CANCELLED"},paymentStatus:{$ne:"PAID"}},{$set:{...(completeOrder?{status:"COMPLETED",completedAt:order.completedAt??payment.paidAt}:{}),...(completeDelivery?{deliveryStatus:"DELIVERED",deliveredAt:payment.paidAt,lastUpdatedByUserId:user.id}:{}),...(sendToKitchen?{status:"SENT_TO_KITCHEN",kitchenSentAt:new Date(),kitchenStatusSource:"MANUAL"}:{}),items:quote.items,discountAmount:quote.discountAmount,...(discount?{invoiceDiscount:changed?{...discount,amountBefore:quote.amountBefore,appliedByUserId:user.id,appliedByName:user.fullName}:{...order.invoiceDiscount,amountBefore:quote.amountBefore}}:{}),taxAmount:quote.taxAmount,grandTotal:quote.grandTotal,taxRateSnapshot:quote.taxRate,taxPaymentMethod:parsed.data.method,paidAmount:quote.grandTotal,dueAmount:0,paymentStatus:"PAID",saleDate:order.saleDate||sale.saleDate,collectedInSessionId:sale._id},...(changed&&!discount?{$unset:{invoiceDiscount:""}}:{})},{returnDocument:"after",session:transaction});
      if(!paid)throw new Error("Another payment completed this order first.");
      const issued=await autoIssueCoupons(paid.toObject(),order.saleDate||sale.saleDate,transaction);
      if(deliveryCompleted)await queueDeliverySms(paid.toObject(),"DELIVERY_DELIVERED",payment.paidAt,transaction);
      else await queuePaymentSms(paid.toObject(),payment.paidAt,transaction);
      if(completeOrder&&!deliveryCompleted)await queueOrderStageSms(mongoose.connection.db!,paid.toObject(),"ORDER_COMPLETED",payment.paidAt,transaction);
      if(discount)await queueDiscountSms(paid.toObject(),{amountBefore:quote.amountBefore,discount,amountAfter:quote.grandTotal,cashier:changed?user.fullName:order.invoiceDiscount?.appliedByName??user.fullName},transaction);
      return {completed:completeOrder,deliveryCompleted:completeDelivery,sentToKitchen:sendToKitchen,change,taxRate:quote.taxRate,taxAmount:quote.taxAmount,previousGrandTotal:order.grandTotal,grandTotal:quote.grandTotal,saleDate:order.saleDate||sale.saleDate,orderNumber:order.orderNumber,orderId:String(order._id),paymentId:String(payment._id),amount:due,issued,couponCode:order.couponCode?String(order.couponCode):null,discountAmount:order.discountAmount??0,discount};
    });
  } catch(error) { return {ok:false as const,message:saleSessionError(error)}; }
  await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"COMPLETE_PAYMENT",entityType:"Order",entityId:result.orderId,description:`Received payment for ${result.orderNumber}`,metadata:{completed:result.completed,sentToKitchen:result.sentToKitchen,saleDate:result.saleDate,paymentId:result.paymentId,method:parsed.data.method,amount:result.amount,change:result.change,taxRate:result.taxRate,taxAmount:result.taxAmount,previousGrandTotal:result.previousGrandTotal,grandTotal:result.grandTotal,...(result.couponCode?{couponCode:result.couponCode,discountAmount:result.discountAmount}:{}),...(result.issued.length?{issuedCoupons:result.issued.map(item=>item.code)}:{}),...(result.discount?{invoiceDiscount:{name:result.discount.name,percent:result.discount.percent,amount:result.discount.amount,remarks:result.discount.remarks}}:{})}});
  if(result.deliveryCompleted)await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"DELIVERY_DELIVERED",entityType:"Order",entityId:result.orderId,description:`Received payment and confirmed delivery of ${result.orderNumber}`,metadata:{paymentId:result.paymentId}});
  const business=await Business.findOne({_id:user.businessId,isActive:true}).lean();
  for(const path of ["/orders","/kitchen",`/orders/${result.orderId}`,"/sale-sessions","/sales","/reports","/reports/profit-loss","/dashboard","/coupons","/reports/discounts"])revalidatePath(path);
  return{ok:true as const,orderId:result.orderId,amount:result.amount,change:result.change,orderNumber:result.orderNumber,issuedCoupons:result.issued.map(item=>({code:item.code,batchName:item.batchName,description:item.description})),autoPrint:Boolean(can(user,"printing")&&business?.autoPrintCustomerOnPayment&&business.customerPrintingEnabled!==false),printKitchen:Boolean(result.sentToKitchen&&can(user,"printing")&&counterPrintsKitchen(business)),printerMode:(business?.printerMode??"BROWSER") as "BROWSER"|"QZ"};
}

export async function completeOrderPayment(input:z.infer<typeof schema>){return recordOrderPayment(input,false)}
export async function completeDeliveryPayment(input:z.infer<typeof schema>){return recordOrderPayment(input,true)}
