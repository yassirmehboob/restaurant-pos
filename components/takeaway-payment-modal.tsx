"use client";
import { useSearchParams } from "next/navigation";
import { PaymentModal } from "@/components/payment-modal";
export function TakeawayPaymentModal({orderId,dueAmount}:{orderId:string;dueAmount:number}){const immediate=useSearchParams().get("pay")==="1";return <PaymentModal orderId={orderId} dueAmount={dueAmount} autoOpen={immediate} completionHref={immediate?"/pos":undefined}/>}
