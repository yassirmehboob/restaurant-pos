"use client";
import { useCan } from "@/components/permission-provider";
import Link from "next/link";
import { useTransition } from "react";
import Swal from "sweetalert2";
import { ORDER_CANCEL_REASONS,reasonChips } from "@/lib/reason-chips";
import { cancelOrder,changeOrderStatus } from "@/app/(dashboard)/orders/actions";

export function OrderControls({id,status,orderType,deliveryStatus}:{id:string;status:string;orderType?:string;deliveryStatus?:string}){
  const can=useCan();
  const[pending,startTransition]=useTransition();
  const next=status==="DRAFT"?{value:"CONFIRMED" as const,label:"Confirm order"}:status==="CONFIRMED"?{value:"SENT_TO_KITCHEN" as const,label:"Send to kitchen"}:status==="SENT_TO_KITCHEN"?{value:"PREPARING" as const,label:"Start preparing"}:status==="PREPARING"?{value:"READY" as const,label:"Mark ready"}:status==="READY"?{value:"SERVED" as const,label:"Mark served"}:status==="SERVED"?{value:"COMPLETED" as const,label:"Complete order"}:null;
  const cancel=async()=>{const result=await Swal.fire({title:"Cancel this order?",text:"The order remains in history and cannot be reopened.",icon:"warning",input:"textarea",inputLabel:"Cancellation reason",inputPlaceholder:"Tap a reason or type your own...",didOpen:reasonChips(ORDER_CANCEL_REASONS),inputValidator:value=>value.trim().length<3?"Enter a cancellation reason.":undefined,showCancelButton:true,confirmButtonText:"Cancel order",confirmButtonColor:"#dc2626",cancelButtonText:"Keep order",reverseButtons:true,focusCancel:true});if(result.isConfirmed)startTransition(async()=>{const response=await cancelOrder(id,result.value);if(!response.ok)await Swal.fire("Could not cancel",response.message,"error")})};
  return <div className="order-controls">{can("edit_orders")&&can("pos")&&!["COMPLETED","CANCELLED"].includes(status)&&!(orderType==="DELIVERY"&&(["OUT_FOR_DELIVERY","DELIVERED"].includes(deliveryStatus??"")||status==="SERVED"))&&<Link href={`/pos?edit=${id}`}>Edit order</Link>}{can("kitchen")&&next&&!(orderType==="DELIVERY"&&["READY","SERVED"].includes(status))&&<button disabled={pending} onClick={()=>startTransition(async()=>{const result=await changeOrderStatus(id,next.value);if(result&&!result.ok)await Swal.fire({icon:"error",titleText:"Order could not be updated",text:result.message})})}>{pending?"Updating...":next.label}</button>}{can("cancel_orders")&&!["COMPLETED","CANCELLED"].includes(status)&&<button className="danger" disabled={pending} onClick={cancel}>Cancel order</button>}</div>;
}
