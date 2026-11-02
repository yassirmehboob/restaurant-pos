"use client";
import { useId,useState,useTransition } from "react";
import { BadgePercent,Check,LoaderCircle,MessageSquareText,Plus,ShieldCheck,Trash2 } from "lucide-react";
import { randomId } from "@/lib/random-id";
import { DecimalInput } from "@/components/decimal-input";
import { MAX_DISCOUNT_SMS_NUMBERS,type DiscountMode,type DiscountType } from "@/lib/invoice-discount";
import { saveDiscountSettings } from "@/app/(dashboard)/settings/discounts/actions";

type Row={key:string;id?:string;name:string;mode:DiscountMode;percent:string;capAmount:string;remarksRequired:boolean};
type Settings={enabled:boolean;couponOnPayment:boolean;types:DiscountType[];smsNumbers:string[]};
const toRow=(type:DiscountType):Row=>({key:type.id,id:type.id,name:type.name,mode:type.mode,percent:type.percent==null?"":String(type.percent),capAmount:type.capAmount==null?"":String(type.capAmount),remarksRequired:type.remarksRequired});
const blankRow=(name="",remarksRequired=true):Row=>({key:randomId(),name,mode:"OPEN",percent:"",capAmount:"",remarksRequired});
const optionalNumber=(value:string)=>value.trim()===""?null:Number(value);

export function DiscountSettings({initial,twoFactorEnabled,smsEnabled}:{initial:Settings;twoFactorEnabled:boolean;smsEnabled:boolean}){
 const id=useId();
 const[enabled,setEnabled]=useState(initial.enabled),[couponOnPayment,setCouponOnPayment]=useState(initial.couponOnPayment),[rows,setRows]=useState<Row[]>(initial.types.map(toRow)),[numbers,setNumbers]=useState(initial.smsNumbers.map(phone=>({key:randomId(),phone})));
 const[password,setPassword]=useState(""),[code,setCode]=useState(""),[pending,start]=useTransition(),[feedback,setFeedback]=useState<{ok:boolean;message:string}|null>(null);
 const update=(key:string,patch:Partial<Row>)=>{setRows(current=>current.map(row=>row.key===key?{...row,...patch}:row));setFeedback(null)};
 const toggle=(value:boolean)=>{setEnabled(value);setFeedback(null);if(value&&!rows.length)setRows([blankRow("Discount",false)])};
 return <form className="waiter-settings-card discount-settings" aria-labelledby={`${id}-title`} onSubmit={event=>{
  event.preventDefault();if(pending)return;setFeedback(null);
  start(async()=>{
   try{
    const result=await saveDiscountSettings({enabled,couponOnPayment,types:rows.map(row=>({...(row.id?{id:row.id}:{}),name:row.name,mode:row.mode,percent:row.mode==="FIXED"?optionalNumber(row.percent):null,capAmount:optionalNumber(row.capAmount),remarksRequired:row.remarksRequired})),smsNumbers:numbers.map(row=>row.phone).filter(phone=>phone.trim()),currentPassword:password,twoFactorCode:code});
    if(!result.ok){setFeedback({ok:false,message:result.message});return}
    setRows(result.types.map(type=>toRow({...type,mode:type.mode as DiscountMode})));setNumbers(result.smsNumbers.map(phone=>({key:randomId(),phone})));setPassword("");setCode("");setFeedback({ok:true,message:result.message});
   }catch{setFeedback({ok:false,message:"Could not save. Please try again."})}
  });
 }}>
  <div className="waiter-settings-content">
   <header className="waiter-settings-header">
    <span className="waiter-settings-icon" aria-hidden="true"><BadgePercent size={20} strokeWidth={1.7}/></span>
    <h2 id={`${id}-title`}>Invoice discounts</h2>
    <p>When allowed, a Discount box appears when receiving payment. The discount is a percentage of the bill before tax.</p>
   </header>
   <div className="waiter-settings-body">
    <div className="waiter-visibility-option">
     <div className="waiter-visibility-copy"><label htmlFor={`${id}-enabled`}>Allow discount on invoice</label><p>Cashiers choose one of the discounts below when receiving payment.</p></div>
     <label className="waiter-settings-toggle" htmlFor={`${id}-enabled`}><input id={`${id}-enabled`} type="checkbox" role="switch" checked={enabled} disabled={pending} onChange={event=>toggle(event.target.checked)}/><span aria-hidden="true"><i/></span></label>
    </div>
    <div className="waiter-visibility-option">
     <div className="waiter-visibility-copy"><label htmlFor={`${id}-coupon`}>Allow coupon code when receiving payment</label><p>Shows the Coupon code box in the payment window. When off, the box is hidden and coupon codes are refused.</p></div>
     <label className="waiter-settings-toggle" htmlFor={`${id}-coupon`}><input id={`${id}-coupon`} type="checkbox" role="switch" checked={couponOnPayment} disabled={pending} onChange={event=>{setCouponOnPayment(event.target.checked);setFeedback(null)}}/><span aria-hidden="true"><i/></span></label>
    </div>
    <section className="discount-types" aria-label="Discount types">
     <div className="discount-section-title"><strong>Discount types</strong><span>Name each discount, e.g. Discount or Special Relation Discount. Leave the percentage to the cashier or fix it, with or without a cap.</span></div>
     {rows.map(row=><fieldset className="discount-type-row" key={row.key}>
      <legend className="sr-only">{row.name||"New discount"}</legend>
      <label className="discount-name"><span>Name</span><input value={row.name} maxLength={60} required placeholder="Special Relation Discount" onChange={event=>update(row.key,{name:event.target.value})}/></label>
      <label><span>Percentage</span><select value={row.mode} onChange={event=>update(row.key,{mode:event.target.value as DiscountMode})}><option value="OPEN">Cashier types it</option><option value="FIXED">Fixed</option></select></label>
      <label><span>Fixed %</span><DecimalInput value={row.mode==="FIXED"?row.percent:""} disabled={row.mode!=="FIXED"} required={row.mode==="FIXED"} placeholder={row.mode==="FIXED"?"10":"—"} onValue={percent=>update(row.key,{percent})}/></label>
      <label><span>Cap (Rs, optional)</span><DecimalInput value={row.capAmount} placeholder="No cap" onValue={capAmount=>update(row.key,{capAmount})}/></label>
      <label className="discount-remarks-toggle"><input type="checkbox" checked={row.remarksRequired} onChange={event=>update(row.key,{remarksRequired:event.target.checked})}/><span>Remarks required</span></label>
      <button type="button" className="discount-remove" onClick={()=>{setRows(current=>current.filter(item=>item.key!==row.key));setFeedback(null)}} aria-label={`Remove ${row.name||"discount"}`}><Trash2 size={17}/></button>
     </fieldset>)}
     {!rows.length&&<p className="discount-empty">No discount types yet.</p>}
     <button type="button" className="discount-add" disabled={rows.length>=20} onClick={()=>{setRows(current=>[...current,blankRow()]);setFeedback(null)}}><Plus size={16}/>Add discount type</button>
    </section>
    <section className="discount-sms" aria-label="Discount SMS alerts">
     <div className="discount-section-title"><strong><MessageSquareText size={16}/> SMS alert numbers</strong><span>Each discount sends the order number, amount, discount, amount after discount and remarks to these numbers.{!smsEnabled&&" SMS is turned off in SMS Messaging, so no alerts will be sent until it is turned on."}</span></div>
     {numbers.map(row=><div className="discount-sms-row" key={row.key}><input value={row.phone} inputMode="tel" maxLength={20} placeholder="03XX XXXXXXX" aria-label="Mobile number" onChange={event=>{setNumbers(current=>current.map(item=>item.key===row.key?{...item,phone:event.target.value}:item));setFeedback(null)}}/><button type="button" className="discount-remove" onClick={()=>setNumbers(current=>current.filter(item=>item.key!==row.key))} aria-label="Remove number"><Trash2 size={17}/></button></div>)}
     <button type="button" className="discount-add" disabled={numbers.length>=MAX_DISCOUNT_SMS_NUMBERS} onClick={()=>setNumbers(current=>[...current,{key:randomId(),phone:""}])}><Plus size={16}/>Add mobile number</button>
    </section>
    <section className="discount-confirm" aria-label="Confirm it's you">
     <div className="discount-section-title"><strong><ShieldCheck size={16}/> Confirm it&apos;s you</strong><span>Enter your password{twoFactorEnabled?" and authenticator code":""} to save discount settings.</span></div>
     <div className="discount-confirm-fields"><label><span>Current password</span><input type="password" value={password} maxLength={72} autoComplete="current-password" required onChange={event=>setPassword(event.target.value)}/></label>{twoFactorEnabled&&<label><span>Authenticator or recovery code</span><input value={code} maxLength={64} autoComplete="one-time-code" inputMode="numeric" required onChange={event=>setCode(event.target.value)}/></label>}</div>
    </section>
   </div>
  </div>
  <footer className="waiter-settings-footer">
   <div className={`waiter-settings-feedback${feedback&&!feedback.ok?" is-error":""}`} role="status" aria-live="polite">{feedback?.ok&&<Check size={16} aria-hidden="true"/>}<span>{feedback?.message??"Changes apply to the next payment received."}</span></div>
   <button type="submit" disabled={pending}>{pending&&<LoaderCircle className="waiter-settings-spinner" size={16}/>}<span>{pending?"Saving…":"Save changes"}</span></button>
  </footer>
 </form>;
}
