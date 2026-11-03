"use client";

import { useTransition } from "react";
import { QrCode,RefreshCw } from "lucide-react";
import Swal from "sweetalert2";
import { regenerateTableQr } from "@/app/(dashboard)/settings/business/qr-actions";

// Print this table's QR card, or replace its code so an old print (or a shared photo of it) stops working.
export function TableQrActions({id,name}:{id:string;name:string}){
 const[pending,start]=useTransition();
 async function regenerate(){
  const answer=await Swal.fire({title:`New QR code for ${name}?`,text:"The card on this table now will stop working. Print and place the new card straight away.",icon:"warning",showCancelButton:true,confirmButtonText:"Create new code",confirmButtonColor:"#b4441c"});
  if(!answer.isConfirmed)return;
  start(async()=>{
   const result=await regenerateTableQr(id);
   if(!result.ok){void Swal.fire({icon:"error",title:"Not changed",text:result.message});return}
   window.open(`/print/table-qr/${id}`,"_blank","noopener");
  });
 }
 return <>
  <a className="table-qr-link" href={`/print/table-qr/${id}`} target="_blank" rel="noopener"><QrCode size={15}/>QR card</a>
  <button type="button" className="table-qr-link" disabled={pending} onClick={()=>void regenerate()} title="Replace this table's QR code"><RefreshCw size={15}/>New code</button>
 </>;
}
