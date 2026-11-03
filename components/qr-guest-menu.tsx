"use client";

import Image from "next/image";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { ArrowLeft,ArrowRight,Ban,ChefHat,CircleCheck,Clock,Languages,Minus,Plus,Search,ShieldCheck,ShoppingBag,Trash2,UtensilsCrossed,X } from "lucide-react";
import { normalizeSmsPhone } from "@/lib/order-stage-sms.mjs";
import type { GuestMenuItem,GuestOrderStatus,QrTable } from "@/lib/qr-menu";
import { QR_LANGUAGES,QR_LANGUAGE_NAMES,QR_TEXT,isRtl,type QrLanguage,type QrText } from "@/lib/qr-menu-i18n";
import { QUICK_WEIGHTS,formatWeight,weightPrice } from "@/lib/weight";
import { randomId } from "@/lib/random-id";
import "@/app/qr-menu.css";

type Line={key:string;itemKey:string;kind:"PRODUCT"|"DEAL";id:string;variantName?:string;weightGrams?:number;quantity:number;note:string};
type Tracked={id:string;key:string;at:number};
type Step="menu"|"cart"|"details"|"done";
type Summary={subtotal:number;taxAmount:number;grandTotal:number};

const STAGES=["WAITING","CONFIRMED","PREPARING","READY","SERVED","COMPLETED"] as const;
const DAY=12*3600000;
// After a refresh the guest lands back on the "order placed" screen for this long, unless they chose "Order more".
const STATUS_TTL=4*3600000;
// Browser storage only remembers this phone's own cart, language and orders; the server keeps the real order.
function load<T>(key:string,fallback:T):T{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw) as T:fallback}catch{return fallback}}
function save(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Private mode: the page still works, it just forgets on reload. */}}
const hue=(text:string)=>[...text].reduce((sum,char)=>sum+char.charCodeAt(0),0)%360;

export function QrGuestMenu({token,business,table,menu}:{token:string;business:QrTable["business"];table:QrTable["table"];menu:{items:GuestMenuItem[];categories:string[]}}){
 const[language,setLanguage]=useState<QrLanguage>("en"),[step,setStep]=useState<Step>("menu"),[lines,setLines]=useState<Line[]>([]),[query,setQuery]=useState(""),[category,setCategory]=useState("ALL");
 const[weighing,setWeighing]=useState<GuestMenuItem|null>(null),[name,setName]=useState(""),[phone,setPhone]=useState(""),[error,setError]=useState(""),[sending,setSending]=useState(false);
 const[tracked,setTracked]=useState<Tracked[]>([]),[statuses,setStatuses]=useState<Record<string,GuestOrderStatus>>({}),[preview,setPreview]=useState<Summary|null>(null),[languageOpen,setLanguageOpen]=useState(false),[justOrdered,setJustOrdered]=useState(false);
 const[verify,setVerify]=useState<{phone:string;resendAt:number}|null>(null),[code,setCode]=useState(""),[verifyError,setVerifyError]=useState(""),[checking,setChecking]=useState(false),[clock,setClock]=useState(0);
 const[loaded,setLoaded]=useState(false);
 const submissionKey=useRef<string|null>(null);
 const t=QR_TEXT[language],rtl=isRtl(language);
 const money=(value:number)=>`${business.currency} ${value.toLocaleString("en-PK",{maximumFractionDigits:2})}`;
 const itemMap=useMemo(()=>new Map(menu.items.map(item=>[item.key,item])),[menu.items]);

 useEffect(()=>{
  // Restored after mount so the server render and the first client render match.
  const saved=load<QrLanguage>("qr-menu.language","en");
  const guest=load<{name?:string;phone?:string}>("qr-menu.guest",{});
  const orders=load<Tracked[]>(`qr-menu.orders.${token}`,[]).filter(order=>Date.now()-order.at<DAY);
  const cart=load<Line[]>(`qr-menu.cart.${token}`,[]).filter(line=>itemMap.has(line.itemKey));
  const showStatus=load<boolean>(`qr-menu.status.${token}`,false)&&orders.length>0&&Date.now()-orders[0].at<STATUS_TTL;
  /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from this phone's storage */
  if(QR_LANGUAGES.includes(saved))setLanguage(saved);
  setName(guest.name??"");setPhone(guest.phone??"");setTracked(orders);setLines(cart);
  if(showStatus){setStep("done");setJustOrdered(true)}
  // Saving waits for this render, so the empty initial state never overwrites what was just read.
  setLoaded(true);
  /* eslint-enable react-hooks/set-state-in-effect */
 },[token,itemMap]);
 useEffect(()=>{if(loaded)save(`qr-menu.cart.${token}`,lines)},[loaded,lines,token]);
 useEffect(()=>{if(loaded)save(`qr-menu.orders.${token}`,tracked)},[loaded,tracked,token]);
 useEffect(()=>{if(loaded)save(`qr-menu.status.${token}`,justOrdered)},[loaded,justOrdered,token]);
 useEffect(()=>{window.scrollTo({top:0})},[step]);
 useEffect(()=>{if(!verify)return;const timer=window.setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[verify]);

 const refreshStatuses=useCallback(async(orders:Tracked[])=>{
  const results=await Promise.all(orders.map(async order=>{try{const response=await fetch(`/api/menu/${token}/orders/${order.id}?key=${encodeURIComponent(order.key)}`,{cache:"no-store"});return response.ok?[order.id,await response.json() as GuestOrderStatus] as const:null}catch{return null}}));
  setStatuses(current=>({...current,...Object.fromEntries(results.filter(row=>row!==null))}));
 },[token]);
 const open=tracked.filter(order=>!["COMPLETED","CANCELLED"].includes(statuses[order.id]?.stage??""));
 useEffect(()=>{
  if(!tracked.length)return;
  const update=()=>{if(document.visibilityState==="visible")void refreshStatuses(tracked)};
  update();
  const timer=window.setInterval(update,step==="done"?6000:20000);
  document.addEventListener("visibilitychange",update);
  return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",update)};
 },[tracked,step,refreshStatuses]);

 const payload=lines.map(line=>({kind:line.kind,id:line.id,variantName:line.variantName,weightGrams:line.weightGrams,quantity:line.quantity,note:line.note}));
 const payloadKey=JSON.stringify(payload);
 useEffect(()=>{
  if(step!=="cart"&&step!=="details"||!business.showSummary||!lines.length)return;
  const controller=new AbortController();
  const timer=window.setTimeout(()=>{fetch(`/api/menu/${token}/preview`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lines:JSON.parse(payloadKey)}),signal:controller.signal}).then(response=>response.ok?response.json():null).then(result=>setPreview(result?.ok?result:null)).catch(()=>{})},350);
  return()=>{clearTimeout(timer);controller.abort()};
 },[payloadKey,step,business.showSummary,token,lines.length]);

 const linePrice=(line:Line)=>{const item=itemMap.get(line.itemKey);if(!item)return 0;return (line.weightGrams?weightPrice(item.price,line.weightGrams):item.price)*line.quantity};
 const count=lines.reduce((sum,line)=>sum+line.quantity,0),estimate=lines.reduce((sum,line)=>sum+linePrice(line),0);
 const quantityOf=(item:GuestMenuItem)=>lines.filter(line=>line.itemKey===item.key).reduce((sum,line)=>sum+line.quantity,0);
 function add(item:GuestMenuItem,weightGrams?:number){
  if(item.byWeight&&!weightGrams){setWeighing(item);return}
  const key=`${item.key}:${weightGrams??""}`;
  setLines(current=>current.some(line=>line.key===key)?current.map(line=>line.key===key?{...line,quantity:Math.min(20,line.quantity+1)}:line):[...current,{key,itemKey:item.key,kind:item.kind,id:item.id,variantName:item.variantName,weightGrams,quantity:1,note:""}]);
 }
 const change=(key:string,delta:number)=>setLines(current=>current.flatMap(line=>line.key!==key?[line]:line.quantity+delta<=0?[]:[{...line,quantity:Math.min(20,line.quantity+delta)}]));
 // On the menu, minus takes away the most recently added line of that dish (a KG dish can have several weights).
 const removeOne=(item:GuestMenuItem)=>{const last=[...lines].reverse().find(line=>line.itemKey===item.key);if(last)change(last.key,-1)};

 const filtered=useMemo(()=>{const text=query.trim().toLowerCase();return menu.items.filter(item=>(category==="ALL"||item.category===category)&&(!text||item.name.toLowerCase().includes(text)||item.description.toLowerCase().includes(text)))},[menu.items,query,category]);
 const categoryLabel=(value:string)=>value==="Deals"||value==="Menu"?t[value]:value;

 const errorText=(code?:string)=>t[`error_${code}` as keyof QrText]??t.error_ERROR;
 // A verified number's pass, kept per restaurant, so this phone is asked for an SMS code only once.
 const passKey=`qr-menu.pass.${business.id}`;
 async function submit(pass?:string){
  if(sending)return;
  setError("");
  if(name.trim().length<2){setError(t.error_NAME);return}
  if(!/^(\+?92|0)?3\d{9}$|^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s().-]/g,""))){setError(t.error_PHONE);return}
  const number=normalizeSmsPhone(phone)??"",passes=load<Record<string,string>>(passKey,{});
  submissionKey.current??=randomId();
  setSending(true);
  try{
   const response=await fetch(`/api/menu/${token}/orders`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({submissionKey:submissionKey.current,language,name:name.trim(),phone:phone.trim(),verification:pass??passes[number],lines:payload})});
   const result=await response.json().catch(()=>({ok:false,code:"ERROR"})) as {ok:true;id:string;key:string}|{ok:false;code:string};
   if(!result.ok&&result.code==="VERIFY"){
    // No pass, or it ran out: text a code and ask for it. The order is sent once the code checks out.
    if(passes[number]){delete passes[number];save(passKey,passes)}
    await sendCode();
    return;
   }
   if(!result.ok){
    setError(errorText(result.code));
    if(result.code==="UNAVAILABLE"||result.code==="EMPTY")setStep("cart");
    // A rejected order was not saved, so the next try is a new submission.
    submissionKey.current=null;
    return;
   }
   save("qr-menu.guest",{name:name.trim(),phone:phone.trim()});
   const next=[{id:result.id,key:result.key,at:Date.now()},...tracked.filter(order=>order.id!==result.id)].slice(0,8);
   setTracked(next);setLines([]);setPreview(null);submissionKey.current=null;setJustOrdered(true);setStep("done");
   void refreshStatuses(next.slice(0,1));
  }catch{setError(t.error_ERROR)}
  finally{setSending(false)}
 }
 async function sendCode(){
  setVerifyError("");setCode("");
  const now=Date.now();
  try{
   const response=await fetch(`/api/menu/${token}/verify`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:phone.trim()})});
   const result=await response.json().catch(()=>({ok:false,code:"ERROR"})) as {ok:boolean;code?:string};
   setClock(now);setVerify(current=>({phone:phone.trim(),resendAt:result.ok?now+60000:current?.resendAt??now}));
   if(!result.ok)setVerifyError(errorText(result.code));
  }catch{setClock(now);setVerify(current=>({phone:phone.trim(),resendAt:current?.resendAt??now}));setVerifyError(t.error_ERROR)}
 }
 async function checkCode(value=code){
  if(checking||!verify||!/^\d{4}$/.test(value))return;
  setChecking(true);setVerifyError("");
  try{
   const response=await fetch(`/api/menu/${token}/verify`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:verify.phone,code:value})});
   const result=await response.json().catch(()=>({ok:false,code:"ERROR"})) as {ok:true;pass:string}|{ok:false;code:string};
   if(!result.ok){setVerifyError(errorText(result.code));setCode("");return}
   const number=normalizeSmsPhone(verify.phone);
   if(number)save(passKey,{...load<Record<string,string>>(passKey,{}),[number]:result.pass});
   setVerify(null);setCode("");
   await submit(result.pass);
  }catch{setVerifyError(t.error_ERROR)}
  finally{setChecking(false)}
 }
 const chooseLanguage=(value:QrLanguage)=>{setLanguage(value);save("qr-menu.language",value);setLanguageOpen(false)};

 const steps=[["menu",t.Menu],["cart",t.yourOrder],["details",t.yourDetails]] as const;
 const stepIndex=steps.findIndex(([key])=>key===step);
 type Row={key:string;name:string;detail?:string;note?:string;quantity:number;unitPrice?:number};
 const itemTable=(rows:Row[])=><table className="qr-item-table"><thead><tr><th scope="col">{t.itemName}</th>{business.showSummary&&<th scope="col">{t.price}</th>}<th scope="col">{t.qty}</th>{business.showSummary&&<th scope="col">{t.amount}</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.key}><td>{row.name}{row.detail&&<span dir="ltr"> · {row.detail}</span>}{row.note&&<small>{row.note}</small>}</td>{business.showSummary&&<td dir="ltr">{money(row.unitPrice??0)}</td>}<td>{row.quantity}</td>{business.showSummary&&<td dir="ltr">{money((row.unitPrice??0)*row.quantity)}</td>}</tr>)}</tbody></table>;
 const unitPrice=(line:Line)=>{const item=itemMap.get(line.itemKey);return item?(line.weightGrams?weightPrice(item.price,line.weightGrams):item.price):0};
 const summary=(values:Summary&{discountAmount?:number})=><dl className="qr-summary"><div><dt>{t.subtotal}</dt><dd>{money(values.subtotal)}</dd></div>{(values.discountAmount??0)>0&&<div><dt>{t.discount}</dt><dd>-{money(values.discountAmount!)}</dd></div>}{values.taxAmount>0&&<div><dt>{t.tax}</dt><dd>{money(values.taxAmount)}</dd></div>}<div className="qr-summary-total"><dt>{t.total}</dt><dd>{money(values.grandTotal)}</dd></div></dl>;

 return <div className={`qr-app${rtl?" is-rtl":""}`} dir={rtl?"rtl":"ltr"} lang={language==="sd"?"sd":language==="ur"?"ur":"en"}>
  <header className="qr-hero">
   <div className="qr-hero-top">
    <div className="qr-brand">{business.logoUrl?<Image src={business.logoUrl} alt="" width={52} height={52} unoptimized/>:<span aria-hidden="true">{business.name.slice(0,1)}</span>}<div><small>{t.welcome}</small><h1>{business.name}</h1></div></div>
    <div className="qr-language">
     <button type="button" aria-haspopup="true" aria-expanded={languageOpen} onClick={()=>setLanguageOpen(value=>!value)}><Languages size={18}/><span>{QR_LANGUAGE_NAMES[language]}</span></button>
     {languageOpen&&<div role="menu" aria-label={t.language}>{QR_LANGUAGES.map(value=><button type="button" role="menuitemradio" aria-checked={value===language} key={value} lang={value} onClick={()=>chooseLanguage(value)}>{QR_LANGUAGE_NAMES[value]}{value===language&&<CircleCheck size={16}/>}</button>)}</div>}
    </div>
   </div>
   <div className="qr-table-pill"><UtensilsCrossed size={16}/><span>{t.table}</span><b>{table.number??table.name}</b>{table.number!==null&&table.name!==String(table.number)&&<small>{table.name}</small>}</div>
   {step==="menu"&&<p className="qr-intro">{t.intro}</p>}
   {step!=="done"&&<ol className="qr-steps" aria-label={t.orderStatus}>{steps.map(([key,label],index)=><li key={key} className={index<stepIndex?"is-done":index===stepIndex?"is-current":""} aria-current={index===stepIndex?"step":undefined}><span>{index<stepIndex?<CircleCheck size={14}/>:index+1}</span>{label}</li>)}</ol>}
  </header>

  {open.length>0&&step!=="done"&&<button type="button" className="qr-open-orders" onClick={()=>setStep("done")}><Clock size={18}/><span>{t.orderStatus}</span><b>{open.length}</b></button>}

  {step==="menu"&&<main className="qr-menu">
   <div className="qr-sticky">
    <label className="qr-search"><Search size={18}/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t.search} aria-label={t.search}/>{query&&<button type="button" aria-label="Clear" onClick={()=>setQuery("")}><X size={16}/></button>}</label>
    <nav className="qr-categories" aria-label={t.Menu}>{["ALL",...menu.categories].map(value=><button type="button" key={value} aria-pressed={category===value} onClick={()=>setCategory(value)}>{value==="ALL"?t.all:categoryLabel(value)}</button>)}</nav>
   </div>
   {filtered.length?<ul className="qr-items">{filtered.map(item=>{const quantity=quantityOf(item);return <li key={item.key} className={quantity?"in-cart":""}>
    <div className="qr-item-photo" style={{"--qr-hue":hue(item.name)} as React.CSSProperties}>{item.imageUrl?<Image src={item.imageUrl} alt="" width={96} height={96} unoptimized/>:<span aria-hidden="true">{item.name.slice(0,1)}</span>}{quantity>0&&<b className="qr-item-badge">{quantity}</b>}</div>
    <div className="qr-item-copy"><h3>{item.name}</h3>{item.description&&<p>{item.description}</p>}<strong className="qr-price" dir="ltr">{money(item.price)}{item.byWeight&&<small> / {t.perKg}</small>}</strong></div>
    <div className="qr-item-action">{quantity>0&&!item.byWeight?<div className="qr-stepper"><button type="button" aria-label={`${t.decrease}: ${item.name}`} onClick={()=>removeOne(item)}><Minus size={18}/></button><output aria-live="polite">{quantity}</output><button type="button" aria-label={`${t.increase}: ${item.name}`} onClick={()=>add(item)}><Plus size={18}/></button></div>:<button type="button" className="qr-add" onClick={()=>add(item)}><Plus size={18}/>{t.add}</button>}</div>
   </li>})}</ul>:<div className="qr-empty"><Search size={30}/><p>{t.noItems}</p></div>}
  </main>}

  {step==="cart"&&<main className="qr-panel">
   <h2>{t.yourOrder}</h2>
   {lines.length?<ul className="qr-cart">{lines.map(line=>{const item=itemMap.get(line.itemKey);if(!item)return null;return <li key={line.key}>
    <div className="qr-cart-row"><div><h3>{item.name}{line.weightGrams?<small dir="ltr"> · {formatWeight(line.weightGrams)}</small>:null}</h3>{business.showSummary&&<strong className="qr-price" dir="ltr">{money(unitPrice(line))} × {line.quantity} = {money(linePrice(line))}</strong>}</div>
     <div className="qr-stepper"><button type="button" aria-label={`${t.decrease}: ${item.name}`} onClick={()=>change(line.key,-1)}>{line.quantity===1?<Trash2 size={17}/>:<Minus size={18}/>}</button><output>{line.quantity}</output><button type="button" aria-label={`${t.increase}: ${item.name}`} onClick={()=>change(line.key,1)}><Plus size={18}/></button></div></div>
    <label className="qr-note"><span>{t.note}</span><input value={line.note} maxLength={150} placeholder={t.notePlaceholder} onChange={event=>{const note=event.target.value;setLines(current=>current.map(row=>row.key===line.key?{...row,note}:row))}}/></label>
   </li>})}</ul>:<div className="qr-empty"><ShoppingBag size={34}/><p>{t.emptyCart}</p></div>}
   {business.showSummary&&lines.length>0&&(preview?summary(preview):summary({subtotal:estimate,taxAmount:0,grandTotal:estimate}))}
   {business.showSummary&&lines.length>0&&<p className="qr-hint">{t.finalBill}</p>}
  </main>}

  {step==="details"&&<main className="qr-panel">
   <h2>{t.yourDetails}</h2>
   <p className="qr-hint">{t.detailsIntro}</p>
   <form className="qr-form" onSubmit={event=>{event.preventDefault();void submit()}}>
    <label><span>{t.name}</span><input value={name} onChange={event=>setName(event.target.value)} autoComplete="name" maxLength={60} placeholder={t.namePlaceholder} required/></label>
    <label><span>{t.phone}</span><input value={phone} onChange={event=>setPhone(event.target.value)} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={20} placeholder={t.phonePlaceholder} required/></label>
    <section className="qr-review" aria-label={t.yourOrder}>
     <h3>{t.yourOrder} · {count} {count===1?t.item:t.items}</h3>
     {itemTable(lines.flatMap(line=>{const item=itemMap.get(line.itemKey);return item?[{key:line.key,name:item.name,detail:line.weightGrams?formatWeight(line.weightGrams):undefined,note:line.note,quantity:line.quantity,unitPrice:unitPrice(line)}]:[]}))}
     {business.showSummary&&(preview?summary(preview):summary({subtotal:estimate,taxAmount:0,grandTotal:estimate}))}
    </section>
    <button type="submit" hidden/>
   </form>
  </main>}

  {step==="done"&&<main className="qr-panel qr-done">
   {(()=>{const latest=tracked[0],status=latest?statuses[latest.id]:undefined;return latest&&justOrdered&&(!status||status.stage==="WAITING")?<div className="qr-thanks"><div className="qr-thanks-mark"><CircleCheck size={46}/></div><h2>{t.thanks}{status?.guestName?`, ${status.guestName}`:name?`, ${name}`:""}!</h2><p>{t.waiterWillConfirm}</p><small>{t.smsUpdates}</small></div>:null})()}
   <h2 className="qr-status-heading">{t.orderStatus}</h2>
   {tracked.map(order=>{const status=statuses[order.id];if(!status)return <div className="qr-status-card is-loading" key={order.id}><Clock size={18}/></div>;const current=STAGES.indexOf(status.stage as (typeof STAGES)[number]);return <article className={`qr-status-card stage-${status.stage.toLowerCase()}`} key={order.id}>
    <header>{status.stage==="CANCELLED"?<Ban size={22}/>:status.stage==="WAITING"?<Clock size={22}/>:status.stage==="PREPARING"?<ChefHat size={22}/>:<CircleCheck size={22}/>}<div><strong>{t[`stage_${status.stage}` as keyof QrText]}</strong><small dir="ltr">{status.orderNumber?`${t.orderNumber} ${status.orderNumber} · `:""}{new Date(status.createdAt).toLocaleTimeString("en-PK",{hour:"numeric",minute:"2-digit"})}</small></div>{status.paid&&<span className="qr-paid">{t.paid}</span>}</header>
    {status.stage!=="CANCELLED"&&<ol className="qr-timeline">{STAGES.map((stage,index)=><li key={stage} className={index<=current?"is-done":""}><span/>{t[`stage_${stage}` as keyof QrText].split(" — ")[0]}</li>)}</ol>}
    {itemTable(status.lines.map((line,index)=>({key:String(index),name:line.name,note:line.note,quantity:line.quantity,unitPrice:line.unitPrice})))}
    {status.summary&&summary(status.summary)}
   </article>})}
  </main>}

  <footer className="qr-credit">{t.poweredBy}</footer>

  <div className="qr-bar"><div className="qr-bar-actions">
   {step==="menu"&&<button type="button" className="qr-primary" disabled={!count} onClick={()=>{setError("");setStep("cart")}}><ShoppingBag size={20}/><span>{t.viewCart}</span>{count>0&&<b>{count} {count===1?t.item:t.items}{business.showSummary?<i dir="ltr"> · {money(estimate)}</i>:null}</b>}</button>}
   {step==="cart"&&<><button type="button" className="qr-secondary" onClick={()=>setStep("menu")}><ArrowLeft className="qr-flip" size={18}/>{t.backToMenu}</button><button type="button" className="qr-primary" disabled={!count} onClick={()=>{setError("");setStep("details")}}>{t.continue}<ArrowRight className="qr-flip" size={18}/></button></>}
   {step==="details"&&<><button type="button" className="qr-secondary" disabled={sending} onClick={()=>setStep("cart")}><ArrowLeft className="qr-flip" size={18}/>{t.back}</button><button type="button" className="qr-primary qr-confirm" disabled={sending||!count} onClick={()=>void submit()}><CircleCheck size={20}/>{sending?t.sending:t.confirmOrder}</button></>}
   {step==="done"&&<button type="button" className="qr-primary" onClick={()=>{setJustOrdered(false);setStep("menu")}}><Plus size={20}/>{t.orderMore}</button>}
  </div>{error&&step!=="menu"&&step!=="done"&&<p className="qr-error" role="alert">{error}</p>}</div>

  {weighing&&<div className="qr-sheet-backdrop" onClick={()=>setWeighing(null)}><section className="qr-sheet" role="dialog" aria-modal="true" aria-label={t.chooseWeight} onClick={event=>event.stopPropagation()}>
   <header><div><small>{t.chooseWeight}</small><h3>{weighing.name}</h3></div><button type="button" aria-label="Close" onClick={()=>setWeighing(null)}><X size={20}/></button></header>
   <div className="qr-weights">{QUICK_WEIGHTS.map(grams=><button type="button" key={grams} onClick={()=>{add(weighing,grams);setWeighing(null)}}><b dir="ltr">{formatWeight(grams)}</b><span dir="ltr">{money(weightPrice(weighing.price,grams))}</span></button>)}</div>
  </section></div>}

  {verify&&<div className="qr-sheet-backdrop" onClick={()=>{if(!checking)setVerify(null)}}><section className="qr-sheet qr-verify" role="dialog" aria-modal="true" aria-labelledby="qr-verify-title" onClick={event=>event.stopPropagation()}>
   <header><div><small><ShieldCheck size={15}/> {t.verifyOnce}</small><h3 id="qr-verify-title">{t.verifyTitle}</h3></div><button type="button" aria-label="Close" disabled={checking} onClick={()=>setVerify(null)}><X size={20}/></button></header>
   <p className="qr-verify-sent">{t.verifySent} <b dir="ltr">{verify.phone}</b></p>
   <form onSubmit={event=>{event.preventDefault();void checkCode()}}>
    <label className="qr-verify-code"><span>{t.code}</span><input value={code} disabled={checking} inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={4} aria-invalid={!!verifyError} aria-describedby={verifyError?"qr-verify-error":undefined} onChange={event=>{const value=event.target.value.replace(/\D/g,"").slice(0,4);setCode(value);setVerifyError("");if(value.length===4)void checkCode(value)}}/></label>
    {verifyError&&<p className="qr-error" id="qr-verify-error" role="alert">{verifyError}</p>}
    <button type="submit" className="qr-primary" disabled={checking||code.length!==4}><ShieldCheck size={20}/>{checking?t.verifying:t.verifyButton}</button>
   </form>
   <div className="qr-verify-links">
    <button type="button" disabled={checking||clock<verify.resendAt} onClick={()=>void sendCode()}>{clock<verify.resendAt?`${t.resendIn} ${Math.ceil((verify.resendAt-clock)/1000)} ${t.seconds}`:t.resend}</button>
    <button type="button" disabled={checking} onClick={()=>setVerify(null)}>{t.changeNumber}</button>
   </div>
  </section></div>}
 </div>;
}

// Shown for an invalid or retired QR code, or when the owner has QR ordering switched off. All three languages at once,
// because the guest has not picked one yet.
export function QrGuestNotice({code,businessName}:{code:"INVALID"|"CLOSED"|"COUNTER_CLOSED";businessName?:string}){
 return <div className="qr-app qr-notice-page"><main className="qr-notice">
  <div className="qr-notice-mark">{code==="INVALID"?<Ban size={38}/>:<Clock size={38}/>}</div>
  {businessName&&<h1>{businessName}</h1>}
  {QR_LANGUAGES.map(language=><p key={language} dir={isRtl(language)?"rtl":"ltr"} lang={language}>{QR_TEXT[language][`error_${code}`]}</p>)}
 </main><footer className="qr-credit">{QR_TEXT.en.poweredBy}</footer></div>;
}
