"use server";
import { cashDrawerFor } from "@/lib/cash-drawer";
import { requirePermission } from "@/data/auth";

import { withSaleSession,saleSessionError } from "@/lib/sale-sessions";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/data/auth";
import { writeAuditLog } from "@/lib/audit";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { paymentPrefillDue } from "@/lib/payment-settings";
import { orderIdSchema,orderInputSchema,type OrderInput } from "@/lib/validation/order";
import { Coupon } from "@/models/Coupon";
import { Customer } from "@/models/Customer";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";
import { paymentInputSchema } from "@/lib/validation/payment";
import { can } from "@/lib/permissions";
import { autoPrintsUnpaidBill,counterPrintsKitchen } from "@/lib/printer-target";
import { COUNTER_ROLES } from "@/lib/roles";
import { z } from "zod";
import { OrderCounter } from "@/models/OrderCounter";
import { RestaurantTable } from "@/models/RestaurantTable";
import { Staff } from "@/models/Staff";
import { WaiterRequest } from "@/models/WaiterRequest";
import { waiterRequestSchema } from "@/lib/validation/waiter";
import mongoose from "mongoose";
import { notifyWaiterOrder } from "@/lib/waiter-push.mjs";
import { reviseWaiterRequest,claimWaiterRequest } from "@/lib/waiter-requests";
import { orderSnapshots } from "@/lib/order-snapshots";
import { queuePaymentSms } from "@/lib/payment-sms";
import { queueDeliverySms } from "@/lib/delivery-sms";
import { queueOrderStageSms } from "@/lib/order-stage-sms.mjs";
import { autoIssueCoupons,claimCoupon,couponsAllowed,COUPONS_OFF_MESSAGE,releaseOrderCoupon,resolveCoupon } from "@/lib/coupon-service";
import { activeSaleSession } from "@/lib/sale-sessions";
import { dateISO } from "@/lib/dates";
import { allowAuthAttempt } from "@/lib/auth/two-factor";
import { businessDiscountTypes,rescaleDiscount,resolveInvoiceDiscount,withStoredDiscountType,type AppliedDiscount,type DiscountInput,type StoredDiscount } from "@/lib/invoice-discount";
import { queueDiscountSms } from "@/lib/discount-sms";
import type { ClientSession } from "mongoose";

export async function changeDeliveryStatus(id:string,next:"OUT_FOR_DELIVERY"|"DELIVERED",confirmed=false){
 try{
  const user=await requirePermission("orders");await requirePermission("edit_orders");
  orderIdSchema.parse(id);z.enum(["OUT_FOR_DELIVERY","DELIVERED"]).parse(next);
  z.boolean().parse(confirmed);
  if(next==="DELIVERED"&&!confirmed)throw new Error("Confirm delivery from the delivery popup.");
  await connectToDatabase();const now=new Date();
  const updated=await mongoose.connection.transaction(async transaction=>{
   const filter={_id:id,businessId:user.businessId,orderType:"DELIVERY",...(next==="OUT_FOR_DELIVERY"?{status:"READY",deliveryStatus:{$in:["PLACED",null]}}:{status:"SERVED",$or:[{deliveryStatus:"OUT_FOR_DELIVERY"},{deliveryStatus:{$exists:false}}]})};
   const order=await Order.findOne(filter).session(transaction).lean();
   if(!order)throw new Error(next==="OUT_FOR_DELIVERY"?"The order must be ready in the kitchen before dispatch.":"Only an order that is out for delivery can be marked delivered.");
   if(next==="DELIVERED"&&order.paymentStatus!=="PAID")throw new Error("Receive payment before confirming this delivery.");
   const complete=next==="DELIVERED"&&order.paymentStatus==="PAID";
   const updated=await Order.findOneAndUpdate(filter,{$set:{deliveryStatus:next,status:complete?"COMPLETED":"SERVED",...(next==="OUT_FOR_DELIVERY"?{outForDeliveryAt:now}:{deliveredAt:now}),...(complete?{completedAt:now}:{}),lastUpdatedByUserId:user.id}},{session:transaction,returnDocument:"after"});
   if(!updated)throw new Error("The delivery changed. Refresh and try again.");
   await queueDeliverySms(updated.toObject(),next==="OUT_FOR_DELIVERY"?"DELIVERY_OUT_FOR_DELIVERY":"DELIVERY_DELIVERED",now,transaction);
   return updated;
  });
  await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"DELIVERY_"+next,entityType:"Order",entityId:id,description:`Marked ${updated.orderNumber} ${next.replaceAll("_"," ").toLowerCase()}`});
  for(const path of ["/orders",`/orders/${id}`,"/kitchen","/settings/business"])revalidatePath(path);
  return{ok:true as const};
 }catch(error){return{ok:false as const,message:saleSessionError(error)}}
}

export async function saveWaiterRequest(raw:unknown){
 try{
  const user=await requirePermission("waiter");
  if(user.role!=="WAITER")throw new Error("Use a waiter account to take orders.");
  const parsed=waiterRequestSchema.parse(raw);
  // Identity and payment defaults are controlled by the server.
  const data=await context({...parsed.input,waiterId:"",customerId:"",paymentMethod:"CASH",deliveryCharge:0});
  const values={input:data.input,tableName:data.table?.name,displayLines:data.items.map(item=>({name:item.nameSnapshot,quantity:item.quantity,note:item.notes??"",unitPrice:item.unitPrice})),summary:{subtotal:data.totals.subtotal,taxAmount:data.totals.taxAmount,grandTotal:data.totals.grandTotal}};
  const row=parsed.id?await reviseWaiterRequest({id:parsed.id,businessId:user.businessId,userId:user.id,revision:parsed.revision},values):await WaiterRequest.findOneAndUpdate({businessId:user.businessId,userId:user.id,submissionKey:parsed.submissionKey},{$setOnInsert:{...values,businessId:user.businessId,userId:user.id,waiterName:user.fullName,submissionKey:parsed.submissionKey}},{upsert:true,returnDocument:"after",setDefaultsOnInsert:true});
  if(!row)throw new Error("This order was confirmed or changed. Refresh before editing.");
  revalidatePath("/waiter");revalidatePath("/waiter-requests");
  return{ok:true as const,id:String(row._id)};
 }catch(error){return{ok:false as const,message:error instanceof z.ZodError?error.issues[0].message:saleSessionError(error)}}
}

// waiterId (QR orders only): the staff waiter who checked the order with the guest and will serve the table.
export async function confirmWaiterRequest(id:string,revision:number,waiterId=""){
 try{
  const user=await requirePermission("pos");
  if(!COUNTER_ROLES.includes(user.role))throw new Error("Only a cashier, supervisor, manager, admin or owner can confirm waiter orders.");
  orderIdSchema.parse(id);z.number().int().min(0).parse(revision);
  await connectToDatabase();
  const request=await WaiterRequest.findOne({_id:id,businessId:user.businessId,status:"PENDING",revision}).lean();
  if(!request)throw new Error("The waiter changed this order or it is already confirmed. Refresh and review it again.");
  const data=await context(orderInputSchema.parse(request.input));
  if(Math.abs(data.totals.grandTotal-request.summary.grandTotal)>0.005||Math.abs(data.totals.taxAmount-request.summary.taxAmount)>0.005)throw new Error("Menu prices or taxes changed. Ask the waiter to save the order again, then review the updated summary.");
  const qr=request.source==="QR";
  if(waiterId&&(!qr||!orderIdSchema.safeParse(waiterId).success))throw new Error("Choose a waiter from the list.");
  const waiter=waiterId?await Staff.findOne({_id:waiterId,businessId:user.businessId,isActive:true,role:"WAITER"}).select("fullName").lean():null;
  if(waiterId&&!waiter)throw new Error("The selected waiter is no longer available. Choose another waiter.");
  const order=await withSaleSession(user,async(sale,transaction)=>{
   const claimed=await claimWaiterRequest({id,businessId:user.businessId,revision},user.id,transaction);
   if(!claimed)throw new Error("The order changed. Refresh and review it again.");
   // A QR guest becomes (or matches) a customer by mobile number, so SMS updates and history work as for counter orders.
   const customer=qr&&request.guest?.phone?await guestCustomer(user.businessId,request.guest,transaction):null;
   const counter=await OrderCounter.findOneAndUpdate({businessId:user.businessId},{$inc:{sequence:1}},{returnDocument:"after",upsert:true,setDefaultsOnInsert:true,session:transaction});
   const [created]=await Order.create([{businessId:user.businessId,orderNumber:`ORD-${String(counter.sequence).padStart(6,"0")}`,orderType:"DINE_IN",status:"SENT_TO_KITCHEN",kitchenSentAt:new Date(),kitchenStatusSource:"MANUAL",saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,orderSource:qr?"QR":"WAITER",tableId:data.table?._id,tableNameSnapshot:data.table?.name,...(waiter?{waiterId:waiter._id}:{}),waiterNameSnapshot:qr?waiter?.fullName:request.waiterName,...(customer?{customerId:customer._id,customerSnapshot:{name:customer.name,phone:customer.phone}}:{}),createdByUserId:request.userId??user.id,cashierNameSnapshot:user.fullName,lastUpdatedByUserId:user.id,items:data.items,subtotal:data.totals.subtotal,taxAmount:data.totals.taxAmount,grandTotal:data.totals.grandTotal,dueAmount:data.totals.grandTotal,paymentTaxRatesSnapshot:data.paymentTaxRatesSnapshot,taxRateSnapshot:data.taxRateSnapshot,taxPaymentMethod:data.taxPaymentMethod}],{session:transaction});
   await WaiterRequest.updateOne({_id:id},{$set:{orderId:created._id}},{session:transaction});
   if(qr)await queueOrderStageSms(mongoose.connection.db!,created.toObject(),"ORDER_PLACED",new Date(),transaction);
   return created;
  });
  await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:qr?"CONFIRM_QR_ORDER":"CONFIRM_WAITER_ORDER",entityType:"Order",entityId:String(order._id),description:qr?`Confirmed QR order ${order.orderNumber} for ${order.tableNameSnapshot??"a table"}`:`Confirmed waiter order ${order.orderNumber}`});
  await notifyWaiterOrder(mongoose.connection.db!,order.toObject());
  for(const path of ["/waiter","/waiter-requests","/orders","/kitchen","/sale-sessions"])revalidatePath(path);
  return{ok:true as const,orderId:String(order._id),orderNumber:order.orderNumber,...await placedOrderPrints(user,"DINE_IN")};
 }catch(error){return{ok:false as const,message:saleSessionError(error)}}
}



async function guestCustomer(businessId:string,guest:{name?:string;phone?:string},session:ClientSession){
 const phone=String(guest.phone).replace(/^\+92/,"0"),name=String(guest.name||"Guest").slice(0,100);
 // Saved numbers may be typed as 0300-1234567 or +92 300 1234567; match on the last ten digits.
 const digits=phone.replace(/\D/g,"").slice(-10),pattern=new RegExp(digits.split("").join("[\\s().+-]*")+"$");
 const existing=await Customer.findOne({businessId,phone:pattern,isActive:true}).sort({createdAt:1}).session(session);
 if(existing)return existing;
 const[created]=await Customer.create([{businessId,name,phone,notes:"Added from a QR table order"}],{session});
 return created;
}

// Cashier rejects a pending QR order (a prank, a duplicate, or a guest who left). Waiter orders are edited by the waiter instead.
export async function cancelWaiterRequest(id:string,revision:number,reason:string){
 try{
  const user=await requirePermission("pos");
  if(!COUNTER_ROLES.includes(user.role))throw new Error("Only a cashier, supervisor, manager, admin or owner can cancel QR orders.");
  orderIdSchema.parse(id);z.number().int().min(0).parse(revision);
  const clean=z.string().trim().min(3,"Enter a reason of at least 3 characters.").max(300).parse(reason);
  await connectToDatabase();
  const row=await WaiterRequest.findOneAndUpdate({_id:id,businessId:user.businessId,source:"QR",status:"PENDING",revision},{$set:{status:"CANCELLED",cancelledAt:new Date(),cancelledByUserId:user.id,cancellationReason:clean},$inc:{revision:1}},{returnDocument:"after"});
  if(!row)throw new Error("This QR order was already approved, cancelled or changed. Refresh and check again.");
  await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"CANCEL_QR_ORDER",entityType:"WaiterRequest",entityId:id,description:`Cancelled QR order from ${row.tableName??"a table"} (${row.guest?.name??"guest"}): ${clean}`,metadata:{reason:clean}});
  revalidatePath("/waiter-requests");
  return{ok:true as const};
 }catch(error){return{ok:false as const,message:error instanceof z.ZodError?error.issues[0].message:saleSessionError(error)}}
}

async function context(input:OrderInput){const user=await requireUser();const parsed=orderInputSchema.safeParse(input);if(!parsed.success)throw new Error(parsed.error.issues[0]?.message??"Check the order details.");await connectToDatabase();const[table,waiter,customer]=await Promise.all([parsed.data.tableId?RestaurantTable.findOne({_id:parsed.data.tableId,businessId:user.businessId,isActive:true}).lean():null,parsed.data.waiterId?Staff.findOne({_id:parsed.data.waiterId,businessId:user.businessId,isActive:true,role:"WAITER"}).lean():null,parsed.data.customerId?Customer.findOne({_id:parsed.data.customerId,businessId:user.businessId,isActive:true}).lean():null]);if(parsed.data.tableId&&!table)throw new Error("Selected table is unavailable.");if(parsed.data.waiterId&&!waiter)throw new Error("Selected waiter is unavailable.");if(parsed.data.customerId&&!customer)throw new Error("Selected customer is unavailable.");const snapshots=await orderSnapshots(user.businessId,parsed.data);return{user,input:parsed.data,table,waiter,customer,...snapshots}}

// What the counter prints for an order that has just gone to the kitchen (orderType null: nothing, e.g. an edit).
async function placedOrderPrints(user:{businessId:string;role:string;permissions?:string[]}&Parameters<typeof can>[0],orderType:string|null){
 const business=orderType?await Business.findOne({_id:user.businessId,isActive:true}).select("printerMode onePrinterMode kitchenPrintingEnabled customerPrintingEnabled autoPrintUnpaidDineIn").lean():null,allowed=can(user,"printing");
 return{printKitchen:Boolean(allowed&&counterPrintsKitchen(business)),printBill:Boolean(allowed&&orderType==="DINE_IN"&&autoPrintsUnpaidBill(business)),printerMode:(business?.printerMode??"BROWSER") as "BROWSER"|"QZ"};
}

// Prices a saved order with its invoice discount, on the pre-tax amount left after any coupon. Staff without payment
// permission cannot change a discount, so their edits keep the one already on the order.
async function withInvoiceDiscount(data:Awaited<ReturnType<typeof context>>,input:DiscountInput|undefined,stored:(StoredDiscount&{appliedByUserId?:unknown;appliedByName?:string})|null|undefined,couponDiscount:number,session:ClientSession){
 const couponPriced=data.build(couponDiscount),coupon=couponPriced.totals.discountAmount,base=Math.max(0,couponPriced.totals.subtotal-coupon),allowed=can(data.user,"payments");
 if(input&&!allowed)throw new Error("Payment permission is required to give a discount.");
 const discount=allowed?(input?resolveInvoiceDiscount(withStoredDiscountType(await discountTypesFor(data.user.businessId,session),stored),input,base):null):rescaleDiscount(stored,base);
 if(!discount)return{priced:couponPriced,invoiceDiscount:undefined};
 const appliedBy=allowed?{appliedByUserId:data.user.id,appliedByName:data.user.fullName}:{appliedByUserId:stored?.appliedByUserId,appliedByName:stored?.appliedByName};
 return{priced:data.build(coupon+discount.amount),invoiceDiscount:{...discount,amountBefore:couponPriced.totals.grandTotal,...appliedBy}};
}

export async function saveOrder(input:OrderInput,orderId?:string,discount?:DiscountInput){try{await requirePermission(orderId?"edit_orders":"pos");const data=await context(input);if(!orderId&&data.input.orderType==="TAKEAWAY")throw new Error("Collect payment to place a takeaway order.");const order=await withSaleSession(data.user,async(sale,transaction)=>{let order;let wasDelivery=false;if(orderId){if(!orderIdSchema.safeParse(orderId).success)throw new Error("Invalid order.");order=await Order.findOne({_id:orderId,businessId:data.user.businessId,status:{$nin:["COMPLETED","CANCELLED"]}}).session(transaction);if(!order)throw new Error("This order cannot be edited.");if(order.paidAmount>0)throw new Error("A paid order cannot be edited.");wasDelivery=order.orderType==="DELIVERY";if(wasDelivery&&(["OUT_FOR_DELIVERY","DELIVERED"].includes(order.deliveryStatus)||order.status==="SERVED"))throw new Error("A dispatched delivery cannot be edited.");let priced={items:data.items,totals:data.totals};if(order.couponId){try{const held=await resolveCoupon({businessId:data.user.businessId,code:order.couponCode,customerId:data.customer?._id,saleDate:order.saleDate||sale.saleDate,subtotal:data.totals.subtotal,session:transaction,currentOrderId:String(order._id)});priced=data.build(held.discountAmount);await Coupon.updateOne({_id:order.couponId,orderId:order._id,status:"APPLIED"},{$set:{discountAmount:priced.totals.discountAmount}},{session:transaction})}catch{/* The edited order no longer qualifies, so the customer gets the coupon back. */await releaseOrderCoupon(data.user.businessId,order._id,transaction);Object.assign(order,{couponId:undefined,couponCode:undefined,couponSnapshot:undefined,discountType:"NONE",discountValue:0})}}const invoice=await withInvoiceDiscount(data,discount,order.toObject().invoiceDiscount,priced.totals.discountAmount,transaction);priced=invoice.priced;Object.assign(order,{invoiceDiscount:invoice.invoiceDiscount,discountAmount:priced.totals.discountAmount,deliveryStatus:data.input.orderType==="DELIVERY"?(wasDelivery?order.deliveryStatus??"PLACED":"PLACED"):undefined,deliveryPlacedAt:data.input.orderType==="DELIVERY"?(order.deliveryPlacedAt??new Date()):undefined,paymentTaxRatesSnapshot:data.paymentTaxRatesSnapshot,taxRateSnapshot:data.taxRateSnapshot,taxPaymentMethod:data.taxPaymentMethod,orderType:data.input.orderType,tableId:data.table?._id,tableNameSnapshot:data.table?.name,waiterId:data.waiter?._id,waiterNameSnapshot:data.waiter?.fullName,customerId:data.customer?._id,customerSnapshot:data.customer?{name:data.customer.name,phone:data.customer.phone,address:data.input.orderType==="DELIVERY"?data.input.deliveryAddress:data.customer.address,area:data.input.orderType==="DELIVERY"?data.input.deliveryArea:data.customer.area}:undefined,items:priced.items,subtotal:priced.totals.subtotal,taxAmount:priced.totals.taxAmount,deliveryChargeAmount:priced.totals.deliveryCharge,grandTotal:priced.totals.grandTotal,dueAmount:priced.totals.grandTotal-order.paidAmount,notes:data.input.deliveryNotes,lastUpdatedByUserId:data.user.id});await order.save({session:transaction})}else{const invoice=await withInvoiceDiscount(data,discount,null,0,transaction),{items,totals}=invoice.priced;const counter=await OrderCounter.findOneAndUpdate({businessId:data.user.businessId},{$inc:{sequence:1}},{returnDocument:"after",upsert:true,setDefaultsOnInsert:true,session:transaction});const orderNumber=`ORD-${String(counter.sequence).padStart(6,"0")}`;order=(await Order.create([{paymentTaxRatesSnapshot:data.paymentTaxRatesSnapshot,taxRateSnapshot:data.taxRateSnapshot,taxPaymentMethod:data.taxPaymentMethod,saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,businessId:data.user.businessId,orderNumber,orderType:data.input.orderType,status:"SENT_TO_KITCHEN",...(data.input.orderType==="DELIVERY"?{deliveryStatus:"PLACED",deliveryPlacedAt:new Date()}:{}),kitchenSentAt:new Date(),preparingAt:undefined,readyAt:undefined,kitchenStatusSource:"MANUAL",tableId:data.table?._id,tableNameSnapshot:data.table?.name,waiterId:data.waiter?._id,waiterNameSnapshot:data.waiter?.fullName,customerId:data.customer?._id,customerSnapshot:data.customer?{name:data.customer.name,phone:data.customer.phone,address:data.input.orderType==="DELIVERY"?data.input.deliveryAddress:data.customer.address,area:data.input.orderType==="DELIVERY"?data.input.deliveryArea:data.customer.area}:undefined,items,subtotal:totals.subtotal,discountAmount:totals.discountAmount,...(invoice.invoiceDiscount?{invoiceDiscount:invoice.invoiceDiscount}:{}),taxAmount:totals.taxAmount,deliveryChargeAmount:totals.deliveryCharge,grandTotal:totals.grandTotal,dueAmount:totals.grandTotal,createdByUserId:data.user.id,cashierNameSnapshot:data.user.fullName,openedAt:new Date(),notes:data.input.deliveryNotes}],{session:transaction}))[0]}if(data.input.orderType==="DELIVERY"&&!wasDelivery)await queueDeliverySms(order.toObject(),"DELIVERY_PLACED",new Date(),transaction);
 // Sent once per order: a customer added while editing still gets it, but not after the food is ready.
 if(["SENT_TO_KITCHEN","PREPARING"].includes(order.status))await queueOrderStageSms(mongoose.connection.db!,order.toObject(),"ORDER_PLACED",new Date(),transaction);return order;});await writeAuditLog({businessId:data.user.businessId,userId:data.user.id,userName:data.user.fullName,action:orderId?"UPDATE_ORDER":order.orderType==="TAKEAWAY"?"CREATE_ORDER":"CREATE_AND_SEND_ORDER",entityType:"Order",entityId:String(order._id),description:orderId?`Updated order ${order.orderNumber}`:order.orderType==="TAKEAWAY"?`Created order ${order.orderNumber} awaiting payment`:`Created and sent order ${order.orderNumber} to kitchen`,...(order.invoiceDiscount?.amount?{metadata:{invoiceDiscount:{name:order.invoiceDiscount.name,percent:order.invoiceDiscount.percent,amount:order.invoiceDiscount.amount,remarks:order.invoiceDiscount.remarks}}}:{})});revalidatePath("/orders");revalidatePath("/sale-sessions");revalidatePath(`/orders/${order._id}`);return{ok:true as const,orderId:String(order._id),orderNumber:order.orderNumber,grandTotal:order.grandTotal,...await placedOrderPrints(data.user,orderId?null:order.orderType)}}catch(error){return{ok:false as const,message:saleSessionError(error)}}}

export async function changeOrderStatus(id:string,next:"CONFIRMED"|"SENT_TO_KITCHEN"|"PREPARING"|"READY"|"SERVED"|"COMPLETED"){
 const user=await requirePermission("kitchen");if(!orderIdSchema.safeParse(id).success||!z.enum(["CONFIRMED","SENT_TO_KITCHEN","PREPARING","READY","SERVED","COMPLETED"]).safeParse(next).success)return{ok:false as const,message:"Invalid order status."};
 const allowed:Record<string,string[]>={CONFIRMED:["DRAFT"],SENT_TO_KITCHEN:["CONFIRMED"],PREPARING:["SENT_TO_KITCHEN"],READY:["SENT_TO_KITCHEN","PREPARING"],SERVED:["READY"],COMPLETED:["SERVED"]};if(!allowed[next])return;
 await connectToDatabase();const now=new Date(),updates:Record<string,unknown>={status:next,kitchenStatusSource:"MANUAL"};
 if(next==="SENT_TO_KITCHEN")updates.kitchenSentAt=now;if(next==="PREPARING")updates.preparingAt=now;if(next==="READY")updates.readyAt=now;if(next==="COMPLETED")updates.completedAt=now;
 const order=await Order.findOneAndUpdate({_id:id,businessId:user.businessId,status:{$in:allowed[next]},...(["SERVED","COMPLETED"].includes(next)?{orderType:{$ne:"DELIVERY"}}:{}),...(next==="COMPLETED"?{paymentStatus:"PAID"}:{}),...(next==="SENT_TO_KITCHEN"?{$or:[{orderType:{$ne:"TAKEAWAY"}},{paymentStatus:"PAID"}]}:{})},{$set:updates},{returnDocument:"before"}).lean();if(!order)return{ok:false as const,message:"The order changed or cannot move to this stage. Unpaid orders cannot be completed."};
 await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"ORDER_"+next,entityType:"Order",entityId:id,description:"Changed "+order.orderNumber+" from "+order.status+" to "+next});
 await notifyWaiterOrder(mongoose.connection.db!,{...order,status:next});
 // The order has already moved; a failed SMS queue must not report the kitchen update as failed.
 const smsType=({PREPARING:"ORDER_PREPARING",READY:"ORDER_READY",SERVED:"ORDER_SERVED",COMPLETED:"ORDER_COMPLETED"} as const)[next as "PREPARING"];
 if(smsType)await queueOrderStageSms(mongoose.connection.db!,{...order,status:next},smsType,now).catch(()=>{});
 revalidatePath("/orders");revalidatePath("/kitchen");revalidatePath("/orders/"+id);
 return{ok:true as const};
}

export async function cancelOrder(id:string,reason:string){const user=await requirePermission("cancel_orders");if(!orderIdSchema.safeParse(id).success)return{ok:false as const,message:"Invalid order."};const parsedReason=z.string().trim().min(3).max(500).safeParse(reason);if(!parsedReason.success)return{ok:false as const,message:"Enter a cancellation reason between 3 and 500 characters."};const clean=parsedReason.data;await connectToDatabase();const order=await mongoose.connection.transaction(async transaction=>{const cancelled=await Order.findOneAndUpdate({_id:id,businessId:user.businessId,status:{$nin:["COMPLETED","CANCELLED"]},paidAmount:0,paymentStatus:"UNPAID"},{$set:{status:"CANCELLED",cancelledAt:new Date(),cancelledByUserId:user.id,cancellationReason:clean}},{returnDocument:"after",session:transaction});if(cancelled?.couponId)await releaseOrderCoupon(user.businessId,cancelled._id,transaction);return cancelled});if(!order)return{ok:false as const,message:"Paid or completed orders cannot be cancelled."};await notifyWaiterOrder(mongoose.connection.db!,order.toObject());await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"CANCEL_ORDER",entityType:"Order",entityId:id,description:`Cancelled ${order.orderNumber}: ${clean}`,metadata:{reason:clean,saleDate:order.saleDate}});revalidatePath("/orders");revalidatePath("/sale-sessions");revalidatePath(`/orders/${id}`);return{ok:true as const}}

const takeawayPaymentSchema=paymentInputSchema;
// Repeated wrong codes are throttled so staff accounts cannot be used to guess coupons.
async function checkCouponAttempts(userId:string){if(!(await allowAuthAttempt("coupon-lookup:"+userId,40)))throw new Error("Too many coupon checks. Wait five minutes and try again.")}
async function discountTypesFor(businessId:string,session?:ClientSession){const business=await Business.findOne({_id:businessId,isActive:true}).select("invoiceDiscountEnabled discountTypes").session(session??null).lean();return business?businessDiscountTypes(business):[]}
export async function previewTakeawayPayment(input:OrderInput,discountInput?:DiscountInput){
 try{await requirePermission("pos");await requirePermission("payments");const data=await context(input);if(data.input.orderType!=="TAKEAWAY")throw new Error("Invalid takeaway order.");
 let priced={items:data.items,totals:data.totals},coupon:{code:string;description:string;discountAmount:number}|null=null,couponError="";
 const couponOnPayment=await couponsAllowed(data.user.businessId);
 if(data.input.couponCode&&!couponOnPayment)couponError=COUPONS_OFF_MESSAGE;
 else if(data.input.couponCode){try{await checkCouponAttempts(data.user.id);const saleDate=(await activeSaleSession(data.user))?.saleDate??dateISO();const resolved=await resolveCoupon({businessId:data.user.businessId,code:data.input.couponCode,customerId:data.customer?._id,saleDate,subtotal:data.totals.subtotal});priced=data.build(resolved.discountAmount);coupon={code:String(resolved.coupon.code),description:resolved.description,discountAmount:priced.totals.discountAmount}}catch(error){couponError=error instanceof Error&&error.constructor===Error?error.message:"Could not check this coupon."}}
 // The invoice discount stacks on the coupon: a percentage of the pre-tax amount left after it.
 const discountTypes=discountInput?await discountTypesFor(data.user.businessId):[];let invoiceDiscount:AppliedDiscount|null=null,discountError="";
 if(discountInput)try{const couponDiscount=priced.totals.discountAmount;invoiceDiscount=resolveInvoiceDiscount(discountTypes,discountInput,Math.max(0,priced.totals.subtotal-couponDiscount),{requireRemarks:false});priced=data.build(couponDiscount+invoiceDiscount.amount)}catch(error){discountError=error instanceof Error?error.message:"Could not apply this discount."}
 return{ok:true as const,couponOnPayment,invoiceDiscount,discountError,subtotal:priced.totals.subtotal,discountAmount:priced.totals.discountAmount,taxAmount:priced.totals.taxAmount,grandTotal:priced.totals.grandTotal,dueAmount:priced.totals.grandTotal,taxRate:data.taxRateSnapshot,method:data.taxPaymentMethod,coupon,couponError,prefillDue:await paymentPrefillDue(data.user.businessId)}}catch(error){return{ok:false as const,message:saleSessionError(error)}}
}
export async function completeTakeawayPayment(input:OrderInput,paymentInput:z.input<typeof takeawayPaymentSchema>){
 try{
 await requirePermission("pos");await requirePermission("payments");const payment=takeawayPaymentSchema.parse(paymentInput),data=await context({...input,paymentMethod:payment.method});
 if(data.input.orderType!=="TAKEAWAY")throw new Error("Invalid takeaway order.");
 const tendered=Math.round(payment.tenderedAmount*100)/100;
 const result=await withSaleSession(data.user,async(sale,transaction)=>{
 if(await Payment.exists({businessId:data.user.businessId,idempotencyKey:payment.idempotencyKey}).session(transaction))throw new Error("This payment was already submitted. Check orders before retrying.");
 // The coupon is checked against the open sale's business date inside the payment transaction.
 if(data.input.couponCode&&!await couponsAllowed(data.user.businessId,transaction))throw new Error(COUPONS_OFF_MESSAGE);
 const coupon=data.input.couponCode?await resolveCoupon({businessId:data.user.businessId,code:data.input.couponCode,customerId:data.customer?._id,saleDate:sale.saleDate,subtotal:data.totals.subtotal,session:transaction}):null;
 const couponPriced=coupon?data.build(coupon.discountAmount):{items:data.items,totals:data.totals},couponDiscount=couponPriced.totals.discountAmount;
 const discount=payment.discount?resolveInvoiceDiscount(await discountTypesFor(data.user.businessId,transaction),payment.discount,Math.max(0,couponPriced.totals.subtotal-couponDiscount)):null;
 const priced=discount?data.build(couponDiscount+discount.amount):couponPriced,total=priced.totals.grandTotal;
 if(Math.abs(total-payment.expectedGrandTotal)>0.005)throw new Error("The invoice changed. Refresh totals before receiving payment.");
 if(total<=0||tendered<total||(payment.method!=="CASH"&&tendered!==total))throw new Error("Check the payment amount.");
 const change=payment.method==="CASH"?Math.round((tendered-total)*100)/100:0;
 const counter=await OrderCounter.findOneAndUpdate({businessId:data.user.businessId},{$inc:{sequence:1}},{returnDocument:"after",upsert:true,setDefaultsOnInsert:true,session:transaction});
 const now=new Date();
 const [created]=await Order.create([{businessId:data.user.businessId,orderNumber:"ORD-"+String(counter.sequence).padStart(6,"0"),orderType:"TAKEAWAY",status:"SENT_TO_KITCHEN",kitchenSentAt:now,kitchenStatusSource:"MANUAL",saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,collectedInSessionId:sale._id,customerId:data.customer?._id,customerSnapshot:data.customer?{name:data.customer.name,phone:data.customer.phone,address:data.customer.address,area:data.customer.area}:undefined,items:priced.items,subtotal:priced.totals.subtotal,discountAmount:priced.totals.discountAmount,...(coupon?{discountType:coupon.batch.discountType,discountValue:coupon.batch.discountValue,couponId:coupon.coupon._id,couponCode:coupon.coupon.code,couponSnapshot:coupon.snapshot}:{}),...(discount?{invoiceDiscount:{...discount,amountBefore:couponPriced.totals.grandTotal,appliedByUserId:data.user.id,appliedByName:data.user.fullName}}:{}),taxAmount:priced.totals.taxAmount,grandTotal:total,paidAmount:total,dueAmount:0,paymentStatus:"PAID",paymentTaxRatesSnapshot:data.paymentTaxRatesSnapshot,taxRateSnapshot:data.taxRateSnapshot,taxPaymentMethod:payment.method,createdByUserId:data.user.id,cashierNameSnapshot:data.user.fullName,openedAt:now}],{session:transaction});
 if(coupon)await claimCoupon(coupon.coupon._id,{orderId:created._id,orderNumber:created.orderNumber,status:"REDEEMED",discountAmount:couponDiscount},transaction);
 await Payment.create([{businessId:data.user.businessId,saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,orderId:created._id,idempotencyKey:payment.idempotencyKey,amount:total,tenderedAmount:tendered,changeAmount:change,method:payment.method,reference:payment.reference||undefined,notes:payment.notes||undefined,receivedByUserId:data.user.id,receivedByNameSnapshot:data.user.fullName,paidAt:now}],{session:transaction});
 const issued=await autoIssueCoupons(created.toObject(),sale.saleDate,transaction);
 await queueOrderStageSms(mongoose.connection.db!,created.toObject(),"ORDER_PLACED",now,transaction);
 await queuePaymentSms(created.toObject(),now,transaction);
 if(discount)await queueDiscountSms(created.toObject(),{amountBefore:couponPriced.totals.grandTotal,discount,amountAfter:total,cashier:data.user.fullName},transaction);
 return{order:created,total,change,issued,discount,couponCode:coupon?String(coupon.coupon.code):null};
 });
 const{order,total,change,issued}=result;
 await writeAuditLog({businessId:data.user.businessId,userId:data.user.id,userName:data.user.fullName,action:"COMPLETE_PAYMENT",entityType:"Order",entityId:String(order._id),description:"Created paid takeaway order "+order.orderNumber+" and sent to kitchen",metadata:{amount:total,method:payment.method,change,saleDate:order.saleDate,sentToKitchen:true,...(result.couponCode?{couponCode:result.couponCode,discountAmount:order.discountAmount}:{}),...(issued.length?{issuedCoupons:issued.map(item=>item.code)}:{}),...(result.discount?{invoiceDiscount:{name:result.discount.name,percent:result.discount.percent,amount:result.discount.amount,remarks:result.discount.remarks}}:{})}});
 const business=await Business.findOne({_id:data.user.businessId,isActive:true}).lean();
 for(const path of ["/orders","/kitchen","/sale-sessions","/sales","/reports","/reports/profit-loss","/dashboard","/coupons","/reports/discounts"])revalidatePath(path);
 return{ok:true as const,orderId:String(order._id),orderNumber:order.orderNumber,amount:total,change,issuedCoupons:issued.map(item=>({code:item.code,batchName:item.batchName,description:item.description})),autoPrint:Boolean(can(data.user,"printing")&&business?.autoPrintCustomerOnPayment&&business.customerPrintingEnabled!==false),printKitchen:Boolean(can(data.user,"printing")&&counterPrintsKitchen(business)),cashDrawer:cashDrawerFor(business,payment.method),printerMode:(business?.printerMode??"BROWSER") as "BROWSER"|"QZ"};
 }catch(error){return{ok:false as const,message:saleSessionError(error)}}
}
