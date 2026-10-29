"use client";

import { useId,useRef,useState,useTransition } from "react";
import { Check,Eye,EyeOff,LoaderCircle,MessageSquare,Plus,Smartphone } from "lucide-react";
import { saveSmsSettings } from "@/app/(dashboard)/settings/business/sms-actions";
import { DEFAULT_PAYMENT_SMS,SMS_FIELDS,renderPaymentSms,smsTemplateError,type SmsValues } from "@/lib/sms-template";
import Link from "next/link";

type Settings={enabled:boolean;paymentReceiptEnabled:boolean;includeOptOut:boolean;template:string;evidenceReference:string};
function Toggle({id,checked,disabled,onChange,label}:{id:string;checked:boolean;disabled:boolean;onChange:(value:boolean)=>void;label:string}){
 return <label className="sms-toggle"><input id={id} type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/><span aria-hidden="true"><i/></span></label>;
}

export function SmsSettings({initial,hasSavedToken,gatewayConfigured,businessName,currency}:{initial:Settings;hasSavedToken:boolean;gatewayConfigured:boolean;businessName:string;currency:string}){
 const id=useId(),editor=useRef<HTMLTextAreaElement>(null);
 const [settings,setSettings]=useState(initial),[saved,setSaved]=useState(initial),[token,setToken]=useState(""),[hasToken,setHasToken]=useState(hasSavedToken),[showToken,setShowToken]=useState(false),[removeToken,setRemoveToken]=useState(false);
 const [pending,start]=useTransition(),[message,setMessage]=useState<{ok:boolean;text:string}|null>(null);
 const dirty=JSON.stringify(settings)!==JSON.stringify(saved)||!!token||removeToken;
 const update=(values:Partial<Settings>)=>{setSettings(current=>({...current,...values}));setMessage(null)};
 const previewValues:SmsValues={customer_name:"Ali",business_name:businessName,order_number:"ORD-000123",currency,amount_paid:"2500.00",order_total:"2500.00",payment_method:"CASH",paid_at:"28/10/2026, 7:30 pm",customer_phone:"+923001234567",table_name:"Table 4",delivery_address:"12 Main Street",delivery_area:"City Centre",delivery_charge:"150.00",delivery_status:"Order placed",event_at:"28/10/2026, 7:30 pm",business_phone:"0300 1234567"};
 const templateError=smsTemplateError(settings.template);
 let preview="";try{preview=renderPaymentSms(settings.template,previewValues)}catch{preview="Your message preview will appear here."}
 const previewText=settings.includeOptOut?`${preview}\n\nReply STOP to stop messages. Reply START to resume.`:preview;
 function insertField(field:string){
  const textarea=editor.current,startAt=textarea?.selectionStart??settings.template.length,endAt=textarea?.selectionEnd??settings.template.length,placeholder=`{{${field}}}`;
  const next=settings.template.slice(0,startAt)+placeholder+settings.template.slice(endAt);
  if(next.length>1000)return;
  update({template:next});requestAnimationFrame(()=>{editor.current?.focus();editor.current?.setSelectionRange(startAt+placeholder.length,startAt+placeholder.length)});
 }
 return <form className="sms-settings-card" aria-labelledby={`${id}-title`} onSubmit={event=>{
  event.preventDefault();if(pending||!dirty)return;setMessage(null);
  start(async()=>{try{const result=await saveSmsSettings({...settings,token,removeToken});setMessage({ok:result.ok,text:result.message});if(result.ok){setSaved({...settings});setHasToken(result.hasToken);setToken("");setRemoveToken(false)}}catch{setMessage({ok:false,text:"Could not save SMS settings. Please try again."})}});
 }}>
  <header className="sms-settings-header"><span className="sms-heading-icon"><MessageSquare size={21}/></span><div><h2 id={`${id}-title`}>SMS messaging</h2><p>Connect your subscription and create a personal payment receipt.</p></div><span className={`sms-token-badge${hasToken?" is-saved":""}`}>{hasToken?"Token saved":"Not configured"}</span><Link className="sms-history-shortcut" href="/settings/sms">SMS history</Link></header>
  <fieldset className="sms-settings-fields" disabled={pending}><legend className="business-profile-sr-only">SMS subscription and messages</legend>
   <section className="sms-settings-section"><div className="sms-section-intro"><h3>Subscription</h3><p>Use the SMS token assigned to this restaurant.</p></div><div className="sms-section-controls">
    <div className="sms-switch-row"><div><label htmlFor={`${id}-enabled`}>Enable SMS sending</label><p>Send messages using your business subscription.</p></div><Toggle id={`${id}-enabled`} label="Enable SMS sending" checked={settings.enabled} disabled={pending} onChange={enabled=>update({enabled})}/></div>
    {!gatewayConfigured&&<p className="sms-inline-warning">The server SMS gateway is not configured yet. You can save your token and message, then enable sending once it is ready.</p>}
    <label className="sms-field-label" htmlFor={`${id}-token`}>Subscription token</label><div className="sms-token-input"><input id={`${id}-token`} type={showToken?"text":"password"} autoComplete="new-password" spellCheck={false} value={token} disabled={removeToken} maxLength={4096} placeholder={hasToken?"Token saved — leave blank to keep it":"Paste your business token"} onChange={event=>{setToken(event.target.value);setMessage(null)}}/><button type="button" aria-label={showToken?"Hide entered token":"Show entered token"} onClick={()=>setShowToken(current=>!current)}>{showToken?<EyeOff size={17}/>:<Eye size={17}/>}</button></div><p className="sms-field-help">Stored securely for this business. Your saved token is never displayed.</p>
    {hasToken&&<label className="sms-remove-token"><input type="checkbox" checked={removeToken} onChange={event=>{setRemoveToken(event.target.checked);setToken("");setMessage(null)}}/>Remove saved token when saving</label>}
   </div></section>
   <section className="sms-settings-section"><div className="sms-section-intro"><h3>Payment receipts</h3><p>Automatically thank customers after their order is fully paid.</p></div><div className="sms-section-controls">
    <div className="sms-switch-row"><div><label htmlFor={`${id}-receipt`}>Send SMS after payment</label><p>Applies to dine-in, takeaway, and delivery orders with a valid customer phone.</p></div><Toggle id={`${id}-receipt`} label="Send SMS after payment" checked={settings.paymentReceiptEnabled} disabled={pending} onChange={paymentReceiptEnabled=>update({paymentReceiptEnabled})}/></div>
    <div className="sms-switch-row"><div><label htmlFor={`${id}-optout`}>Include opt-out instructions</label><p>Include instructions to reply STOP to stop messages and START to resume. Turning this off still allows payment SMS to be sent.</p></div><Toggle id={`${id}-optout`} label="Include opt-out instructions" checked={settings.includeOptOut} disabled={pending} onChange={includeOptOut=>update({includeOptOut})}/></div>
    {!settings.enabled&&settings.paymentReceiptEnabled&&<p className="sms-field-help">This message is paused while SMS sending is off.</p>}
    <div className="sms-composer"><div className="sms-editor"><div className="sms-editor-heading"><label htmlFor={`${id}-template`}>Payment message</label><button type="button" onClick={()=>update({template:DEFAULT_PAYMENT_SMS})}>Use default</button></div><textarea id={`${id}-template`} ref={editor} value={settings.template} maxLength={1000} rows={6} aria-invalid={!!templateError} aria-describedby={`${id}-template-help`} onChange={event=>update({template:event.target.value})}/><div className="sms-editor-meta"><span id={`${id}-template-help`}>{templateError||"Insert a field below to personalize the message."}</span><span>{settings.template.length}/1000</span></div><div className="sms-field-chips">{SMS_FIELDS.map(([field,label])=><button type="button" key={field} onClick={()=>insertField(field)} title={`Insert {{${field}}}`}><Plus size={12}/>{label}</button>)}</div></div>
     <aside className="sms-preview"><div><Smartphone size={16}/><span>Customer preview</span></div><div className="sms-preview-bubble">{previewText}</div><small>Sample customer data · {previewText.length} characters</small><p>{settings.includeOptOut?"Sample STOP / START wording. The gateway adds the final instructions.":"Opt-out instructions will not be added."}</p></aside>
    </div>
    <label className="sms-field-label" htmlFor={`${id}-evidence`}>Acknowledgement reference</label><input className="sms-evidence-input" id={`${id}-evidence`} value={settings.evidenceReference} maxLength={200} required onChange={event=>update({evidenceReference:event.target.value})}/><p className="sms-field-help">Sent as evidenceReference to your SMS gateway. Use the reference associated with the customer acknowledgement.</p>
   </div></section>
  </fieldset>
  <footer className="sms-settings-footer"><div className={message&&!message.ok?"sms-feedback is-error":"sms-feedback"} role="status" aria-live="polite">{message?.ok&&<Check size={16}/>}<span>{message?.text??(dirty?"You have unsaved changes.":"Payment receipts require SMS sending and payment messages to be enabled.")}</span></div><button type="submit" disabled={pending||!dirty||!!templateError}>{pending&&<LoaderCircle className="waiter-settings-spinner" size={16}/>}<span>{pending?"Saving…":"Save SMS settings"}</span></button></footer>
 </form>;
}
