"use client";

import Image from "next/image";
import { UtensilsCrossed } from "lucide-react";
import { useState } from "react";

export function WaiterMenuPhoto({src,name,compact=false}:{src?:string;name:string;compact?:boolean}){
 const [failedSource,setFailedSource]=useState<string>();
 return <span className={`waiter-photo${compact?" is-compact":""}`}>
  {src&&failedSource!==src?<Image src={src} alt={name} fill unoptimized sizes={compact?"64px":"(max-width: 600px) 45vw, (max-width: 1100px) 30vw, 240px"} onError={()=>setFailedSource(src)}/>:<span className="waiter-photo-placeholder"><UtensilsCrossed size={compact?20:32} strokeWidth={1.4}/>{!compact&&<span>Photo coming soon</span>}</span>}
 </span>;
}
