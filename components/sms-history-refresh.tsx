"use client";
import { useEffect,useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
export function SmsHistoryRefresh(){
 const router=useRouter(),[pending,start]=useTransition();
 useEffect(()=>{const interval=setInterval(()=>{if(document.visibilityState==="visible")start(()=>router.refresh())},10000);return()=>clearInterval(interval)},[router]);
 return <button className="sms-log-refresh" type="button" disabled={pending} onClick={()=>start(()=>router.refresh())}><RefreshCw size={15} className={pending?"waiter-settings-spinner":""}/>{pending?"Refreshing…":"Refresh"}</button>;
}
