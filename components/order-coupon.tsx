"use client";
import { useRouter } from "next/navigation";
import { useState,useTransition } from "react";
import { TicketPercent } from "lucide-react";
import { useCan } from "@/components/permission-provider";
import { applyOrderCoupon,removeOrderCoupon } from "@/app/(dashboard)/payments/coupon-actions";

// Lets a cashier add a coupon to an unpaid order before its bill is printed (e.g. delivery orders).
export function OrderCoupon({orderId,couponCode,batchName}:{orderId:string;couponCode?:string;batchName?:string}){
 const allowed=useCan()("payments"),router=useRouter(),[code,setCode]=useState(""),[message,setMessage]=useState(""),[pending,start]=useTransition();
 if(!allowed)return null;
 const run=(work:()=>Promise<{ok:boolean;message?:string}>)=>start(async()=>{setMessage("");try{const result=await work();if(!result.ok){setMessage(result.message??"Please try again.");return}setCode("");router.refresh()}catch{setMessage("Please try again.")}});
 return <section className="payment-coupon order-coupon" aria-label="Coupon">
  {couponCode?<div className="payment-coupon-applied"><TicketPercent size={18}/><div><strong>Coupon {couponCode}</strong><small>{batchName}</small></div><button type="button" disabled={pending} onClick={()=>run(()=>removeOrderCoupon(orderId))}>Remove</button></div>
  :<form className="payment-coupon-entry" onSubmit={event=>{event.preventDefault();const clean=code.replace(/[\s-]/g,"");if(!/^[1-9]\d{9}$/.test(clean)){setMessage("Enter the 10-digit coupon code.");return}run(()=>applyOrderCoupon(orderId,clean))}}><label><span>Coupon code</span><input inputMode="numeric" autoComplete="off" maxLength={14} placeholder="10-digit code" value={code} disabled={pending} onChange={event=>{setCode(event.target.value);setMessage("")}}/></label><button type="submit" disabled={pending||!code.trim()}>{pending?"Checking...":"Apply"}</button></form>}
  {message&&<p className="payment-coupon-error" role="alert">{message}</p>}
 </section>;
}
