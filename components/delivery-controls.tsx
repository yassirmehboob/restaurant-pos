"use client";
import { useState,useTransition } from "react";
import { Check,PackageCheck,Truck } from "lucide-react";
import { useCan } from "@/components/permission-provider";
import { changeDeliveryStatus } from "@/app/(dashboard)/orders/actions";
import { PaymentModal } from "@/components/payment-modal";
import Swal from "sweetalert2";

export function DeliveryControls({id,status,deliveryStatus,paymentStatus,dueAmount}:{id:string;status:string;deliveryStatus?:string;paymentStatus:string;dueAmount:number}){
 const can=useCan(),[pending,start]=useTransition(),[error,setError]=useState(""),[collectPayment,setCollectPayment]=useState(false);
 const stage=deliveryStatus??(status==="COMPLETED"?"DELIVERED":status==="SERVED"?"OUT_FOR_DELIVERY":"PLACED");
 const current=stage==="DELIVERED"?2:stage==="OUT_FOR_DELIVERY"?1:0,cancelled=status==="CANCELLED";
 const next=stage==="PLACED"&&status==="READY"?"OUT_FOR_DELIVERY":stage==="OUT_FOR_DELIVERY"&&status==="SERVED"?"DELIVERED":null;
 function advance(next:"OUT_FOR_DELIVERY"|"DELIVERED"){
  setError("");
  if(next==="DELIVERED"&&paymentStatus!=="PAID"){
   if(!can("payments")){setError("A cashier with payment permission must receive payment and confirm delivery.");return}
   setCollectPayment(true);return;
  }
  start(async()=>{
   try{
    if(next==="DELIVERED"){
     const confirmation=await Swal.fire({title:"Confirm delivery?",text:"This order is already paid. Confirm it has reached the customer. No additional payment will be taken.",icon:"question",showCancelButton:true,confirmButtonText:"Confirm delivered",cancelButtonText:"Go back",focusCancel:true});
     if(!confirmation.isConfirmed)return;
    }
    const response=await changeDeliveryStatus(id,next,next==="DELIVERED");if(!response.ok)setError(response.message);
   }catch{setError("Could not update delivery. Please try again.")}
  });
 }
 return <><section className="delivery-progress"><header><span><Truck size={20}/></span><div><h2>Delivery progress</h2><p>Update the journey as the order leaves your restaurant and reaches the customer.</p></div></header><ol aria-label="Delivery stages">{["Order placed","Out for delivery","Delivered"].map((label,index)=><li key={label} className={index<=current&&!cancelled?"is-done":""} aria-current={index===current&&!cancelled?"step":undefined}><span>{index<current?<Check size={13}/>:index+1}</span>{label}</li>)}</ol><footer><p>{cancelled?"This delivery was cancelled.":stage==="DELIVERED"?(paymentStatus==="PAID"?"Delivery and payment are complete.":"Delivery confirmed. Payment is still outstanding."):stage==="OUT_FOR_DELIVERY"?"The order is on its way to the customer.":status==="READY"?"The kitchen has marked this order ready for dispatch.":"Waiting for the kitchen to mark the order ready."}</p>{!cancelled&&can("orders")&&can("edit_orders")&&next&&<button disabled={pending||collectPayment} onClick={()=>advance(next)}>{next==="DELIVERED"?<PackageCheck size={17}/>:<Truck size={17}/>} {pending?"Updating…":next==="DELIVERED"?"Mark delivered":"Out for delivery"}</button>}</footer>{error&&<p className="delivery-progress-error" role="alert">{error}</p>}</section>{collectPayment&&<PaymentModal orderId={id} dueAmount={dueAmount} completeDelivery autoOpen hideTrigger onDismiss={()=>setCollectPayment(false)} onCompleted={()=>setCollectPayment(false)}/>}</>;
}
