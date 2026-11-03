"use client";
import { useId,useRef,useState,useTransition,type ReactNode } from "react";
import { Check,LoaderCircle,Plus,Smartphone,Truck,UtensilsCrossed } from "lucide-react";
import { saveDeliverySmsSettings,saveOrderSmsSettings } from "@/app/(dashboard)/settings/business/sms-actions";
import { DELIVERY_SMS_STAGES,ORDER_SMS_STAGES,SMS_FIELDS,renderPaymentSms,smsTemplateError,type DeliverySmsSettings,type OrderSmsSettings,type SmsValues } from "@/lib/sms-template";

type StageConfig={enabled:boolean;includeOptOut:boolean;template:string;dineIn?:boolean;takeaway?:boolean};
type Stage={key:string;label:string;description:string;template:string};
type CardText={title:string;intro:string;badge:string;noun:string;icon:ReactNode;save:string;saving:string;idle:string;failed:string;sample:Partial<SmsValues>};

export function DeliverySmsSettingsCard({initial,smsEnabled,hasToken,businessName,currency}:{initial:DeliverySmsSettings;smsEnabled:boolean;hasToken:boolean;businessName:string;currency:string}){
 return <StageSmsCard initial={initial} stages={DELIVERY_SMS_STAGES} smsEnabled={smsEnabled} hasToken={hasToken} businessName={businessName} currency={currency} onSave={values=>saveDeliverySmsSettings(values)}
  text={{title:"Delivery messages",intro:"Keep customers informed from placing an order to receiving it.",badge:"3 delivery updates",noun:"delivery",icon:<Truck size={21}/>,save:"Save delivery messages",saving:"Saving…",idle:"Each enabled message is sent once per delivery stage.",failed:"Could not save delivery messages. Please try again.",sample:{table_name:"Not applicable",delivery_address:"12 Main Street",delivery_area:"City Centre",delivery_charge:"150.00"}}}/>;
}

// Dine-in and takeaway customers chosen on the order; walk-in orders have no number and get nothing.
export function OrderSmsSettingsCard({initial,smsEnabled,hasToken,businessName,currency}:{initial:OrderSmsSettings;smsEnabled:boolean;hasToken:boolean;businessName:string;currency:string}){
 return <StageSmsCard initial={initial} stages={ORDER_SMS_STAGES} smsEnabled={smsEnabled} hasToken={hasToken} businessName={businessName} currency={currency} orderTypes onSave={values=>saveOrderSmsSettings(values)}
  text={{title:"Dine-in & takeaway messages",intro:"Text customers saved on dine-in, takeaway and QR table orders. Walk-in customers have no number and are never messaged.",badge:"5 order updates",noun:"order",icon:<UtensilsCrossed size={21}/>,save:"Save order messages",saving:"Saving…",idle:"Each enabled message is sent once per order, only when a customer with a mobile number is on it.",failed:"Could not save order messages. Please try again.",sample:{table_name:"Table 4",delivery_address:"Not applicable",delivery_area:"",delivery_charge:"0.00"}}}/>;
}

function StageSmsCard<T extends Record<string,StageConfig>>({initial,stages,smsEnabled,hasToken,businessName,currency,orderTypes=false,onSave,text}:{initial:T;stages:readonly Stage[];smsEnabled:boolean;hasToken:boolean;businessName:string;currency:string;orderTypes?:boolean;onSave:(values:T)=>Promise<{ok:boolean;message:string}>;text:CardText}){
 const id=useId(),editor=useRef<HTMLTextAreaElement>(null);
 const [values,setValues]=useState(initial),[saved,setSaved]=useState(initial),[active,setActive]=useState(stages[0].key),[pending,start]=useTransition(),[feedback,setFeedback]=useState<{ok:boolean;message:string}|null>(null);
 const stage=stages.find(row=>row.key===active)!,config=values[active],dirty=JSON.stringify(values)!==JSON.stringify(saved);
 const stageError=(row:StageConfig)=>smsTemplateError(row.template)??(orderTypes&&row.enabled&&!row.dineIn&&!row.takeaway?"Choose dine-in, takeaway or both.":null);
 const errors=stages.map(row=>({key:row.key,label:row.label,error:stageError(values[row.key])})),error=errors.find(row=>row.error);
 function update(change:Partial<StageConfig>){setValues(current=>({...current,[active]:{...current[active],...change}}));setFeedback(null)}
 const sample:SmsValues={customer_name:"Ali",business_name:businessName,business_phone:"0300 1234567",order_number:"ORD-000123",currency,amount_paid:"0.00",order_total:"2500.00",payment_method:"CASH",paid_at:"Not paid",customer_phone:"+923001234567",table_name:"",delivery_address:"",delivery_area:"",delivery_charge:"0.00",delivery_status:stage.label,event_at:"28/10/2026, 7:30 pm",...text.sample};
 let preview="";try{preview=renderPaymentSms(config.template,sample)}catch{preview=`Your ${text.noun} message preview will appear here.`}
 if(config.includeOptOut)preview+="\n\nReply STOP to stop messages. Reply START to resume.";
 function insert(field:string){const from=editor.current?.selectionStart??config.template.length,to=editor.current?.selectionEnd??from,inserted=`{{${field}}}`,template=config.template.slice(0,from)+inserted+config.template.slice(to);if(template.length>1000)return;update({template});requestAnimationFrame(()=>{editor.current?.focus();editor.current?.setSelectionRange(from+inserted.length,from+inserted.length)})}
 const toggle=(key:string,label:string,help:string,checked:boolean,change:(value:boolean)=>void)=><div className="sms-switch-row"><div><label htmlFor={`${id}-${active}-${key}`}>{label}</label><p>{help}</p></div><label className="sms-toggle"><input id={`${id}-${active}-${key}`} type="checkbox" role="switch" checked={checked} onChange={event=>change(event.target.checked)}/><span aria-hidden="true"><i/></span></label></div>;
 return <form className="sms-settings-card delivery-sms-card" aria-labelledby={`${id}-title`} onSubmit={event=>{event.preventDefault();if(pending||!dirty||error)return;setFeedback(null);start(async()=>{try{const response=await onSave(values);setFeedback(response);if(response.ok)setSaved(values)}catch{setFeedback({ok:false,message:text.failed})}})}}>
  <header className="sms-settings-header"><span className="sms-heading-icon">{text.icon}</span><div><h2 id={`${id}-title`}>{text.title}</h2><p>{text.intro}</p></div><span className="sms-token-badge">{text.badge}</span></header>
  <fieldset className="sms-settings-fields" disabled={pending}><legend className="business-profile-sr-only">{text.title} preferences</legend>
   {(!smsEnabled||!hasToken)&&<p className="delivery-sms-paused">Configure your token and turn on <strong>Enable SMS sending</strong> in SMS messaging above to send {text.noun} updates. You can prepare the messages here first.</p>}
   <div className="delivery-sms-tabs" aria-label={`Choose ${text.noun} message`}>{stages.map((row,index)=><button type="button" key={row.key} aria-pressed={active===row.key} onClick={()=>setActive(row.key)}><span>{index+1}</span><div><strong>{row.label}</strong><small>{values[row.key].enabled?"Enabled":"Disabled"}</small></div></button>)}</div>
   <section className="delivery-sms-editor">
    {toggle("enabled",`Send “${stage.label.toLowerCase()}” SMS`,stage.description,config.enabled,enabled=>update({enabled}))}
    {orderTypes&&<>
     {toggle("dine-in","Dine-in orders","Send this message for dine-in orders that have a customer.",config.dineIn!==false,dineIn=>update({dineIn}))}
     {toggle("takeaway","Takeaway orders","Send this message for takeaway orders that have a customer.",config.takeaway!==false,takeaway=>update({takeaway}))}
    </>}
    {toggle("optout","Include opt-out instructions",`Add instructions to reply STOP to stop messages and START to resume. This setting only changes this ${text.noun} message.`,config.includeOptOut,includeOptOut=>update({includeOptOut}))}
    <div className="sms-composer"><div className="sms-editor"><div className="sms-editor-heading"><label htmlFor={`${id}-${active}-template`}>{stage.label} message</label><button type="button" onClick={()=>update({template:stage.template})}>Use default</button></div><textarea ref={editor} id={`${id}-${active}-template`} rows={6} value={config.template} maxLength={1000} aria-invalid={!!smsTemplateError(config.template)} aria-describedby={`${id}-${active}-help`} onChange={event=>update({template:event.target.value})}/><div className="sms-editor-meta"><span id={`${id}-${active}-help`}>{smsTemplateError(config.template)||`Insert fields to personalize this ${text.noun} update.`}</span><span>{config.template.length}/1000</span></div><div className="sms-field-chips">{SMS_FIELDS.map(([field,label])=><button type="button" key={field} title={`Insert {{${field}}}`} onClick={()=>insert(field)}><Plus size={12}/>{label}</button>)}</div></div><aside className="sms-preview"><div><Smartphone size={16}/><span>Customer preview</span></div><div className="sms-preview-bubble">{preview}</div><small>Sample customer data · {preview.length} characters</small><p>{config.includeOptOut?"Sample STOP / START wording. The gateway adds the final instructions.":"Opt-out instructions will not be added."}</p></aside></div>
   </section>
  </fieldset>
  <footer className="sms-settings-footer"><div className={feedback&&!feedback.ok?"sms-feedback is-error":"sms-feedback"} role="status" aria-live="polite">{feedback?.ok&&<Check size={16}/>}<span>{feedback?.message??(error?`${error.label}: ${error.error}`:dirty?"You have unsaved changes.":text.idle)}</span></div><button type="submit" disabled={pending||!dirty||!!error}>{pending&&<LoaderCircle className="waiter-settings-spinner" size={16}/>}<span>{pending?text.saving:text.save}</span></button></footer>
 </form>;
}
