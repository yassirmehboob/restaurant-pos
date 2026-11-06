"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import Swal from "sweetalert2";
import { CashAmountInput } from "@/components/cash-amount-input";
import { DatePicker } from "@/components/date-picker";
import { amountInWords, groupAmount } from "@/lib/amount-format";
import { formatDate } from "@/lib/dates";
import { ArrowRight, LockKeyhole, Play } from "lucide-react";
import { startSale, closeSale } from "@/app/(dashboard)/sale-sessions/actions";

export function StartSaleForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(startSale, undefined);
  const [confirming, setConfirming] = useState(false), [, startTransition] = useTransition(), submitting = useRef(false);
  return <form className="session-form" onSubmit={async event => {
    event.preventDefault(); if (submitting.current || pending) return;
    const data = new FormData(event.currentTarget); submitting.current = true; setConfirming(true);
    try {
      const result = await Swal.fire({ title: "Start this sale?", text: `${String(data.get("counterName"))} / ${formatDate(String(data.get("saleDate")))} / Opening cash Rs ${groupAmount(String(data.get("openingBalance")))} (${amountInWords(String(data.get("openingBalance")))})`, icon: "question", showCancelButton: true, confirmButtonText: "Start Sale", cancelButtonText: "Review details", confirmButtonColor: "#2563eb", reverseButtons: true, focusCancel: true });
      if (result.isConfirmed) startTransition(() => action(data));
    } finally { submitting.current = false; setConfirming(false); }
  }}>
    <div className="session-form-heading"><span><Play size={20}/></span><div><h2>Open your counter</h2><p>A fresh shift, with everything in balance.</p></div></div>
    <div className="session-form-fields">
    <label>Counter name<input name="counterName" placeholder="Counter 1" maxLength={60} required /></label>
    <div className="session-date-field"><label htmlFor="sale-date">Sale date</label><DatePicker id="sale-date" name="saleDate" label="Sale date" defaultValue={today} required /></div>
    <CashAmountInput id="opening-cash" name="openingBalance" label="Opening cash" max={999999999} required />
    </div>
    {state?.message && <p role="status" className={state.ok ? "success-message" : "form-alert"}>{state.message}</p>}
    {state?.errors && <p role="alert" className="form-alert">{Object.values(state.errors).flat().join(" ")}</p>}
    <div className="session-form-footer"><p>Your sale date stays fixed after midnight. Shared logins share this shift.</p><button disabled={pending || confirming}>{pending ? "Starting…" : "Start Sale"}<ArrowRight size={18}/></button></div>
  </form>;
}

export function CloseSaleForm({ id, unpaidCount }: { id: string; unpaidCount: number }) {
  const [state, action, pending] = useActionState(closeSale.bind(null, id), undefined);
  const [confirming, setConfirming] = useState(false), [, startTransition] = useTransition(), submitting = useRef(false);
  return <form className="session-close" onSubmit={async event => {
    event.preventDefault(); if (submitting.current || pending) return;
    submitting.current = true; setConfirming(true);
    try {
      const result = await Swal.fire({ title: "Close this sale?", text: "The final payment and expense totals will be saved. This shift cannot be edited afterward.", icon: "warning", showCancelButton: true, confirmButtonText: "Close Sale", cancelButtonText: "Keep sale open", confirmButtonColor: "#be123c", reverseButtons: true, focusCancel: true });
      if (result.isConfirmed) { const data = new FormData(); data.set("confirm", "yes"); startTransition(() => action(data)); }
    } finally { submitting.current = false; setConfirming(false); }
  }}>
    {unpaidCount > 0
      ? <div><strong>This sale cannot close yet</strong><p>Collect or cancel {unpaidCount === 1 ? "the unpaid invoice" : `the ${unpaidCount} unpaid invoices`} above first.</p></div>
      : <div><strong>Ready to close your shift?</strong><p>Review the totals above. You can start another shift on the same date.</p></div>}
    {state?.message && <p role="status" className={state.ok ? "success-message" : "form-alert"}>{state.message}</p>}
    <button disabled={pending || confirming || unpaidCount > 0}><LockKeyhole size={17}/>{pending ? "Closing…" : "Close Sale"}</button>
  </form>;
}
