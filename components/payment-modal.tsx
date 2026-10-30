"use client";
import { useCan } from "@/components/permission-provider";
import { useRouter } from "next/navigation";
import { useEffect,useRef,useState,useTransition } from "react";
import { Banknote,X,RefreshCw,TicketPercent } from "lucide-react";
import Swal from "sweetalert2";
import { completeOrderPayment,completeDeliveryPayment,previewPaymentTax } from "@/app/(dashboard)/payments/actions";
import { applyOrderCoupon,customerCoupons,removeOrderCoupon } from "@/app/(dashboard)/payments/coupon-actions";
import { completeTakeawayPayment,previewTakeawayPayment } from "@/app/(dashboard)/orders/actions";
import type { OrderInput } from "@/lib/validation/order";
import { createPrinterAdapter } from "@/lib/printers";
import { PAYMENT_METHODS,type PaymentMethod } from "@/lib/tax";
type Quote={orderId:string;subtotal:number;discountAmount?:number;taxAmount:number;grandTotal:number;dueAmount:number;taxRate?:number;method:PaymentMethod;coupon?:{code:string;description?:string;batchName?:string}|null;couponError?:string;customerId?:string;prefillDue?:boolean};
type CustomerCoupon={code:string;batchName:string;description:string};
const money=(value:number)=>'Rs '+value.toLocaleString("en-PK",{maximumFractionDigits:2});
const escape=(value:string)=>value.replace(/[&<>"']/g,character=>`&#${character.charCodeAt(0)};`);
export function PaymentModal({orderId,dueAmount,autoOpen=false,initialMethod="CASH",completionHref,hideTrigger=false,onCompleted,draftOrder,onDismiss,completeDelivery=false}:{orderId:string;dueAmount:number;autoOpen?:boolean;initialMethod?:PaymentMethod;completionHref?:string;hideTrigger?:boolean;onCompleted?:()=>void;draftOrder?:OrderInput;onDismiss?:()=>void;completeDelivery?:boolean}){
 const allowed=useCan()("payments"),router=useRouter(),dialog=useRef<HTMLDialogElement>(null),[opened,setOpened]=useState(autoOpen),[method,setMethod]=useState<PaymentMethod>(initialMethod),[quote,setQuote]=useState<Quote|null>(null),[amount,setAmount]=useState(dueAmount),[attempt,setAttempt]=useState(""),[error,setError]=useState(""),[refresh,setRefresh]=useState(0),[pending,startTransition]=useTransition();
 // Takeaway drafts carry the code into the preview; saved orders hold the coupon on the server.
 const [draftCoupon,setDraftCoupon]=useState(""),[codeInput,setCodeInput]=useState(""),[couponMessage,setCouponMessage]=useState(""),[couponBusy,setCouponBusy]=useState(false),[saved,setSaved]=useState<{customerId:string;coupons:CustomerCoupon[]}>({customerId:"",coupons:[]});
 const ready=quote?.method===method&&quote.orderId===orderId;
 const change=method==="CASH"&&quote?Math.max(0,amount-quote.dueAmount):0;
 const appliedCoupon=quote?.coupon??null,busy=pending||couponBusy;
 const customerId=draftOrder?draftOrder.customerId??"":quote?.customerId??"";
 const open=()=>{setMethod(initialMethod);setQuote(null);setAttempt(crypto.randomUUID());setError("");setCouponMessage("");setCodeInput("");setOpened(true);dialog.current?.showModal()};
 useEffect(()=>{if(autoOpen)dialog.current?.showModal()},[autoOpen]);
 useEffect(()=>{if(!opened||!allowed)return;let active=true;(draftOrder?previewTakeawayPayment({...draftOrder,paymentMethod:method,couponCode:draftCoupon||undefined}):previewPaymentTax(orderId,method)).then(result=>{if(!active)return;if(result.ok){setQuote({...result,orderId});setAmount(result.prefillDue===false&&method==="CASH"&&result.dueAmount>0?0:result.dueAmount);if("couponError" in result&&result.couponError){setCouponMessage(result.couponError);setDraftCoupon("")}}else setError(result.message)}).catch(()=>{if(active)setError("Could not calculate invoice totals. Please retry.")});return()=>{active=false}},[opened,allowed,orderId,method,refresh,draftOrder,draftCoupon]);
 useEffect(()=>{if(!opened||!allowed||!customerId)return;let active=true;customerCoupons(customerId).then(result=>{if(active)setSaved({customerId,coupons:result.coupons})}).catch(()=>{});return()=>{active=false}},[opened,allowed,customerId,refresh]);
 // A list fetched for a previous customer is never shown for the current one.
 const savedCoupons=opened&&customerId&&saved.customerId===customerId?saved.coupons:[];
 const refreshQuote=()=>{setQuote(null);setError("");setRefresh(value=>value+1)};
 const applyCoupon=async(code:string)=>{
  const clean=code.replace(/[\s-]/g,"");setCouponMessage("");
  if(!/^[1-9]\d{9}$/.test(clean)){setCouponMessage("Enter the 10-digit coupon code.");return}
  if(draftOrder){setDraftCoupon(clean);refreshQuote();setCodeInput("");return}
  setCouponBusy(true);
  try{const result=await applyOrderCoupon(orderId,clean);if(!result.ok){setCouponMessage(result.message);return}setCodeInput("");refreshQuote();router.refresh()}
  catch{setCouponMessage("Could not apply this coupon. Please try again.")}finally{setCouponBusy(false)}
 };
 const removeCoupon=async()=>{
  setCouponMessage("");
  if(draftOrder){setDraftCoupon("");refreshQuote();return}
  setCouponBusy(true);
  try{const result=await removeOrderCoupon(orderId);if(!result.ok){setCouponMessage(result.message);return}refreshQuote();router.refresh()}
  catch{setCouponMessage("Could not remove the coupon. Please try again.")}finally{setCouponBusy(false)}
 };
 const submit=(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!ready||!quote)return;const data=new FormData(event.currentTarget),key=attempt||crypto.randomUUID();if(!attempt)setAttempt(key);startTransition(async()=>{try{const paymentInput={orderId,idempotencyKey:key,method,expectedGrandTotal:quote.grandTotal,tenderedAmount:amount,reference:String(data.get("reference")??""),notes:String(data.get("notes")??"")};const result=await (draftOrder?completeTakeawayPayment({...draftOrder,couponCode:draftCoupon||undefined},paymentInput):completeDelivery?completeDeliveryPayment(paymentInput):completeOrderPayment(paymentInput));if(!result.ok){setError(result.message);return}dialog.current?.close();
  const issued=result.issuedCoupons??[];
  const issuedHtml=issued.length?'<div class="payment-issued-coupons"><b>Coupon for the customer\'s next visit</b>'+issued.map(item=>'<p><strong>'+escape(item.code)+'</strong><span>'+escape(item.batchName)+' · '+escape(item.description)+'</span></p>').join("")+'</div>':"";
  await Swal.fire({target:document.querySelector<HTMLElement>(".pos-orders-dialog[open]")??document.body,icon:"success",title:completeDelivery?"Payment received & delivery confirmed":"Payment received",html:escape(result.orderNumber)+'<br/><strong>'+money(result.amount)+'</strong>'+(result.change>0?'<br/>Change: <strong>'+money(result.change)+'</strong>':'')+issuedHtml,timer:issued.length?undefined:1700,showConfirmButton:issued.length>0,confirmButtonText:"Done"});
  if(result.autoPrint){const printed=await createPrinterAdapter(result.printerMode).printCustomerReceipt(result.orderId);if(!printed.ok)await Swal.fire({target:document.querySelector<HTMLElement>(".pos-orders-dialog[open]")??document.body,icon:"error",title:"Customer receipt was NOT printed",text:printed.message})}onCompleted?.();if(completionHref)router.replace(completionHref);else router.refresh()}catch{setError("Payment could not be confirmed. Refresh the order before retrying.")}})};
 if(!allowed)return null;
 return <>{!hideTrigger&&<button className="payment-trigger" onClick={open}><Banknote size={17}/>Receive payment</button>}<dialog className="payment-dialog" ref={dialog} onClose={()=>{setOpened(false);onDismiss?.()}} onCancel={event=>{if(busy)event.preventDefault()}} onClick={event=>{if(event.target===dialog.current&&!busy)dialog.current.close()}}><form onSubmit={submit}><header><div><span>{completeDelivery?"Delivery completion":"Payment"}</span><h2>{completeDelivery?"Receive payment & deliver":"Receive payment"}</h2></div><button type="button" disabled={busy} onClick={()=>dialog.current?.close()} aria-label="Close"><X size={20}/></button></header>{completeDelivery&&<p className="payment-delivery-note">Payment and delivery will be confirmed together. Cancelling keeps the order out for delivery.</p>}<div className="payment-due"><span>Amount due</span><strong>{ready&&quote?money(quote.dueAmount):"Calculating..."}</strong></div><div className="payment-methods">{PAYMENT_METHODS.map(value=><button type="button" aria-pressed={method===value} disabled={busy} className={method===value?"active":""} onClick={()=>{setMethod(value);setQuote(null);setError("");setRefresh(v=>v+1)}} key={value}>{value.charAt(0)+value.slice(1).toLowerCase()}</button>)}</div>
  <section className="payment-coupon" aria-label="Coupon">
   {appliedCoupon?<div className="payment-coupon-applied"><TicketPercent size={18}/><div><strong>Coupon {appliedCoupon.code}</strong><small>{appliedCoupon.description||appliedCoupon.batchName}</small></div><button type="button" disabled={busy} onClick={()=>void removeCoupon()}>Remove</button></div>
   :<><div className="payment-coupon-entry"><label><span>Coupon code (optional)</span><input inputMode="numeric" autoComplete="off" maxLength={14} placeholder="10-digit code" value={codeInput} disabled={busy} onChange={event=>{setCodeInput(event.target.value);setCouponMessage("")}} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();void applyCoupon(codeInput)}}}/></label><button type="button" disabled={busy||!codeInput.trim()} onClick={()=>void applyCoupon(codeInput)}>{couponBusy?"Checking...":"Apply"}</button></div>
    {savedCoupons.length>0&&<div className="payment-coupon-saved"><span>This customer&apos;s coupons</span>{savedCoupons.map(item=><button type="button" key={item.code} disabled={busy} onClick={()=>void applyCoupon(item.code)} title={item.description}><TicketPercent size={14}/>{item.code}<small>{item.batchName}</small></button>)}</div>}</>}
   {couponMessage&&<p className="payment-coupon-error" role="alert">{couponMessage}</p>}
  </section>
  <section className="payment-tax-summary" aria-live="polite"><div><span>Subtotal</span><strong>{ready&&quote?money(quote.subtotal):"..."}</strong></div>{ready&&quote&&(quote.discountAmount??0)>0&&<div className="payment-discount"><span>Coupon discount</span><strong>-{money(quote.discountAmount!)}</strong></div>}<div><span>Tax{ready&&quote?.taxRate!==undefined?' ('+quote.taxRate+'%)':''}</span><strong>{ready&&quote?money(quote.taxAmount):"..."}</strong></div><button type="button" disabled={busy} onClick={refreshQuote}><RefreshCw size={14}/>Refresh totals</button></section><label><span>{method==="CASH"?"Cash received":"Payment amount"}</span><input type="number" min={quote?.dueAmount??0} step="0.01" value={method==="CASH"&&amount===0&&quote?.prefillDue===false?"":amount} placeholder={quote?.prefillDue===false?"Enter amount received":undefined} onChange={event=>setAmount(Number(event.target.value)||0)} required disabled={!ready||busy} readOnly={method!=="CASH"}/></label>{method==="CASH"&&<div className="cash-change"><span>Change</span><strong>{money(change)}</strong></div>}{method!=="CASH"&&<label><span>Reference (optional)</span><input name="reference" maxLength={100} placeholder="Transaction/reference number"/></label>}<label><span>Payment notes (optional)</span><textarea name="notes" maxLength={300} placeholder="Optional payment note"/></label>{error&&<p className="payment-error" role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button disabled={busy||!ready}>{pending?"Receiving...":completeDelivery?"Receive & deliver":"Receive payment"}</button></footer></form></dialog></>;
}
