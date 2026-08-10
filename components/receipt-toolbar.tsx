"use client";
import Link from "next/link";
import { useEffect,useRef } from "react";
import { ArrowLeft,Printer } from "lucide-react";
export function ReceiptToolbar({orderId,auto=true}:{orderId:string;auto?:boolean}){const opened=useRef(false);useEffect(()=>{if(auto&&!opened.current){opened.current=true;const timer=window.setTimeout(()=>window.print(),350);return()=>window.clearTimeout(timer)}},[auto]);return <nav className="receipt-toolbar"><Link href={`/orders/${orderId}`}><ArrowLeft size={17}/>Order</Link><button onClick={()=>window.print()}><Printer size={17}/>Print</button></nav>}
