"use client";

import Link from "next/link";
import { useId,useState,useTransition } from "react";
import { Check,LoaderCircle,QrCode } from "lucide-react";
import { saveQrOrderingSettings } from "@/app/(dashboard)/settings/business/qr-actions";

type Values={enabled:boolean;showSummary:boolean;verifyPhone:boolean;baseUrl:string};

export function QrOrderingSettings({initial,smsReady}:{initial:Values;smsReady:boolean}){
 const id=useId();
 const [values,setValues]=useState(initial),[saved,setSaved]=useState(initial);
 const [pending,start]=useTransition(),[feedback,setFeedback]=useState<{ok:boolean;message:string}|null>(null);
 const dirty=JSON.stringify(values)!==JSON.stringify(saved);
 const update=(patch:Partial<Values>)=>{setValues(current=>({...current,...patch}));setFeedback(null)};
 // A locked switch can still be turned off, so an owner who later disables SMS is not stuck with it on.
 const toggle=(key:"enabled"|"showSummary"|"verifyPhone",label:string,description:string,locked=false)=><div className="waiter-visibility-option">
  <div className="waiter-visibility-copy"><label htmlFor={`${id}-${key}`}>{label}</label><p id={`${id}-${key}-description`}>{description}</p></div>
  <label className="waiter-settings-toggle" htmlFor={`${id}-${key}`}><input id={`${id}-${key}`} type="checkbox" role="switch" checked={values[key]} disabled={pending||locked&&!values[key]} aria-describedby={`${id}-${key}-description`} onChange={event=>update({[key]:event.target.checked})}/><span aria-hidden="true"><i/></span></label>
 </div>;

 return <form className="waiter-settings-card" aria-labelledby={`${id}-title`} onSubmit={event=>{
  event.preventDefault();
  if(pending||!dirty)return;
  const next=values;
  start(async()=>{
   try{const result=await saveQrOrderingSettings(next);if(!result.ok){setFeedback({ok:false,message:result.message});return}const clean={...next,baseUrl:result.baseUrl};setValues(clean);setSaved(clean);setFeedback({ok:true,message:result.message})}
   catch{setFeedback({ok:false,message:"Could not save. Please try again."})}
  });
 }}>
  <div className="waiter-settings-content">
   <header className="waiter-settings-header">
    <span className="waiter-settings-icon" aria-hidden="true"><QrCode size={20} strokeWidth={1.7}/></span>
    <h2 id={`${id}-title`}>QR table ordering</h2>
    <p>Guests scan the code on their table, pick from the menu in English, Urdu or Sindhi and send the order. It waits in Waiter orders until a cashier approves it.</p>
    <span className="waiter-settings-devices">Any phone camera</span>
   </header>
   <div className="waiter-settings-body">
    {toggle("enabled","Accept QR orders","Orders are taken only while at least one counter is open. When off, or when all counters are closed, scanning a table code shows a polite “ask our waiter” message.")}
    {toggle("showSummary","Show bill summary to guests","Guests see subtotal, tax and total while ordering. Item prices are always shown.")}
    {toggle("verifyPhone","Verify guest mobile by SMS code",smsReady?"Before their first order, guests type a 4-digit code texted to their number; that phone then stays verified for 30 days. Stops someone using a photo of the code with a made-up number. Each code costs one SMS.":"Turn on SMS messaging first. Before their first order, guests would type a 4-digit code texted to their number.",!smsReady)}
    <div className="waiter-visibility-option qr-settings-url">
     <div className="waiter-visibility-copy">
      <label htmlFor={`${id}-url`}>Menu web address</label>
      <p id={`${id}-url-description`}>The address phones open. Use your public domain, or this POS computer’s Wi-Fi address (e.g. http://192.168.1.10:3000) if guests join your Wi-Fi. Leave blank to use the address you are using now.</p>
      <input id={`${id}-url`} type="url" inputMode="url" value={values.baseUrl} disabled={pending} maxLength={200} placeholder="https://order.myrestaurant.pk" aria-describedby={`${id}-url-description`} onChange={event=>update({baseUrl:event.target.value})}/>
     </div>
    </div>
    <div className={`waiter-settings-preview${values.enabled?" is-visible":""}`}>
     <span aria-hidden="true"/>
     <div><strong>{values.enabled?"Guests can order from their table":"QR ordering is off"}</strong><p>Print each table’s 4×6 inch QR card from <Link href="/tables">Tables</Link>. If an address changes, print the cards again.</p></div>
    </div>
   </div>
  </div>
  <footer className="waiter-settings-footer">
   <div className={`waiter-settings-feedback${feedback&&!feedback.ok?" is-error":""}`} role="status" aria-live="polite">
    {feedback?.ok&&<Check size={16} aria-hidden="true"/>}
    <span>{feedback?.message??(dirty?"You have unsaved changes.":"Cashiers can cancel any QR order that looks fake.")}</span>
   </div>
   <button type="submit" disabled={pending||!dirty}>{pending&&<LoaderCircle className="waiter-settings-spinner" size={16}/>}<span>{pending?"Saving…":"Save changes"}</span></button>
  </footer>
 </form>;
}
