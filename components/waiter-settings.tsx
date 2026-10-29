"use client";

import { useId,useState,useTransition } from "react";
import { Check,LoaderCircle,Tablet } from "lucide-react";
import { saveWaiterVisibility } from "@/app/(dashboard)/settings/business/waiter-actions";

export function WaiterSettings({show}:{show:boolean}){
 const id=useId();
 const [visible,setVisible]=useState(show),[saved,setSaved]=useState(show);
 const [pending,start]=useTransition(),[feedback,setFeedback]=useState<{ok:boolean;message:string}|null>(null);
 const dirty=visible!==saved;

 return <form className="waiter-settings-card" aria-labelledby={`${id}-title`} onSubmit={event=>{
  event.preventDefault();
  if(pending||!dirty)return;
  const value=visible;
  setFeedback(null);
  start(async()=>{
   try{await saveWaiterVisibility(value);setSaved(value);setFeedback({ok:true,message:"Waiter preferences saved."})}
   catch{setFeedback({ok:false,message:"Could not save. Please try again."})}
  });
 }}>
  <div className="waiter-settings-content">
   <header className="waiter-settings-header">
    <span className="waiter-settings-icon" aria-hidden="true"><Tablet size={20} strokeWidth={1.7}/></span>
    <h2 id={`${id}-title`}>Waiter screens</h2>
    <p>Manage bill visibility for your waiter team.</p>
    <span className="waiter-settings-devices">Android tablets &amp; iPads</span>
   </header>
   <div className="waiter-settings-body">
    <div className="waiter-visibility-option">
     <div className="waiter-visibility-copy">
      <label htmlFor={`${id}-visibility`}>Show prices and bill summary</label>
      <p id={`${id}-description`}>Waiters can see menu prices, subtotal, tax, and the order total.</p>
     </div>
     <label className="waiter-settings-toggle" htmlFor={`${id}-visibility`}>
      <input id={`${id}-visibility`} name="show" type="checkbox" role="switch" checked={visible} disabled={pending} aria-describedby={`${id}-description ${id}-state`} onChange={event=>{setVisible(event.target.checked);setFeedback(null)}}/>
      <span aria-hidden="true"><i/></span>
     </label>
    </div>
    <div className={`waiter-settings-preview${visible?" is-visible":""}`} id={`${id}-state`}>
     <span aria-hidden="true"/>
     <div><strong>{visible?"Prices are visible":"Prices are hidden"}</strong><p>{visible?"Waiters can review the bill while taking an order.":"Waiters see items and quantities. Bill amounts stay hidden."}</p></div>
    </div>
   </div>
  </div>
  <footer className="waiter-settings-footer">
   <div className={`waiter-settings-feedback${feedback&&!feedback.ok?" is-error":""}`} role="status" aria-live="polite">
    {feedback?.ok&&<Check size={16} aria-hidden="true"/>}
    <span>{feedback?.message??(dirty?"You have unsaved changes.":"Applies to all waiter accounts.")}</span>
   </div>
   <button type="submit" disabled={pending||!dirty}>{pending&&<LoaderCircle className="waiter-settings-spinner" size={16}/>}<span>{pending?"Saving…":"Save changes"}</span></button>
  </footer>
 </form>;
}
