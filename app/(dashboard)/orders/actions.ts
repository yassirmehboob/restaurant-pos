"use server";
import { requirePermission } from "@/data/auth";

import { withSaleSession,saleSessionError } from "@/lib/sale-sessions";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/data/auth";
import { writeAuditLog } from "@/lib/audit";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { maxPreparationMinutes } from "@/lib/preparation-time";
import { businessTaxRates } from "@/lib/tax";
import { paymentPrefillDue } from "@/lib/payment-settings";
import { calculateOrderPreview,type PricedLine } from "@/lib/order-calculation";
import { orderIdSchema,orderInputSchema,type OrderInput } from "@/lib/validation/order";
import { Coupon } from "@/models/Coupon";
import { Customer } from "@/models/Customer";
import { Deal } from "@/models/Deal";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";
import { paymentInputSchema } from "@/lib/validation/payment";
import { can } from "@/lib/permissions";
import { z } from "zod";
import { OrderCounter } from "@/models/OrderCounter";
import { Product } from "@/models/Product";
import { RestaurantTable } from "@/models/RestaurantTable";
import { Staff } from "@/models/Staff";
import { WaiterRequest } from "@/models/WaiterRequest";
import { waiterRequestSchema } from "@/lib/validation/waiter";
import mongoose from "mongoose";
import { notifyWaiterOrder } from "@/lib/waiter-push.mjs";
import { reviseWaiterRequest,claimWaiterRequest } from "@/lib/waiter-requests";
import { queuePaymentSms } from "@/lib/payment-sms";
import { queueDeliverySms } from "@/lib/delivery-sms";
import { autoIssueCoupons,claimCoupon,releaseOrderCoupon,resolveCoupon } from "@/lib/coupon-service";
import { activeSaleSession } from "@/lib/sale-sessions";
import { dateISO } from "@/lib/dates";
import { allowAuthAttempt } from "@/lib/auth/two-factor";

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
  const values={input:data.input,tableName:data.table?.name,displayLines:data.items.map(item=>({name:item.nameSnapshot,quantity:item.quantity,note:item.notes??""})),summary:{subtotal:data.totals.subtotal,taxAmount:data.totals.taxAmount,grandTotal:data.totals.grandTotal}};
  const row=parsed.id?await reviseWaiterRequest({id:parsed.id,businessId:user.businessId,userId:user.id,revision:parsed.revision},values):await WaiterRequest.findOneAndUpdate({businessId:user.businessId,userId:user.id,submissionKey:parsed.submissionKey},{$setOnInsert:{...values,businessId:user.businessId,userId:user.id,waiterName:user.fullName,submissionKey:parsed.submissionKey}},{upsert:true,returnDocument:"after",setDefaultsOnInsert:true});
  if(!row)throw new Error("This order was confirmed or changed. Refresh before editing.");
  revalidatePath("/waiter");revalidatePath("/waiter-requests");
  return{ok:true as const,id:String(row._id)};
 }catch(error){return{ok:false as const,message:error instanceof z.ZodError?error.issues[0].message:saleSessionError(error)}}
}

export async function confirmWaiterRequest(id:string,revision:number){
 try{
  const user=await requirePermission("pos");
  if(!["OWNER","ADMIN","CASHIER"].includes(user.role))throw new Error("Only a cashier, admin or owner can confirm waiter orders.");
  orderIdSchema.parse(id);z.number().int().min(0).parse(revision);
  await connectToDatabase();
  const request=await WaiterRequest.findOne({_id:id,businessId:user.businessId,status:"PENDING",revision}).lean();
  if(!request)throw new Error("The waiter changed this order or it is already confirmed. Refresh and review it again.");
  const data=await context(orderInputSchema.parse(request.input));
  if(Math.abs(data.totals.grandTotal-request.summary.grandTotal)>0.005||Math.abs(data.totals.taxAmount-request.summary.taxAmount)>0.005)throw new Error("Menu prices or taxes changed. Ask the waiter to save the order again, then review the updated summary.");
  const order=await withSaleSession(user,async(sale,transaction)=>{
   const claimed=await claimWaiterRequest({id,businessId:user.businessId,revision},user.id,transaction);
   if(!claimed)throw new Error("The order changed. Refresh and review it again.");
   const counter=await OrderCounter.findOneAndUpdate({businessId:user.businessId},{$inc:{sequence:1}},{returnDocument:"after",upsert:true,setDefaultsOnInsert:true,session:transaction});
   const [created]=await Order.create([{businessId:user.businessId,orderNumber:`ORD-${String(counter.sequence).padStart(6,"0")}`,orderType:"DINE_IN",status:"SENT_TO_KITCHEN",kitchenSentAt:new Date(),kitchenStatusSource:"MANUAL",saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,tableId:data.table?._id,tableNameSnapshot:data.table?.name,waiterNameSnapshot:request.waiterName,createdByUserId:request.userId,lastUpdatedByUserId:user.id,items:data.items,subtotal:data.totals.subtotal,taxAmount:data.totals.taxAmount,grandTotal:data.totals.grandTotal,dueAmount:data.totals.grandTotal,paymentTaxRatesSnapshot:data.paymentTaxRatesSnapshot,taxRateSnapshot:data.taxRateSnapshot,taxPaymentMethod:data.taxPaymentMethod}],{session:transaction});
   await WaiterRequest.updateOne({_id:id},{$set:{orderId:created._id}},{session:transaction});
   return created;
  });
  await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"CONFIRM_WAITER_ORDER",entityType:"Order",entityId:String(order._id),description:`Confirmed waiter order ${order.orderNumber}`});
  await notifyWaiterOrder(mongoose.connection.db!,order.toObject());
  for(const path of ["/waiter","/waiter-requests","/orders","/kitchen"])revalidatePath(path);
  return{ok:true as const};
 }catch(error){return{ok:false as const,message:saleSessionError(error)}}
}

async function orderSnapshots(businessId:string,input:OrderInput){
  const productIds=input.lines.filter(line=>line.kind==="PRODUCT").map(line=>line.id),dealIds=input.lines.filter(line=>line.kind==="DEAL").map(line=>line.id);
  const[products,deals]=await Promise.all([Product.find({_id:{$in:productIds},businessId,isActive:true,isAvailable:true}).lean(),Deal.find({_id:{$in:dealIds},businessId,isActive:true,isAvailable:true}).lean()]);
  const componentIds=deals.flatMap(deal=>deal.items.map((item:{productId:unknown})=>item.productId));
  const components=await Product.find({_id:{$in:componentIds},businessId}).lean();
  const productMap=new Map(products.map(row=>[String(row._id),row])),dealMap=new Map(deals.map(row=>[String(row._id),row])),componentMap=new Map(components.map(row=>[String(row._id),row]));
  if(productMap.size!==new Set(productIds).size||dealMap.size!==new Set(dealIds).size)throw new Error("An item or deal is no longer available.");
  const priced:PricedLine[]=input.lines.map(line=>{const row=line.kind==="PRODUCT"?productMap.get(line.id):dealMap.get(line.id);if(!row)throw new Error("Catalog record unavailable.");const variant=line.kind==="PRODUCT"&&line.variantName?row.variants?.find((item:{name:string})=>item.name.toLowerCase()===line.variantName!.toLowerCase()):undefined;if(line.kind==="PRODUCT"&&line.variantName&&!variant)throw new Error(`The selected size for ${row.name} is unavailable.`);return{key:`${line.kind}:${line.id}:${line.variantName??""}`,name:variant?`${row.name} (${variant.name})`:row.name,quantity:line.quantity,unitPrice:variant?.salePrice??row.salePrice,taxRate:line.kind==="PRODUCT"?row.taxRate:0,isTaxInclusive:line.kind==="PRODUCT"?row.isTaxInclusive:false}});
  const business=await Business.findOne({_id:businessId,isActive:true}).lean();if(!business)throw new Error("Business unavailable.");
  const paymentTaxRatesSnapshot=businessTaxRates(business),taxRateSnapshot=paymentTaxRatesSnapshot?.[input.paymentMethod],taxPaymentMethod=input.paymentMethod;
  // build(discount) re-prices the same snapshot lines with a coupon discount, without reloading the catalog.
  const build=(discount=0)=>{
  const totals=calculateOrderPreview(priced,input.orderType==="DELIVERY"?input.deliveryCharge:0,taxRateSnapshot,discount);
  const items=totals.lines.map((calculated,index)=>{const source=input.lines[index];if(source.kind==="PRODUCT"){const row=productMap.get(source.id)!,variant=source.variantName?row.variants?.find((item:{name:string})=>item.name.toLowerCase()===source.variantName!.toLowerCase()):undefined;return{lineId:source.lineId||randomUUID(),itemType:"PRODUCT",productId:row._id,preparationTimeMinutesSnapshot:row.preparationTimeMinutes??null,nameSnapshot:variant?`${row.name} (${variant.name})`:row.name,variantNameSnapshot:variant?.name,imageUrlSnapshot:row.imageUrl,quantity:source.quantity,unitPrice:variant?.salePrice??row.salePrice,unitCost:variant?.costPrice??row.costPrice,itemTaxRateSnapshot:row.taxRate??0,taxRate:calculated.taxRate,isTaxInclusive:calculated.isTaxInclusive,discountAmount:calculated.discountAmount,lineSubtotal:calculated.baseAmount,lineTax:calculated.taxAmount,lineTotal:calculated.lineTotal,notes:source.note||undefined,dealItemsSnapshot:[]}}const row=dealMap.get(source.id)!;const dealItemsSnapshot=row.items.map((component:{productId:unknown;quantity:number})=>{const product=componentMap.get(String(component.productId));return{productId:product?._id,name:product?.name??"Unavailable item",quantity:component.quantity,unitCost:product?.costPrice??0}});const unitCost=dealItemsSnapshot.reduce((sum:number,item:{quantity:number;unitCost:number})=>sum+item.quantity*item.unitCost,0);return{lineId:source.lineId||randomUUID(),itemType:"DEAL",dealId:row._id,preparationTimeMinutesSnapshot:maxPreparationMinutes(row.items.map((component:{productId:unknown})=>componentMap.get(String(component.productId))?.preparationTimeMinutes)),nameSnapshot:row.name,imageUrlSnapshot:row.imageUrl,quantity:source.quantity,unitPrice:row.salePrice,unitCost,itemTaxRateSnapshot:0,taxRate:calculated.taxRate,isTaxInclusive:calculated.isTaxInclusive,discountAmount:calculated.discountAmount,lineSubtotal:calculated.baseAmount,lineTax:calculated.taxAmount,lineTotal:calculated.lineTotal,notes:source.note||undefined,dealItemsSnapshot}});
  return{items,totals}};
  return{...build(),build,paymentTaxRatesSnapshot,taxRateSnapshot,taxPaymentMethod};
}

async function context(input:OrderInput){const user=await requireUser();const parsed=orderInputSchema.safeParse(input);if(!parsed.success)throw new Error(parsed.error.issues[0]?.message??"Check the order details.");await connectToDatabase();const[table,waiter,customer]=await Promise.all([parsed.data.tableId?RestaurantTable.findOne({_id:parsed.data.tableId,businessId:user.businessId,isActive:true}).lean():null,parsed.data.waiterId?Staff.findOne({_id:parsed.data.waiterId,businessId:user.businessId,isActive:true,role:"WAITER"}).lean():null,parsed.data.customerId?Customer.findOne({_id:parsed.data.customerId,businessId:user.businessId,isActive:true}).lean():null]);if(parsed.data.tableId&&!table)throw new Error("Selected table is unavailable.");if(parsed.data.waiterId&&!waiter)throw new Error("Selected waiter is unavailable.");if(parsed.data.customerId&&!customer)throw new Error("Selected customer is unavailable.");const snapshots=await orderSnapshots(user.businessId,parsed.data);return{user,input:parsed.data,table,waiter,customer,...snapshots}}

export async function saveOrder(input:OrderInput,orderId?:string){try{await requirePermission(orderId?"edit_orders":"pos");const data=await context(input);if(!orderId&&data.input.orderType==="TAKEAWAY")throw new Error("Collect payment to place a takeaway order.");const order=await withSaleSession(data.user,async(sale,transaction)=>{let order;let wasDelivery=false;if(orderId){if(!orderIdSchema.safeParse(orderId).success)throw new Error("Invalid order.");order=await Order.findOne({_id:orderId,businessId:data.user.businessId,status:{$nin:["COMPLETED","CANCELLED"]}}).session(transaction);if(!order)throw new Error("This order cannot be edited.");if(order.paidAmount>0)throw new Error("A paid order cannot be edited.");wasDelivery=order.orderType==="DELIVERY";if(wasDelivery&&(["OUT_FOR_DELIVERY","DELIVERED"].includes(order.deliveryStatus)||order.status==="SERVED"))throw new Error("A dispatched delivery cannot be edited.");let priced={items:data.items,totals:data.totals};if(order.couponId){try{const held=await resolveCoupon({businessId:data.user.businessId,code:order.couponCode,customerId:data.customer?._id,saleDate:order.saleDate||sale.saleDate,subtotal:data.totals.subtotal,session:transaction,currentOrderId:String(order._id)});priced=data.build(held.discountAmount);await Coupon.updateOne({_id:order.couponId,orderId:order._id,status:"APPLIED"},{$set:{discountAmount:priced.totals.discountAmount}},{session:transaction})}catch{/* The edited order no longer qualifies, so the customer gets the coupon back. */await releaseOrderCoupon(data.user.businessId,order._id,transaction);Object.assign(order,{couponId:undefined,couponCode:undefined,couponSnapshot:undefined,discountType:"NONE",discountValue:0})}}Object.assign(order,{discountAmount:priced.totals.discountAmount,deliveryStatus:data.input.orderType==="DELIVERY"?(wasDelivery?order.deliveryStatus??"PLACED":"PLACED"):undefined,deliveryPlacedAt:data.input.orderType==="DELIVERY"?(order.deliveryPlacedAt??new Date()):undefined,paymentTaxRatesSnapshot:data.paymentTaxRatesSnapshot,taxRateSnapshot:data.taxRateSnapshot,taxPaymentMethod:data.taxPaymentMethod,orderType:data.input.orderType,tableId:data.table?._id,tableNameSnapshot:data.table?.name,waiterId:data.waiter?._id,waiterNameSnapshot:data.waiter?.fullName,customerId:data.customer?._id,customerSnapshot:data.customer?{name:data.customer.name,phone:data.customer.phone,address:data.input.orderType==="DELIVERY"?data.input.deliveryAddress:data.customer.address,area:data.input.orderType==="DELIVERY"?data.input.deliveryArea:data.customer.area}:undefined,items:priced.items,subtotal:priced.totals.subtotal,taxAmount:priced.totals.taxAmount,deliveryChargeAmount:priced.totals.deliveryCharge,grandTotal:priced.totals.grandTotal,dueAmount:priced.totals.grandTotal-order.paidAmount,notes:data.input.deliveryNotes,lastUpdatedByUserId:data.user.id});await order.save({session:transaction})}else{const counter=await OrderCounter.findOneAndUpdate({businessId:data.user.businessId},{$inc:{sequence:1}},{returnDocument:"after",upsert:true,setDefaultsOnInsert:true,session:transaction});const orderNumber=`ORD-${String(counter.sequence).padStart(6,"0")}`;order=(await Order.create([{paymentTaxRatesSnapshot:data.paymentTaxRatesSnapshot,taxRateSnapshot:data.taxRateSnapshot,taxPaymentMethod:data.taxPaymentMethod,saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,businessId:data.user.businessId,orderNumber,orderType:data.input.orderType,status:"SENT_TO_KITCHEN",...(data.input.orderType==="DELIVERY"?{deliveryStatus:"PLACED",deliveryPlacedAt:new Date()}:{}),kitchenSentAt:new Date(),preparingAt:undefined,readyAt:undefined,kitchenStatusSource:"MANUAL",tableId:data.table?._id,tableNameSnapshot:data.table?.name,waiterId:data.waiter?._id,waiterNameSnapshot:data.waiter?.fullName,customerId:data.customer?._id,customerSnapshot:data.customer?{name:data.customer.name,phone:data.customer.phone,address:data.input.orderType==="DELIVERY"?data.input.deliveryAddress:data.customer.address,area:data.input.orderType==="DELIVERY"?data.input.deliveryArea:data.customer.area}:undefined,items:data.items,subtotal:data.totals.subtotal,taxAmount:data.totals.taxAmount,deliveryChargeAmount:data.totals.deliveryCharge,grandTotal:data.totals.grandTotal,dueAmount:data.totals.grandTotal,createdByUserId:data.user.id,openedAt:new Date(),notes:data.input.deliveryNotes}],{session:transaction}))[0]}if(data.input.orderType==="DELIVERY"&&!wasDelivery)await queueDeliverySms(order.toObject(),"DELIVERY_PLACED",new Date(),transaction);return order;});await writeAuditLog({businessId:data.user.businessId,userId:data.user.id,userName:data.user.fullName,action:orderId?"UPDATE_ORDER":order.orderType==="TAKEAWAY"?"CREATE_ORDER":"CREATE_AND_SEND_ORDER",entityType:"Order",entityId:String(order._id),description:orderId?`Updated order ${order.orderNumber}`:order.orderType==="TAKEAWAY"?`Created order ${order.orderNumber} awaiting payment`:`Created and sent order ${order.orderNumber} to kitchen`});revalidatePath("/orders");revalidatePath(`/orders/${order._id}`);return{ok:true as const,orderId:String(order._id),orderNumber:order.orderNumber,grandTotal:order.grandTotal}}catch(error){return{ok:false as const,message:saleSessionError(error)}}}

export async function changeOrderStatus(id:string,next:"CONFIRMED"|"SENT_TO_KITCHEN"|"PREPARING"|"READY"|"SERVED"|"COMPLETED"){
 const user=await requirePermission("kitchen");if(!orderIdSchema.safeParse(id).success||!z.enum(["CONFIRMED","SENT_TO_KITCHEN","PREPARING","READY","SERVED","COMPLETED"]).safeParse(next).success)return{ok:false as const,message:"Invalid order status."};
 const allowed:Record<string,string[]>={CONFIRMED:["DRAFT"],SENT_TO_KITCHEN:["CONFIRMED"],PREPARING:["SENT_TO_KITCHEN"],READY:["SENT_TO_KITCHEN","PREPARING"],SERVED:["READY"],COMPLETED:["SERVED"]};if(!allowed[next])return;
 await connectToDatabase();const now=new Date(),updates:Record<string,unknown>={status:next,kitchenStatusSource:"MANUAL"};
 if(next==="SENT_TO_KITCHEN")updates.kitchenSentAt=now;if(next==="PREPARING")updates.preparingAt=now;if(next==="READY")updates.readyAt=now;if(next==="COMPLETED")updates.completedAt=now;
 const order=await Order.findOneAndUpdate({_id:id,businessId:user.businessId,status:{$in:allowed[next]},...(["SERVED","COMPLETED"].includes(next)?{orderType:{$ne:"DELIVERY"}}:{}),...(next==="COMPLETED"?{paymentStatus:"PAID"}:{}),...(next==="SENT_TO_KITCHEN"?{$or:[{orderType:{$ne:"TAKEAWAY"}},{paymentStatus:"PAID"}]}:{})},{$set:updates},{returnDocument:"before"}).lean();if(!order)return{ok:false as const,message:"The order changed or cannot move to this stage. Unpaid orders cannot be completed."};
 await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"ORDER_"+next,entityType:"Order",entityId:id,description:"Changed "+order.orderNumber+" from "+order.status+" to "+next});
 await notifyWaiterOrder(mongoose.connection.db!,{...order,status:next});
 revalidatePath("/orders");revalidatePath("/kitchen");revalidatePath("/orders/"+id);
 return{ok:true as const};
}

export async function cancelOrder(id:string,reason:string){const user=await requirePermission("cancel_orders");if(!orderIdSchema.safeParse(id).success)return{ok:false as const,message:"Invalid order."};const parsedReason=z.string().trim().min(3).max(500).safeParse(reason);if(!parsedReason.success)return{ok:false as const,message:"Enter a cancellation reason between 3 and 500 characters."};const clean=parsedReason.data;await connectToDatabase();const order=await mongoose.connection.transaction(async transaction=>{const cancelled=await Order.findOneAndUpdate({_id:id,businessId:user.businessId,status:{$nin:["COMPLETED","CANCELLED"]},paidAmount:0,paymentStatus:"UNPAID"},{$set:{status:"CANCELLED",cancelledAt:new Date(),cancelledByUserId:user.id,cancellationReason:clean}},{returnDocument:"after",session:transaction});if(cancelled?.couponId)await releaseOrderCoupon(user.businessId,cancelled._id,transaction);return cancelled});if(!order)return{ok:false as const,message:"Paid or completed orders cannot be cancelled."};await notifyWaiterOrder(mongoose.connection.db!,order.toObject());await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"CANCEL_ORDER",entityType:"Order",entityId:id,description:`Cancelled ${order.orderNumber}: ${clean}`,metadata:{reason:clean,saleDate:order.saleDate}});revalidatePath("/orders");revalidatePath(`/orders/${id}`);return{ok:true as const}}

const takeawayPaymentSchema=paymentInputSchema;
// Repeated wrong codes are throttled so staff accounts cannot be used to guess coupons.
async function checkCouponAttempts(userId:string){if(!(await allowAuthAttempt("coupon-lookup:"+userId,40)))throw new Error("Too many coupon checks. Wait five minutes and try again.")}
export async function previewTakeawayPayment(input:OrderInput){
 try{await requirePermission("pos");await requirePermission("payments");const data=await context(input);if(data.input.orderType!=="TAKEAWAY")throw new Error("Invalid takeaway order.");
 let priced={items:data.items,totals:data.totals},coupon:{code:string;description:string;discountAmount:number}|null=null,couponError="";
 if(data.input.couponCode){try{await checkCouponAttempts(data.user.id);const saleDate=(await activeSaleSession(data.user))?.saleDate??dateISO();const resolved=await resolveCoupon({businessId:data.user.businessId,code:data.input.couponCode,customerId:data.customer?._id,saleDate,subtotal:data.totals.subtotal});priced=data.build(resolved.discountAmount);coupon={code:String(resolved.coupon.code),description:resolved.description,discountAmount:priced.totals.discountAmount}}catch(error){couponError=error instanceof Error&&error.constructor===Error?error.message:"Could not check this coupon."}}
 return{ok:true as const,subtotal:priced.totals.subtotal,discountAmount:priced.totals.discountAmount,taxAmount:priced.totals.taxAmount,grandTotal:priced.totals.grandTotal,dueAmount:priced.totals.grandTotal,taxRate:data.taxRateSnapshot,method:data.taxPaymentMethod,coupon,couponError,prefillDue:await paymentPrefillDue(data.user.businessId)}}catch(error){return{ok:false as const,message:saleSessionError(error)}}
}
export async function completeTakeawayPayment(input:OrderInput,paymentInput:z.infer<typeof takeawayPaymentSchema>){
 try{
 await requirePermission("pos");await requirePermission("payments");const payment=takeawayPaymentSchema.parse(paymentInput),data=await context({...input,paymentMethod:payment.method});
 if(data.input.orderType!=="TAKEAWAY")throw new Error("Invalid takeaway order.");
 const tendered=Math.round(payment.tenderedAmount*100)/100;
 const result=await withSaleSession(data.user,async(sale,transaction)=>{
 if(await Payment.exists({businessId:data.user.businessId,idempotencyKey:payment.idempotencyKey}).session(transaction))throw new Error("This payment was already submitted. Check orders before retrying.");
 // The coupon is checked against the open sale's business date inside the payment transaction.
 const coupon=data.input.couponCode?await resolveCoupon({businessId:data.user.businessId,code:data.input.couponCode,customerId:data.customer?._id,saleDate:sale.saleDate,subtotal:data.totals.subtotal,session:transaction}):null;
 const priced=coupon?data.build(coupon.discountAmount):{items:data.items,totals:data.totals},total=priced.totals.grandTotal;
 if(Math.abs(total-payment.expectedGrandTotal)>0.005)throw new Error("The invoice changed. Refresh totals before receiving payment.");
 if(total<=0||tendered<total||(payment.method!=="CASH"&&tendered!==total))throw new Error("Check the payment amount.");
 const change=payment.method==="CASH"?Math.round((tendered-total)*100)/100:0;
 const counter=await OrderCounter.findOneAndUpdate({businessId:data.user.businessId},{$inc:{sequence:1}},{returnDocument:"after",upsert:true,setDefaultsOnInsert:true,session:transaction});
 const now=new Date();
 const [created]=await Order.create([{businessId:data.user.businessId,orderNumber:"ORD-"+String(counter.sequence).padStart(6,"0"),orderType:"TAKEAWAY",status:"SENT_TO_KITCHEN",kitchenSentAt:now,kitchenStatusSource:"MANUAL",saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,collectedInSessionId:sale._id,customerId:data.customer?._id,customerSnapshot:data.customer?{name:data.customer.name,phone:data.customer.phone,address:data.customer.address,area:data.customer.area}:undefined,items:priced.items,subtotal:priced.totals.subtotal,discountAmount:priced.totals.discountAmount,...(coupon?{discountType:coupon.batch.discountType,discountValue:coupon.batch.discountValue,couponId:coupon.coupon._id,couponCode:coupon.coupon.code,couponSnapshot:coupon.snapshot}:{}),taxAmount:priced.totals.taxAmount,grandTotal:total,paidAmount:total,dueAmount:0,paymentStatus:"PAID",paymentTaxRatesSnapshot:data.paymentTaxRatesSnapshot,taxRateSnapshot:data.taxRateSnapshot,taxPaymentMethod:payment.method,createdByUserId:data.user.id,openedAt:now}],{session:transaction});
 if(coupon)await claimCoupon(coupon.coupon._id,{orderId:created._id,orderNumber:created.orderNumber,status:"REDEEMED",discountAmount:priced.totals.discountAmount},transaction);
 await Payment.create([{businessId:data.user.businessId,saleSessionId:sale._id,saleDate:sale.saleDate,counterNameSnapshot:sale.counterName,orderId:created._id,idempotencyKey:payment.idempotencyKey,amount:total,tenderedAmount:tendered,changeAmount:change,method:payment.method,reference:payment.reference||undefined,notes:payment.notes||undefined,receivedByUserId:data.user.id,receivedByNameSnapshot:data.user.fullName,paidAt:now}],{session:transaction});
 const issued=await autoIssueCoupons(created.toObject(),sale.saleDate,transaction);
 await queuePaymentSms(created.toObject(),now,transaction);return{order:created,total,change,issued,couponCode:coupon?String(coupon.coupon.code):null};
 });
 const{order,total,change,issued}=result;
 await writeAuditLog({businessId:data.user.businessId,userId:data.user.id,userName:data.user.fullName,action:"COMPLETE_PAYMENT",entityType:"Order",entityId:String(order._id),description:"Created paid takeaway order "+order.orderNumber+" and sent to kitchen",metadata:{amount:total,method:payment.method,change,saleDate:order.saleDate,sentToKitchen:true,...(result.couponCode?{couponCode:result.couponCode,discountAmount:order.discountAmount}:{}),...(issued.length?{issuedCoupons:issued.map(item=>item.code)}:{})}});
 const business=await Business.findOne({_id:data.user.businessId,isActive:true}).lean();
 for(const path of ["/orders","/kitchen","/sale-sessions","/sales","/reports","/reports/profit-loss","/dashboard","/coupons"])revalidatePath(path);
 return{ok:true as const,orderId:String(order._id),orderNumber:order.orderNumber,amount:total,change,issuedCoupons:issued.map(item=>({code:item.code,batchName:item.batchName,description:item.description})),autoPrint:Boolean(can(data.user,"printing")&&business?.autoPrintCustomerOnPayment&&business.customerPrintingEnabled!==false),printerMode:(business?.printerMode??"BROWSER") as "BROWSER"|"QZ"};
 }catch(error){return{ok:false as const,message:saleSessionError(error)}}
}
