import { requirePagePermission } from "@/data/auth";
import { businessDateQuery } from "@/lib/reporting";
import { formatDate,formatDateTime } from "@/lib/dates";
import { DatePicker } from "@/components/date-picker";
import { activeSaleSession } from "@/lib/sale-sessions";
import Link from "next/link";
import { CalendarDays,Plus } from "lucide-react";
import { connectToDatabase } from "@/lib/db";
import { resolveReportRange,saleDateFilter,type ReportQuery } from "@/lib/reporting";
import { Order } from "@/models/Order";
import { OrderCatalog } from "@/components/order-catalog";

export default async function OrdersPage({searchParams}:{searchParams:Promise<ReportQuery>}){const user=await requirePagePermission("orders"),query=await searchParams,sale=await activeSaleSession(user),range=resolveReportRange(businessDateQuery(query,sale?.saleDate));await connectToDatabase();const rows=await Order.find({businessId:user.businessId,...saleDateFilter(range,"createdAt")}).select("orderNumber orderType status paymentStatus saleDate createdAt customerSnapshot.name tableNameSnapshot grandTotal items.quantity").sort({saleDate:-1,createdAt:-1}).limit(500).lean();const orders=rows.map(row=>({id:String(row._id),number:row.orderNumber,type:row.orderType,status:row.status,paymentStatus:row.paymentStatus,customer:row.customerSnapshot?.name??row.tableNameSnapshot??"Counter",saleDateLabel:formatDate(row.saleDate??row.createdAt),createdAtLabel:formatDateTime(row.createdAt),itemCount:row.items.reduce((sum:number,item:{quantity:number})=>sum+item.quantity,0),grandTotal:row.grandTotal}));return <main className="master-page orders-page"><header className="orders-compact-header"><div><h1>Orders</h1><p>Kitchen progress and payment status are tracked separately.</p></div><Link className="new-order-link" href="/pos"><Plus size={17}/>New order</Link></header><form className="orders-date-filter" method="get"><CalendarDays size={18}/><label>From<DatePicker name="from" label="From" key={`from:${range.fromText}`} defaultValue={range.fromText}/></label><label>To<DatePicker name="to" label="To" key={`to:${range.toText}`} defaultValue={range.toText}/></label><button name="range" value="CUSTOM">Fetch orders</button><Link href="/orders">Current sale day</Link></form><section className="master-list order-list-shell"><div className="list-heading"><h2>{range.preset==="TODAY"?"Today’s orders":"Orders in selected dates"}</h2><span>{rows.length} found</span></div><OrderCatalog orders={orders}/></section></main>}
