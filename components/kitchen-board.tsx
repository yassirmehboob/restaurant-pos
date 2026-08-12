"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect,useState,useTransition } from "react";
import { ArrowRight,ChefHat,ClipboardList,Clock3,Flame,RefreshCw,Utensils } from "lucide-react";
import { changeOrderStatus } from "@/app/(dashboard)/orders/actions";

type KitchenStatus="SENT_TO_KITCHEN"|"PREPARING"|"READY";
type KitchenOrder={id:string;orderNumber:string;status:KitchenStatus;orderType:string;customer:string;assignment:string;createdAt:string;items:{id:string;name:string;quantity:number;notes?:string}[]};
const columns:[KitchenStatus,string,React.ComponentType<{size?:number}>][]=[["SENT_TO_KITCHEN","Sent to Kitchen",Clock3],["PREPARING","Preparing",Flame],["READY","Ready",ChefHat]];

export function KitchenBoard({orders}:{orders:KitchenOrder[]}){
  const router=useRouter(),[movingId,setMovingId]=useState(""),[pending,startTransition]=useTransition();
  useEffect(()=>{const timer=window.setInterval(()=>router.refresh(),15000);return()=>window.clearInterval(timer)},[router]);
  const advance=(order:KitchenOrder)=>{const next=order.status==="SENT_TO_KITCHEN"?"PREPARING":order.status==="PREPARING"?"READY":null;if(!next)return;setMovingId(order.id);startTransition(async()=>{await changeOrderStatus(order.id,next);router.refresh();setMovingId("")})};
  return <main className="kitchen-board-page"><header className="kitchen-board-header"><div><span><Utensils size={18}/>Kitchen Display</span><h1>Live Orders</h1></div><div><small>Updates automatically every 15 seconds</small><button type="button" onClick={()=>router.refresh()}><RefreshCw size={17}/>Refresh</button><Link href="/orders"><ClipboardList size={17}/>Orders</Link></div></header><section className="kitchen-columns">{columns.map(([status,title,Icon])=>{const rows=orders.filter(order=>order.status===status);return <section className={`kitchen-column kitchen-${status.toLowerCase()}`} key={status}><header><span><Icon size={18}/>{title}</span><b>{rows.length}</b></header><div className="kitchen-order-list">{rows.map(order=><button type="button" className="kitchen-order-card" disabled={status==="READY"||pending&&movingId===order.id} onClick={()=>advance(order)} key={order.id}><div className="kitchen-card-head"><div><span>{order.orderType.replace("_","-")}</span><strong>{order.orderNumber}</strong></div><time>{order.createdAt}</time></div><div className="kitchen-customer"><strong>{order.customer}</strong>{order.assignment&&<span>{order.assignment}</span>}</div><div className="kitchen-items">{order.items.map(item=><div key={item.id}><b>{item.quantity}×</b><span>{item.name}{item.notes&&<small>Note: {item.notes}</small>}</span></div>)}</div>{status!=="READY"&&<footer>{movingId===order.id?"Moving...":status==="SENT_TO_KITCHEN"?"Tap to start preparing":"Tap to mark ready"}<ArrowRight size={16}/></footer>}{status==="READY"&&<footer className="ready-label">Ready for service</footer>}</button>)}{!rows.length&&<div className="kitchen-empty"><Icon size={28}/><strong>No {title.toLowerCase()} orders</strong></div>}</div></section>})}</section></main>;
}
