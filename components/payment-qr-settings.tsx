"use client";

import { useEffect,useId,useRef,useState,useTransition } from "react";
import { Check,ImagePlus,LoaderCircle,QrCode,Trash2 } from "lucide-react";
import { savePaymentQr,type PaymentQrState } from "@/app/(dashboard)/settings/business/payment-actions";
import { PAYMENT_QR_CAPTION,type PaymentQrShowOn } from "@/lib/receipt-layout";
import "./payment-qr-settings.css";

type Saved={url:string;caption:string;showOn:PaymentQrShowOn};
const IMAGE_TYPES=["image/jpeg","image/png","image/webp"];
const SHOW_ON:{value:PaymentQrShowOn;label:string;hint:string}[]=[
 {value:"UNPAID",label:"Unpaid bills only",hint:"Printed on unpaid and part-paid bills, so the customer can scan and pay at the table."},
 {value:"ALL",label:"Both paid & unpaid",hint:"Printed on every customer receipt, paid or not."},
 {value:"NEVER",label:"Don't print",hint:"The image stays saved but no receipt shows it."},
];

// Payment QR code (bank, Raast, JazzCash, Easypaisa...) printed after the bill summary on customer receipts.
export function PaymentQrSettings({initial}:{initial:Saved}){
 const id=useId(),fileInput=useRef<HTMLInputElement>(null);
 const [saved,setSaved]=useState(initial),[caption,setCaption]=useState(initial.caption),[showOn,setShowOn]=useState(initial.showOn);
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(""),[remove,setRemove]=useState(false);
 const [state,setState]=useState<PaymentQrState>(),[pending,start]=useTransition();
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
 const shown=preview||(remove?"":saved.url),dirty=Boolean(file)||remove||caption.trim()!==saved.caption||showOn!==saved.showOn;
 const clearFile=()=>{setFile(null);setPreview("");if(fileInput.current)fileInput.current.value=""};
 const hint=!shown?"Upload your QR code to print it on receipts.":SHOW_ON.find(option=>option.value===showOn)?.hint;

 return <form className="waiter-settings-card payment-qr-card" aria-labelledby={`${id}-title`} onSubmit={event=>{
  event.preventDefault();if(pending||!dirty)return;
  const data=new FormData();data.set("showOn",showOn);data.set("caption",caption);data.set("remove",remove?"YES":"NO");if(file)data.set("paymentQr",file);
  setState(undefined);
  start(async()=>{
   try{
    const result=await savePaymentQr(undefined,data);setState(result);
    if(result.ok){setSaved(current=>({url:result.url===undefined?current.url:result.url??"",caption:caption.trim(),showOn}));setCaption(caption.trim());clearFile();setRemove(false)}
   }catch{setState({message:"Could not save the payment QR code. Please try again."})}
  });
 }}>
  <div className="waiter-settings-content">
   <header className="waiter-settings-header">
    <span className="waiter-settings-icon" aria-hidden="true"><QrCode size={20} strokeWidth={1.7}/></span>
    <h2 id={`${id}-title`}>Payment QR code</h2>
    <p>Customers scan this QR code on the receipt to pay you by bank transfer, Raast, JazzCash or Easypaisa. It prints after the bill total.</p>
   </header>
   <fieldset className="waiter-settings-body payment-qr-body" disabled={pending}>
    <legend className="business-profile-sr-only">Payment QR code</legend>
    <div className="payment-qr-image">
     <div className={`payment-qr-frame${shown?"":" is-empty"}`}>
      {/* Uploaded image from GridFS or a local preview; shown as is so the owner sees exactly what prints. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {shown?<img src={shown} alt="Payment QR code"/>:<QrCode size={42} strokeWidth={1.3} aria-hidden="true"/>}
     </div>
     <div className="payment-qr-image-copy">
      <strong>{file?file.name:shown?"QR code ready to print":remove?"QR code will be removed":"No QR code yet"}</strong>
      <small>Upload a clear JPG, PNG or WebP of the QR code only, cropped close. Up to 5 MB.</small>
      <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} className="business-profile-sr-only" tabIndex={-1} aria-label="Choose payment QR code image" onChange={event=>{
       const chosen=event.target.files?.[0];if(!chosen)return;
       if(chosen.size>5*1024*1024||!IMAGE_TYPES.includes(chosen.type)){setState({message:"Choose a JPG, PNG, or WebP image up to 5 MB."});clearFile();return}
       setFile(chosen);setPreview(URL.createObjectURL(chosen));setRemove(false);setState(undefined);
      }}/>
      <div className="payment-qr-buttons">
       <button type="button" onClick={()=>fileInput.current?.click()}><ImagePlus size={15}/>{shown?"Change image":"Upload QR code"}</button>
       {(file||saved.url&&!remove)&&<button type="button" className="is-danger" onClick={()=>{if(file){clearFile();return}setRemove(true);setState(undefined)}}><Trash2 size={15}/>{file?"Cancel":"Remove"}</button>}
      </div>
     </div>
    </div>
    <div className="payment-qr-options">
     <label className="payment-qr-field" htmlFor={`${id}-caption`}>
      <span>Caption above the code <small>Optional</small></span>
      <input id={`${id}-caption`} value={caption} maxLength={80} placeholder={`${PAYMENT_QR_CAPTION} · Raast / JazzCash`} onChange={event=>{setCaption(event.target.value);setState(undefined)}} aria-invalid={state?.errors?.caption?true:undefined}/>
      {state?.errors?.caption&&<em>{state.errors.caption[0]}</em>}
     </label>
     <div className="payment-qr-field" role="radiogroup" aria-labelledby={`${id}-show`}>
      <span id={`${id}-show`}>Print the QR code on</span>
      <div className="payment-qr-choices">{SHOW_ON.map(option=><label key={option.value} className={showOn===option.value?"is-selected":""}><input type="radio" name="showOn" value={option.value} checked={showOn===option.value} onChange={()=>{setShowOn(option.value);setState(undefined)}}/>{option.label}</label>)}</div>
      <p>{hint}</p>
     </div>
    </div>
   </fieldset>
  </div>
  <footer className="waiter-settings-footer">
   <div className={`waiter-settings-feedback${state?.message&&!state.ok?" is-error":""}`} role="status" aria-live="polite">
    {state?.ok&&<Check size={16} aria-hidden="true"/>}
    <span>{state?.message??(state?.errors?"Check the highlighted fields.":dirty?"You have unsaved changes.":"Print a test bill to check the code scans from paper.")}</span>
   </div>
   <button type="submit" disabled={pending||!dirty}>{pending&&<LoaderCircle className="waiter-settings-spinner" size={16}/>}<span>{pending?"Saving…":"Save QR code"}</span></button>
  </footer>
 </form>;
}
