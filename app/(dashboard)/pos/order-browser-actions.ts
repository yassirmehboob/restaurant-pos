"use server";
import { z } from "zod";
import { requirePermission } from "@/data/auth";
import { activeSaleSession } from "@/lib/sale-sessions";
import { Order } from "@/models/Order";
import { Business } from "@/models/Business";
const schema=z.object({orderType:z.enum(["ALL","DINE_IN","TAKEAWAY","DELIVERY"]).optional(),search:z.string().trim().max(100),payment:z.enum(["ALL","PAID","UNPAID","PARTIAL"]),status:z.enum(["ALL","DRAFT","CONFIRMED","SENT_TO_KITCHEN","PREPARING","READY","SERVED","COMPLETED","CANCELLED"])});
// Only this counter's open sale: orders taken in it, and orders it collected payment for.
export async function loadPosOrders(input:z.infer<typeof schema>){
 const user=await requirePermission("orders"),query=schema.parse(input),sale=await activeSaleSession(user);
 if(!sale)return{saleDate:"",counterName:"",total:0,printerMode:"BROWSER" as "BROWSER"|"QZ",printingEnabled:false,kitchenPrintingEnabled:false,orders:[]};
 const filter:Record<string,unknown>={businessId:user.businessId,$or:[{saleSessionId:sale._id},{collectedInSessionId:sale._id}]};
 if(query.payment!=="ALL")filter.paymentStatus=query.payment;
 if(query.orderType&&query.orderType!=="ALL"){filter.orderType=query.orderType;filter.status={$nin:["COMPLETED","CANCELLED"]}}else if(query.status!=="ALL")filter.status=query.status;
 if(query.search){const regex={$regex:Array.from(query.search,char=>".*+?^${}()|[]\\".includes(char)?"\\"+char:char).join(""),$options:"i"};filter.$and=[{$or:[{orderNumber:regex},{"customerSnapshot.name":regex},{"customerSnapshot.phone":regex},{tableNameSnapshot:regex},{waiterNameSnapshot:regex}]}]}
 const [orders,total,business]=await Promise.all([Order.find(filter).select("orderNumber status paymentStatus orderType customerSnapshot tableNameSnapshot waiterNameSnapshot saleDate createdAt grandTotal dueAmount paidAmount items.quantity").sort({createdAt:-1}).limit(200).lean(),Order.countDocuments(filter),Business.findOne({_id:user.businessId,isActive:true}).select("printerMode customerPrintingEnabled kitchenPrintingEnabled").lean()]);
 return {saleDate:String(sale.saleDate),counterName:String(sale.counterName),total,printerMode:(business?.printerMode??"BROWSER") as "BROWSER"|"QZ",printingEnabled:business?.customerPrintingEnabled!==false,kitchenPrintingEnabled:business?.kitchenPrintingEnabled!==false,orders:orders.map(order=>({id:String(order._id),number:order.orderNumber,status:order.status,payment:order.paymentStatus,type:order.orderType,customer:order.customerSnapshot?.name||"Walk-in customer",phone:order.customerSnapshot?.phone||"",table:order.tableNameSnapshot||"",waiter:order.waiterNameSnapshot||"",saleDate:order.saleDate||String(sale.saleDate),createdAt:order.createdAt.toISOString(),total:order.grandTotal,due:order.dueAmount,paid:order.paidAmount,items:order.items.reduce((sum:number,line:{quantity:number})=>sum+line.quantity,0)}))};
}
