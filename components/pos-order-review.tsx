"use client";

import { PAYMENT_METHODS,type PaymentMethod } from "@/lib/tax";
import { useEffect, useId, useRef, useState } from "react";
import { ClipboardCheck, X } from "lucide-react";
import Swal from "sweetalert2";
import { PosCustomerPicker, type PosCustomer } from "@/components/pos-customer-picker";

export type ReviewDetails = { tableId: string; waiterId: string; deliveryAddress: string; deliveryArea: string; deliveryNotes: string; deliveryCharge: number };
type Option = { id: string; name: string; detail?: string };
const money = (amount: number) => `Rs ${amount.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

export function PosOrderReview({ paymentMethod,onPaymentMethodChange,orderType, customers, customerId, tables, waiters, details, totals, ready, saving, error, onDetailsChange, onCustomerChange, onAddCustomer, onEditCustomer, onClose, onConfirm }: {
  paymentMethod:PaymentMethod;onPaymentMethodChange:(method:PaymentMethod)=>void;
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY"; customers: PosCustomer[]; customerId: string; tables: Option[]; waiters: Option[];
  details: ReviewDetails; totals: { taxRate?:number;subtotal: number; taxAmount: number; deliveryCharge: number; grandTotal: number };
  ready: boolean; saving: boolean; error: string;
  onDetailsChange: (patch: Partial<ReviewDetails>) => void; onCustomerChange: (id: string) => void; onAddCustomer: () => void; onEditCustomer: () => void;
  onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId(), [confirming, setConfirming] = useState(false);
  const delivery = orderType === "DELIVERY", dineIn = orderType === "DINE_IN", label = dineIn ? "Dine-in" : delivery ? "Delivery" : "Takeaway";
  useEffect(() => { dialog.current?.showModal(); }, []);
  const valid = ready && (!delivery || Boolean(customerId && details.deliveryAddress.trim() && details.deliveryArea.trim()));
  return <dialog ref={dialog} className="pos-order-review" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!saving && !confirming) onClose(); }}>
    <header><div><span>{label} order</span><h2 id={titleId}>Review &amp; send</h2><p>Choose the customer and confirm your invoice.</p></div><button type="button" aria-label="Close order review" disabled={saving || confirming} onClick={onClose}><X size={22}/></button></header>
    <div className="order-review-content"><section className="order-review-fields">
      <PosCustomerPicker customers={customers} value={customerId} delivery={delivery} onChange={onCustomerChange} onAdd={onAddCustomer} onEdit={onEditCustomer}/>
      {dineIn && <label><span>Table <small>Optional</small></span><select value={details.tableId} onChange={event => onDetailsChange({ tableId: event.target.value })}><option value="">No table selected</option>{tables.map(table => <option key={table.id} value={table.id}>{table.name}{table.detail ? ` / ${table.detail}` : ""}</option>)}</select></label>}
      {(dineIn || delivery) && <label><span>{delivery ? "Rider" : "Waiter"} <small>Optional</small></span><select value={details.waiterId} onChange={event => onDetailsChange({ waiterId: event.target.value })}><option value="">{delivery ? "No rider selected" : "No waiter selected"}</option>{waiters.map(waiter => <option key={waiter.id} value={waiter.id}>{waiter.name}</option>)}</select></label>}
      {delivery && <><label><span>Delivery area <small>Required</small></span><input value={details.deliveryArea} maxLength={100} onChange={event => onDetailsChange({ deliveryArea: event.target.value })} placeholder="Area"/></label><label className="wide"><span>Delivery address <small>Required</small></span><textarea value={details.deliveryAddress} maxLength={500} onChange={event => onDetailsChange({ deliveryAddress: event.target.value })} placeholder="House, street, landmark"/></label><label className="wide"><span>Delivery notes <small>Optional</small></span><input value={details.deliveryNotes} maxLength={500} onChange={event => onDetailsChange({ deliveryNotes: event.target.value })} placeholder="Instructions for the rider"/></label>{!customerId && <p className="order-review-hint">Select or add a customer with delivery details before sending.</p>}</>}
    </section><section className="order-review-amount"><h3><ClipboardCheck size={19}/>Invoice summary</h3><label><span>Payment method</span><select aria-label="Invoice payment method" value={paymentMethod} disabled={saving||confirming} onChange={event=>onPaymentMethodChange(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(method=><option key={method} value={method}>{method.charAt(0)+method.slice(1).toLowerCase()}</option>)}</select></label>{delivery && <label><span>Delivery charge (Rs)</span><input type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={details.deliveryCharge || ""} onChange={event => onDetailsChange({ deliveryCharge: Math.max(0, Number(event.target.value) || 0) })} placeholder="0.00"/></label>}<div><span>Items subtotal</span><strong>{money(totals.subtotal)}</strong></div><div><span>Tax{totals.taxRate!==undefined?` (${totals.taxRate}%)`:""}</span><strong>{money(totals.taxAmount)}</strong></div>{delivery && <div><span>Delivery charge</span><strong>{money(totals.deliveryCharge)}</strong></div>}<div className="order-review-total"><span>Total invoice</span><strong>{ready ? money(totals.grandTotal) : "Updating..."}</strong></div><p>{dineIn ? "Send to kitchen now. Collect payment when your guest is ready." : delivery ? "Send to kitchen as Cash on Delivery." : "Continue to payment after confirming this order."}</p></section></div>
    {error && <p className="pos-preview-error" role="alert">{error}</p>}
    <footer><button type="button" disabled={saving || confirming} onClick={onClose}>Back to items</button><button type="button" disabled={!valid || saving || confirming} onClick={async () => {
      setConfirming(true);
      try {
        const result = await Swal.fire({ target: dialog.current!, title: "Save and send this order?", text: `${label} / ${customers.find(customer => customer.id === customerId)?.name || "Walk-in customer"} / ${money(totals.grandTotal)}`, icon: "question", showCancelButton: true, confirmButtonText: orderType === "TAKEAWAY" ? "Continue to payment" : "Send to kitchen", cancelButtonText: "Review order", confirmButtonColor: "#2563eb", reverseButtons: true, focusCancel: true });
        if (result.isConfirmed) onConfirm();
      } finally { setConfirming(false); }
    }}>{saving ? "Saving..." : orderType === "TAKEAWAY" ? "Continue to payment" : "Confirm & send"}</button></footer>
  </dialog>;
}
