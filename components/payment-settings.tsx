"use client";

import { useId,useState,useTransition } from "react";
import { Banknote,Check,LoaderCircle } from "lucide-react";
import { savePaymentPrefill } from "@/app/(dashboard)/settings/business/payment-actions";

export function PaymentSettings({prefill}:{prefill:boolean}){
 const id=useId();
 const [enabled,setEnabled]=useState(prefill),[saved,setSaved]=useState(prefill);
 const [pending,start]=useTransition(),[feedback,setFeedback]=useState<{ok:boolean;message:string}|null>(null);
 const dirty=enabled!==saved;

 return <form className="waiter-settings-card" aria-labelledby={`${id}-title`} onSubmit={event=>{
  event.preventDefault();
  if(pending||!dirty)return;
  const value=enabled;
  setFeedback(null);
  start(async()=>{
   try{await savePaymentPrefill(value);setSaved(value);setFeedback({ok:true,message:"Payment preferences saved."})}
   catch{setFeedback({ok:false,message:"Could not save. Please try again."})}
  });
 }}>
  <div className="waiter-settings-content">
   <header className="waiter-settings-header">
    <span className="waiter-settings-icon" aria-hidden="true"><Banknote size={20} strokeWidth={1.7}/></span>
    <h2 id={`${id}-title`}>Payment receiving</h2>
    <p>Control how the cash amount is filled when receiving payment.</p>
   </header>
   <div className="waiter-settings-body">
    <div className="waiter-visibility-option">
     <div className="waiter-visibility-copy">
      <label htmlFor={`${id}-prefill`}>Prefill due amount</label>
      <p id={`${id}-description`}>The cash received field starts with the full amount due.</p>
     </div>
     <label className="waiter-settings-toggle" htmlFor={`${id}-prefill`}>
      <input id={`${id}-prefill`} name="prefill" type="checkbox" role="switch" checked={enabled} disabled={pending} aria-describedby={`${id}-description ${id}-state`} onChange={event=>{setEnabled(event.target.checked);setFeedback(null)}}/>
      <span aria-hidden="true"><i/></span>
     </label>
    </div>
    <div className={`waiter-settings-preview${enabled?" is-visible":""}`} id={`${id}-state`}>
     <span aria-hidden="true"/>
     <div><strong>{enabled?"Due amount is prefilled":"Cashier enters the amount"}</strong><p>{enabled?"Cashiers can confirm exact payments in one tap.":"The cash field starts empty so the actual amount received is typed in."}</p></div>
    </div>
   </div>
  </div>
  <footer className="waiter-settings-footer">
   <div className={`waiter-settings-feedback${feedback&&!feedback.ok?" is-error":""}`} role="status" aria-live="polite">
    {feedback?.ok&&<Check size={16} aria-hidden="true"/>}
    <span>{feedback?.message??(dirty?"You have unsaved changes.":"Card, bank and other payments always use the exact due amount.")}</span>
   </div>
   <button type="submit" disabled={pending||!dirty}>{pending&&<LoaderCircle className="waiter-settings-spinner" size={16}/>}<span>{pending?"Saving…":"Save changes"}</span></button>
  </footer>
 </form>;
}
