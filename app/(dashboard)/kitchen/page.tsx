import { KitchenBoard } from "@/components/kitchen-board";
import { requireUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { Order } from "@/models/Order";

export default async function KitchenPage(){const user=await requireUser();await connectToDatabase();const rows=await Order.find({businessId:user.businessId,status:{$in:["SENT_TO_KITCHEN","PREPARING","READY"]}}).sort({createdAt:1}).lean();return <KitchenBoard orders={rows.map(order=>({id:String(order._id),orderNumber:order.orderNumber,status:order.status as "SENT_TO_KITCHEN"|"PREPARING"|"READY",orderType:order.orderType,customer:order.customerSnapshot?.name||order.tableNameSnapshot||"Counter",assignment:[order.tableNameSnapshot,order.waiterNameSnapshot].filter(Boolean).join(" · "),createdAt:new Intl.DateTimeFormat("en-PK",{timeZone:"Asia/Karachi",hour:"2-digit",minute:"2-digit"}).format(order.createdAt),items:order.items.map((item:{lineId:string;nameSnapshot:string;quantity:number;notes?:string})=>({id:item.lineId,name:item.nameSnapshot,quantity:item.quantity,notes:item.notes}))}))}/>}
