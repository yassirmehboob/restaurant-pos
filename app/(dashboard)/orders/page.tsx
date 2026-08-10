import Link from "next/link";
import { Plus } from "lucide-react";
import { OrderCatalog } from "@/components/order-catalog";
import { MasterHeader } from "@/components/master-shell";
import { requireUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { Order } from "@/models/Order";
const money=(value:number)=>`Rs ${value.toLocaleString("en-PK",{maximumFractionDigits:2})}`;
export default async function OrdersPage(){const user=await requireUser();await connectToDatabase();const rows=await Order.find({businessId:user.businessId}).sort({createdAt:-1}).limit(250).lean();const orders=rows.map(row=>{const id=String(row._id),customer=row.customerSnapshot?.name??row.tableNameSnapshot??"Counter";const card=<Link className="order-card" href={`/orders/${id}`}><div><span>{row.orderType.replace("_","-")}</span><strong>{row.orderNumber}</strong><small>{new Date(row.createdAt).toLocaleString("en-PK")}</small></div><b className={`order-status status-${row.status.toLowerCase()}`}>{row.status.replaceAll("_"," ")}</b><p>{customer} · {row.items.reduce((sum:number,item:{quantity:number})=>sum+item.quantity,0)} items</p><strong className="order-total">{money(row.grandTotal)}</strong></Link>;return{id,number:row.orderNumber,type:row.orderType,status:row.status,customer,card}});return <main className="master-page orders-page"><MasterHeader eyebrow="Order engine" title="Orders" description="Track drafts, kitchen progress, and cancelled orders." actions={<Link className="new-order-link" href="/pos"><Plus size={17}/>New order</Link>}/><section className="master-list order-list-shell"><div className="list-heading"><h2>Order history</h2><span>{rows.length} shown</span></div><OrderCatalog orders={orders}/></section></main>}
