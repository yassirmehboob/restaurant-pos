"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Download, Gift, PauseCircle, PlayCircle, Plus, Search, TicketPercent, Undo2, X } from "lucide-react";
import Swal from "sweetalert2";
import { MasterHeader } from "@/components/master-shell";
import { DatePicker } from "@/components/date-picker";
import { couponDescription, MAX_COUPONS_PER_BATCH } from "@/lib/coupons";
import { formatDate, formatDateTime } from "@/lib/dates";
import { createCouponBatch, giveCouponToCustomer, listBatchCoupons, searchCouponCustomers, setCouponBatchActive, takeBackCoupon, voidCoupon, type CouponBatchView } from "@/app/(dashboard)/coupons/actions";
import "./coupon-manager.css";

type CouponRow = Awaited<ReturnType<typeof listBatchCoupons>>["coupons"][number];
type Form = { name: string; discountType: "PERCENT" | "FIXED"; discountValue: string; maxDiscount: string; minOrderAmount: string; usage: "INSTANT" | "NEXT_VISIT"; autoIssueEnabled: boolean; autoIssueMinSpend: string; quantity: string };
const EMPTY: Form = { name: "", discountType: "PERCENT", discountValue: "", maxDiscount: "", minOrderAmount: "", usage: "INSTANT", autoIssueEnabled: false, autoIssueMinSpend: "", quantity: "1" };
const STATUS: Record<string, string> = { ACTIVE: "Unused", APPLIED: "On unpaid order", REDEEMED: "Used", VOID: "Cancelled" };
const rs = (value: number) => `Rs ${value.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const number = (value: string) => value.trim() === "" ? 0 : Number(value);

export function CouponManager({ batches }: { batches: CouponBatchView[] }) {
  const router = useRouter(), [pending, start] = useTransition();
  const [creating, setCreating] = useState(false), [form, setForm] = useState<Form>(EMPTY), [formError, setFormError] = useState("");
  const [openBatch, setOpenBatch] = useState<string | null>(null), [giving, setGiving] = useState<CouponBatchView | null>(null), [notice, setNotice] = useState("");
  const createDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (creating) createDialog.current?.showModal(); }, [creating]);
  const update = (patch: Partial<Form>) => { setForm(current => ({ ...current, ...patch })); setFormError(""); };
  const values = { ...form, name: form.name.trim(), discountValue: number(form.discountValue), maxDiscount: form.discountType === "PERCENT" && form.maxDiscount.trim() ? number(form.maxDiscount) : null, minOrderAmount: number(form.minOrderAmount), autoIssueMinSpend: number(form.autoIssueMinSpend), quantity: Math.trunc(number(form.quantity)) };
  const preview = values.discountValue > 0 ? couponDescription(values) : "Enter the discount to see the offer.";

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The date pickers submit DD/MM/YYYY entries as YYYY-MM-DD through hidden fields.
    const data = new FormData(event.currentTarget), dates = { validFrom: String(data.get("validFrom") ?? ""), expiresOn: String(data.get("expiresOn") ?? "") };
    start(async () => {
      const result = await createCouponBatch({ ...values, ...dates });
      if (!result.ok) { setFormError(result.message); return; }
      setCreating(false); setForm(EMPTY); setOpenBatch(result.batchId);
      setNotice(`${values.quantity.toLocaleString()} coupon${values.quantity === 1 ? "" : "s"} created for ${values.name}.`);
      router.refresh();
    });
  };
  const toggle = (batch: CouponBatchView) => start(async () => {
    if (batch.isActive) {
      const confirm = await Swal.fire({ icon: "warning", titleText: `Stop ${batch.name}?`, text: "Its coupons cannot be used or given out until you resume the offer. Coupons already on unpaid orders must be removed before payment.", showCancelButton: true, confirmButtonText: "Stop offer", confirmButtonColor: "#b42318", reverseButtons: true });
      if (!confirm.isConfirmed) return;
    }
    const result = await setCouponBatchActive(batch.id, !batch.isActive);
    setNotice(result.ok ? `${batch.name} ${batch.isActive ? "stopped" : "resumed"}.` : result.message);
    router.refresh();
  });

  return <main className="master-page coupon-page">
    <MasterHeader eyebrow="Marketing" title="Coupons" description="Create one-time 10-digit coupons for an offer, give them to customers, and track every use." actions={<button type="button" className="coupon-primary" onClick={() => { setForm(EMPTY); setFormError(""); setCreating(true); }}><Plus size={17} />Create coupons</button>} />
    {notice && <p className="coupon-notice" role="status">{notice}</p>}
    {batches.length ? <section className="coupon-batches">{batches.map(batch => <article key={batch.id} className={`coupon-batch${batch.isActive ? "" : " is-stopped"}`}>
      <header>
        <span className="coupon-icon"><TicketPercent size={20} /></span>
        <div><h2>{batch.name}</h2><p>{batch.description}</p></div>
        <span className={`coupon-badge ${batch.usage === "NEXT_VISIT" ? "next" : "now"}`}>{batch.usage === "NEXT_VISIT" ? "Next visit" : "Use now"}</span>
        {!batch.isActive && <span className="coupon-badge stopped">Stopped</span>}
      </header>
      <ul className="coupon-rules">
        <li>{batch.validFrom || batch.expiresOn ? `Valid ${batch.validFrom ? `from ${formatDate(batch.validFrom)} ` : ""}${batch.expiresOn ? `until ${formatDate(batch.expiresOn)}` : "with no expiry"}` : "No expiry"}</li>
        <li>{batch.autoIssueEnabled ? `Given automatically when a customer pays ${rs(batch.autoIssueMinSpend)} or more` : "Given by you"}</li>
        <li>Created {formatDateTime(batch.createdAt)}{batch.createdByName ? ` by ${batch.createdByName}` : ""}</li>
      </ul>
      <dl className="coupon-stats">
        <div><dt>Total</dt><dd>{batch.quantity.toLocaleString()}</dd></div>
        <div><dt>Not given</dt><dd>{batch.stats.available.toLocaleString()}</dd></div>
        <div><dt>Given</dt><dd>{batch.stats.given.toLocaleString()}</dd></div>
        <div><dt>On orders</dt><dd>{batch.stats.applied.toLocaleString()}</dd></div>
        <div><dt>Used</dt><dd>{batch.stats.redeemed.toLocaleString()}</dd></div>
        <div><dt>Cancelled</dt><dd>{batch.stats.void.toLocaleString()}</dd></div>
      </dl>
      <footer>
        <button type="button" onClick={() => setOpenBatch(openBatch === batch.id ? null : batch.id)}>{openBatch === batch.id ? "Hide codes" : "View codes"}</button>
        <button type="button" disabled={pending || !batch.isActive || batch.stats.available === 0} onClick={() => setGiving(batch)}><Gift size={15} />Give to customer</button>
        <a href={`/api/coupons/${batch.id}`}><Download size={15} />Download codes</a>
        <button type="button" disabled={pending} onClick={() => toggle(batch)}>{batch.isActive ? <><PauseCircle size={15} />Stop offer</> : <><PlayCircle size={15} />Resume offer</>}</button>
      </footer>
      {openBatch === batch.id && <CouponList batchId={batch.id} version={JSON.stringify(batch.stats)} onChanged={() => router.refresh()} />}
    </article>)}</section>
      : <section className="coupon-empty"><TicketPercent size={36} /><h2>No coupons yet</h2><p>Create an offer such as &ldquo;Azadi Offer&rdquo; with 30% off on orders of Rs 12,000 or more.</p></section>}

    {creating && <dialog ref={createDialog} className="coupon-dialog" aria-labelledby="coupon-create-title" onCancel={event => { event.preventDefault(); if (!pending) setCreating(false); }}>
      <form onSubmit={submit}>
        <header><div><span>New offer</span><h2 id="coupon-create-title">Create coupons</h2></div><button type="button" aria-label="Close" disabled={pending} onClick={() => setCreating(false)}><X size={20} /></button></header>
        <fieldset disabled={pending}>
          <label className="wide"><span>Offer name</span><input required maxLength={80} value={form.name} placeholder="e.g. Azadi Offer, Valentine's Day Offer" onChange={event => update({ name: event.target.value })} /></label>
          <label><span>Discount type</span><select value={form.discountType} onChange={event => update({ discountType: event.target.value as Form["discountType"], maxDiscount: "" })}><option value="PERCENT">Percentage (%)</option><option value="FIXED">Fixed amount (Rs)</option></select></label>
          <label><span>{form.discountType === "PERCENT" ? "Discount (%)" : "Discount (Rs)"}</span><input required type="number" inputMode="decimal" min="0.01" max={form.discountType === "PERCENT" ? 100 : undefined} step="0.01" value={form.discountValue} onChange={event => update({ discountValue: event.target.value })} /></label>
          {form.discountType === "PERCENT" && <label><span>Maximum discount (Rs) <small>Optional cap</small></span><input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.maxDiscount} placeholder="No cap" onChange={event => update({ maxDiscount: event.target.value })} /></label>}
          <label><span>Minimum order (Rs) <small>Before tax</small></span><input type="number" inputMode="decimal" min="0" step="0.01" value={form.minOrderAmount} placeholder="No minimum" onChange={event => update({ minOrderAmount: event.target.value })} /></label>
          <label className="wide"><span>When can it be used?</span><select value={form.usage} onChange={event => update({ usage: event.target.value as Form["usage"] })}><option value="INSTANT">Use now: on any bill, including the one where it is given</option><option value="NEXT_VISIT">Next visit: given to a customer, usable from their next day of visit</option></select></label>
          <div className="coupon-date"><span>Valid from <small>Optional</small></span><DatePicker name="validFrom" label="Valid from" /></div>
          <div className="coupon-date"><span>Expires on <small>Optional, last valid day</small></span><DatePicker name="expiresOn" label="Expires on" /></div>
          <label className="coupon-switch wide"><input type="checkbox" checked={form.autoIssueEnabled} onChange={event => update({ autoIssueEnabled: event.target.checked })} /><span><strong>Give automatically after payment</strong><small>When a selected customer pays this much or more, the system gives them one coupon from this offer and prints it on the receipt.</small></span></label>
          {form.autoIssueEnabled && <label><span>Customer must spend (Rs)</span><input required type="number" inputMode="decimal" min="0.01" step="0.01" value={form.autoIssueMinSpend} onChange={event => update({ autoIssueMinSpend: event.target.value })} /></label>}
          <label><span>How many coupons?</span><input required type="number" inputMode="numeric" min="1" max={MAX_COUPONS_PER_BATCH} step="1" value={form.quantity} onChange={event => update({ quantity: event.target.value })} /></label>
        </fieldset>
        <p className="coupon-preview"><TicketPercent size={16} /><span><b>{form.name.trim() || "Your offer"}:</b> {preview}</span></p>
        <p className="coupon-help">Each coupon gets its own 10-digit code. Codes never repeat and each one works only once. Tax is calculated after the discount; delivery charges are not discounted.</p>
        {formError && <p className="coupon-error" role="alert">{formError}</p>}
        <footer><button type="button" disabled={pending} onClick={() => setCreating(false)}>Cancel</button><button type="submit" className="coupon-primary" disabled={pending}>{pending ? "Creating..." : `Create ${Math.max(0, values.quantity).toLocaleString()} coupon${values.quantity === 1 ? "" : "s"}`}</button></footer>
      </form>
    </dialog>}
    {giving && <GiveDialog batch={giving} onClose={() => setGiving(null)} onGiven={() => router.refresh()} />}
  </main>;
}

// version changes whenever the offer counts change (e.g. a coupon was given), so the list reloads.
function CouponList({ batchId, version, onChanged }: { batchId: string; version: string; onChanged: () => void }) {
  const [search, setSearch] = useState(""), [status, setStatus] = useState(""), [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const [data, setData] = useState<{ coupons: CouponRow[]; pages: number; total: number; message?: string } | null>(null), [pending, start] = useTransition();
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { void listBatchCoupons(batchId, { search, status, page }).then(result => { if (active) setData({ coupons: result.coupons, pages: result.pages, total: result.total, message: result.ok ? undefined : result.message }); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [batchId, search, status, page, reload, version]);
  const act = (work: () => Promise<{ ok: boolean; message?: string }>) => start(async () => { const result = await work(); if (!result.ok) await Swal.fire({ icon: "error", titleText: result.message ?? "Please try again." }); setReload(value => value + 1); onChanged(); });
  const cancel = (row: CouponRow) => start(async () => {
    const answer = await Swal.fire({ icon: "warning", titleText: `Cancel coupon ${row.code}?`, text: "A cancelled code can never be used or given again.", input: "text", inputPlaceholder: "Reason", inputValidator: value => value.trim().length < 3 ? "Enter a reason of at least 3 characters." : undefined, showCancelButton: true, confirmButtonText: "Cancel coupon", cancelButtonText: "Keep", confirmButtonColor: "#b42318", reverseButtons: true });
    if (answer.isConfirmed) act(() => voidCoupon(row.id, String(answer.value)));
  });
  return <section className="coupon-codes">
    <div className="coupon-filters"><label><Search size={15} /><input value={search} placeholder="Search code, customer, phone or order" onChange={event => { setSearch(event.target.value); setPage(1); }} /></label><select value={status} aria-label="Filter by status" onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    {data?.message && <p className="coupon-error" role="alert">{data.message}</p>}
    {!data ? <p className="coupon-muted">Loading codes...</p> : data.coupons.length ? <div className="coupon-table-scroll"><table>
      <thead><tr><th>Code</th><th>Status</th><th>Customer</th><th>Order</th><th aria-label="Actions" /></tr></thead>
      <tbody>{data.coupons.map(row => <tr key={row.id}>
        <td><strong className="coupon-code">{row.code}</strong></td>
        <td><span className={`coupon-status ${row.status.toLowerCase()}`}>{STATUS[row.status] ?? row.status}</span>{row.voidReason && <small>{row.voidReason}</small>}</td>
        <td>{row.customerName ? <><b>{row.customerName}</b><small>{[row.customerPhone, row.source === "AUTO" ? `auto after ${row.issuedOrderNumber || "payment"}` : "given by owner", row.assignedAt ? formatDateTime(row.assignedAt) : ""].filter(Boolean).join(" · ")}</small></> : <span className="coupon-muted">Not given</span>}</td>
        <td>{row.orderNumber ? <><b>{row.orderNumber}</b><small>{row.redeemedAt ? `${formatDateTime(row.redeemedAt)}${row.discountAmount ? ` · -${rs(row.discountAmount)}` : ""}` : "awaiting payment"}</small></> : <span className="coupon-muted">-</span>}</td>
        <td className="coupon-row-actions">{row.status === "ACTIVE" && row.customerName && <button type="button" disabled={pending} onClick={() => act(() => takeBackCoupon(row.id))} title="Take back from customer"><Undo2 size={14} />Take back</button>}{row.status === "ACTIVE" && <button type="button" className="danger" disabled={pending} onClick={() => cancel(row)}><Ban size={14} />Cancel</button>}</td>
      </tr>)}</tbody>
    </table></div> : <p className="coupon-muted">No coupons match.</p>}
    {data && data.pages > 1 && <nav className="coupon-pager" aria-label="Coupon pages"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {data.pages} · {data.total.toLocaleString()} codes</span><button type="button" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button></nav>}
  </section>;
}

function GiveDialog({ batch, onClose, onGiven }: { batch: CouponBatchView; onClose: () => void; onGiven: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [query, setQuery] = useState(""), [results, setResults] = useState<{ id: string; name: string; phone: string }[]>([]), [pending, start] = useTransition(), [error, setError] = useState("");
  const [given, setGiven] = useState<{ code: string; customerName: string; description: string; usage: string; expiresOn: string | null } | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { let active = true; const timer = setTimeout(() => { void searchCouponCustomers(query).then(rows => { if (active) setResults(rows); }); }, 250); return () => { active = false; clearTimeout(timer); }; }, [query]);
  const give = (customerId: string) => start(async () => { setError(""); const result = await giveCouponToCustomer(batch.id, customerId); if (!result.ok) { setError(result.message); return; } setGiven(result); onGiven(); });
  return <dialog ref={dialog} className="coupon-dialog coupon-give" aria-labelledby="coupon-give-title" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <header><div><span>{batch.name}</span><h2 id="coupon-give-title">Give a coupon</h2></div><button type="button" aria-label="Close" disabled={pending} onClick={onClose}><X size={20} /></button></header>
    {given ? <div className="coupon-given"><p>Coupon for <b>{given.customerName}</b></p><strong className="coupon-code big">{given.code}</strong><p>{given.description}{given.usage === "NEXT_VISIT" ? " · usable from their next visit" : ""}{given.expiresOn ? ` · valid until ${formatDate(given.expiresOn)}` : ""}</p><footer><button type="button" onClick={() => { setGiven(null); setQuery(""); }}>Give another</button><button type="button" className="coupon-primary" onClick={onClose}>Done</button></footer></div>
      : <><p className="coupon-muted">{batch.description}. {batch.stats.available.toLocaleString()} not given yet. The coupon will only work for the customer you choose.</p>
        <label className="coupon-search"><Search size={15} /><input autoFocus value={query} placeholder="Search customer by name or phone" onChange={event => setQuery(event.target.value)} /></label>
        <ul className="coupon-customers">{results.map(customer => <li key={customer.id}><button type="button" disabled={pending} onClick={() => give(customer.id)}><b>{customer.name}</b><small>{customer.phone || "No phone"}</small><span><Gift size={14} />Give</span></button></li>)}{query.trim().length >= 2 && !results.length && <li className="coupon-muted">No matching customers. Add the customer first.</li>}</ul>
        {error && <p className="coupon-error" role="alert">{error}</p>}</>}
  </dialog>;
}
