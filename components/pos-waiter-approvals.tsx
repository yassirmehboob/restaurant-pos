"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, ChefHat, RefreshCw, UtensilsCrossed, X } from "lucide-react";
import { confirmWaiterRequest } from "@/app/(dashboard)/orders/actions";
import { printPlacedOrder } from "@/lib/printers";
import { formatTime } from "@/lib/dates";
import "./pos-waiter-approvals.css";

type Request = { id: string; revision: number; waiterName: string; tableName: string; createdAt: string; lines: { name: string; quantity: number; note: string }[]; summary: { subtotal: number; taxAmount: number; grandTotal: number } };
type Queue = { currency: string; requests: Request[] };

export function PosWaiterApprovals() {
  const [data, setData] = useState<Queue>({ currency: "PKR", requests: [] });
  const [reviewed, setReviewed] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const fetching = useRef(false);
  const blocked = useRef(false);
  const latest = useRef(data);
  const generation = useRef(0);

  const show = useCallback((queue: Queue) => {
    setReviewed(queue.requests[0] ?? null);
    setNotice("");
    setOpen(true);
  }, []);

  const refresh = useCallback(async () => {
    if (fetching.current || !active.current) return;
    fetching.current = true;
    const started = generation.current;
    try {
      const response = await fetch("/api/pos/waiter-requests", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) active.current = false;
        throw new Error(response.status === 401 ? "Session expired. Sign in again." : "Cannot refresh waiter orders. Please retry.");
      }
      const next: Queue = await response.json();
      if (!active.current || started !== generation.current) return;
      latest.current = next;
      setData(next);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cannot refresh waiter orders."); }
    finally { fetching.current = false; }
  }, []);

  useEffect(() => {
    active.current = true;
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(update, 5000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => { active.current = false; clearInterval(interval); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [refresh]);

  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);

  function close() {
    if (blocked.current) return;
    dialog.current?.close();
    setOpen(false);
  }

  async function approve() {
    if (!reviewed || blocked.current) return;
    blocked.current = true;
    setBusy(true);
    setNotice("");
    try {
      const result = await confirmWaiterRequest(reviewed.id, reviewed.revision);
      if (!result.ok) { setNotice(result.message); await refresh(); return; }
      generation.current++;
      const failures = await printPlacedOrder(result);
      setNotice(`${reviewed.tableName}: order approved and sent to the kitchen.${failures.map(failure => ` ${failure.title}: ${failure.text}`).join("")}`);
      const remaining = latest.current.requests.filter(request => request.id !== reviewed.id);
      latest.current = { ...latest.current, requests: remaining };
      setData(latest.current);
      setReviewed(remaining[0] ?? null);
      await refresh();
    } catch { setNotice("Could not confirm approval. Refresh and review the order before trying again."); }
    finally { blocked.current = false; setBusy(false); }
  }

  const current = data.requests.find(request => request.id === reviewed?.id);
  const changed = !!reviewed && (!current || current.revision !== reviewed.revision);
  const money = (value: number) => `${data.currency} ${value.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

  return <>
    <button className={`pos-waiter-trigger${data.requests.length ? " has-pending" : ""}`} type="button" aria-haspopup="dialog" onClick={() => show(latest.current)} title={error || "Review waiter orders"}><Bell size={18} /><span>Waiter orders</span><b aria-label={`${data.requests.length} pending orders`}>{data.requests.length}</b>{error && <i aria-label="Connection issue">!</i>}</button>
    {open && <dialog ref={dialog} className="pos-waiter-dialog" aria-labelledby="pos-waiter-title" onCancel={event => { event.preventDefault(); close(); }}>
      <header><div><span>CASHIER APPROVAL</span><h2 id="pos-waiter-title">Waiter orders <b>{data.requests.length}</b></h2><p>Review and send to the kitchen. Your POS cart stays as it is.</p></div><button type="button" aria-label="Close waiter orders" disabled={busy} onClick={close}><X size={21} /></button></header>
      {error && <p className="pos-waiter-alert" role="alert">{error}</p>}
      <div className="pos-waiter-notice" role="status" aria-live="polite">{notice}</div>
      <div className="pos-waiter-body"><nav aria-label="Pending waiter orders">{data.requests.map(request => <button type="button" key={request.id} disabled={busy} aria-pressed={reviewed?.id === request.id} onClick={() => { setReviewed(request); setNotice(""); }}><UtensilsCrossed size={19} /><span><strong>{request.tableName || "Dine-in"}</strong><small>{request.waiterName} / {formatTime(request.createdAt)}</small></span><b>{request.lines.reduce((sum, line) => sum + line.quantity, 0)}</b></button>)}{!data.requests.length && <p>No orders waiting.</p>}</nav>
        <section aria-label="Order review">{reviewed ? <>
          <div className="pos-waiter-summary-heading"><div><span>TABLE SERVICE</span><h3>{reviewed.tableName || "Dine-in order"}</h3><p>{reviewed.waiterName} / Submitted {formatTime(reviewed.createdAt)}</p></div><span>Awaiting approval</span></div>
          {changed && <div className="pos-waiter-alert" role="alert">{current ? "The waiter updated this order. Review the latest version before approval." : "This request is no longer pending. It may have been approved by another cashier."}{current && <button type="button" disabled={busy} onClick={() => { setReviewed(current); setNotice(""); }}>Review updated order</button>}</div>}
          <ul className="pos-waiter-lines">{reviewed.lines.map((line, index) => <li key={index}><b>{line.quantity}×</b><div><strong>{line.name}</strong>{line.note && <p>{line.note}</p>}</div></li>)}</ul>
          <dl><div><dt>Subtotal</dt><dd>{money(reviewed.summary.subtotal)}</dd></div><div><dt>Tax</dt><dd>{money(reviewed.summary.taxAmount)}</dd></div><div><dt>Total</dt><dd>{money(reviewed.summary.grandTotal)}</dd></div></dl>
        </> : <div className="pos-waiter-empty"><Check size={35} /><h3>You are all caught up</h3><p>New waiter orders will appear here automatically.</p></div>}</section>
      </div>
      <footer><button type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={16} />Refresh</button><div><button type="button" disabled={busy} onClick={close}>Back to POS</button>{reviewed && <button className="pos-waiter-approve" type="button" disabled={busy || changed || !!error} onClick={() => void approve()}><ChefHat size={18} />{busy ? "Approving..." : "Approve & send to kitchen"}</button>}</div></footer>
    </dialog>}
  </>;
}
