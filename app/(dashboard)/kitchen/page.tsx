import mongoose from "mongoose";
import { Business } from "@/models/Business";
import { advanceKitchenOrders } from "@/lib/kitchen-timing.mjs";
import { requirePagePermission } from "@/data/auth";
import { formatTime } from "@/lib/dates";
import { KitchenBoard } from "@/components/kitchen-board";
import { connectToDatabase } from "@/lib/db";
import { Order } from "@/models/Order";

export default async function KitchenPage(){const user=await requirePagePermission("kitchen");await connectToDatabase();const business=await Business.findOne({_id:user.businessId,isActive:true}).lean();if(business&&mongoose.connection.db)await advanceKitchenOrders(mongoose.connection.db,business);const rows=await Order.find({businessId:user.businessId,status:{$in:["SENT_TO_KITCHEN","PREPARING","READY"]}}).sort({createdAt:1}).lean();return <KitchenBoard timing={business?.kitchenTimingEnabled?{preparingSeconds:business.kitchenPreparingDelaySeconds??60,readyMinutes:business.kitchenReadyDelayMinutes??25}:undefined} orders={rows.map(order=>({id:String(order._id),orderNumber:order.orderNumber,status:order.status as "SENT_TO_KITCHEN"|"PREPARING"|"READY",orderType:order.orderType,customer:order.customerSnapshot?.name||order.tableNameSnapshot||"Counter",assignment:[order.tableNameSnapshot,order.waiterNameSnapshot].filter(Boolean).join(" · "),createdAt:formatTime(order.createdAt),items:order.items.map((item:{lineId:string;nameSnapshot:string;quantity:number;notes?:string;dealItemsSnapshot?:{name:string;quantity:number}[]})=>({id:item.lineId,name:item.nameSnapshot,quantity:item.quantity,notes:item.notes,dealItems:(item.dealItemsSnapshot??[]).map(component=>({name:component.name,quantity:component.quantity*item.quantity}))}))}))}/>}
