"use client";
import { useCan } from "@/components/permission-provider";

import { useId, useRef, useState } from "react";
import { Check, ChevronDown, MapPin, Pencil, Search, UserPlus, UserRound, X } from "lucide-react";

export type PosCustomer = { id: string; name: string; phone?: string; address?: string; area?: string };

export function PosCustomerPicker({ customers, value, delivery, onChange, onAdd, onEdit }: {
  customers: PosCustomer[]; value: string; delivery: boolean;
  onChange: (id: string) => void; onAdd: () => void; onEdit: () => void;
}) {
  const can=useCan();
  const dialog = useRef<HTMLDialogElement>(null), search = useRef<HTMLInputElement>(null), titleId = useId();
  const [query, setQuery] = useState("");
  const selected = customers.find(customer => customer.id === value);
  const normalized = query.trim().toLowerCase(), digits = normalized.replace(/\D/g, "");
  const matches = customers.filter(customer => customer.name.trim().toLowerCase() !== "counter" && (!normalized || [customer.name, customer.phone, customer.address, customer.area].some(field => field?.toLowerCase().includes(normalized)) || (digits.length > 0 && /^[\d\s()+-]+$/.test(normalized) && customer.phone?.replace(/\D/g, "").includes(digits))));
  const choose = (id: string) => { onChange(id); dialog.current?.close(); };
  return <div className="pos-customer-picker">
    <div className="customer-picker-label"><span>Customer</span><small>{delivery ? "Required for delivery" : "Optional"}</small></div>
    <div className="customer-picker-controls">
      <button className="customer-picker-trigger" type="button" aria-haspopup="dialog" onClick={() => { setQuery(""); dialog.current?.showModal(); search.current?.focus(); }}>
        <UserRound size={18}/><span><strong>{selected?.name || "Walk-in customer"}</strong><small>{selected ? selected.phone || "No mobile number" : delivery ? "Choose a customer for delivery" : "No customer assigned"}</small></span><ChevronDown size={16}/>
      </button>
      {can("customers")&&<button className="customer-picker-action" type="button" onClick={onAdd} aria-label="Add customer" title="Add customer"><UserPlus size={18}/></button>}
      {can("customers")&&<button className="customer-picker-action" type="button" onClick={onEdit} disabled={!selected} aria-label="Edit selected customer" title="Edit customer and address"><Pencil size={17}/></button>}
    </div>
    {delivery && selected && <p className="customer-picker-address"><MapPin size={14}/><span>{[selected.address, selected.area].filter(Boolean).join(", ") || "Add a delivery address using Edit"}</span></p>}
    <dialog ref={dialog} className="customer-search-dialog" aria-labelledby={titleId}>
      <header><div><span>Customer directory</span><h2 id={titleId}>Find a customer</h2></div><button type="button" onClick={() => dialog.current?.close()} aria-label="Close customer search"><X size={21}/></button></header>
      <label className="customer-search-input"><Search size={20}/><input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, mobile, address or area" aria-label="Search customers" autoComplete="off" onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>(".customer-search-results button")?.focus(); } }}/>{query && <button type="button" aria-label="Clear customer search" onClick={() => { setQuery(""); search.current?.focus(); }}><X size={17}/></button>}</label>
      <p className="customer-search-count" role="status">{matches.length} customer{matches.length === 1 ? "" : "s"}{matches.length > 50 ? " · Showing first 50; type to narrow results" : ""}</p>
      <div className="customer-search-results">
        {(!normalized || "walk-in customer".includes(normalized)) && <button type="button" aria-pressed={!value} onClick={() => choose("")}><span className="customer-result-avatar"><UserRound size={19}/></span><span><strong>Walk-in customer</strong><small>{delivery ? "Choose a recipient before sending delivery" : "No customer assigned"}</small></span>{!value && <Check size={19}/>}</button>}
        {matches.slice(0, 50).map(customer => <button type="button" aria-pressed={value === customer.id} key={customer.id} onClick={() => choose(customer.id)}><span className="customer-result-avatar">{customer.name.charAt(0).toUpperCase()}</span><span><strong>{customer.name}</strong><small>{customer.phone || "No mobile number"}</small>{(customer.address || customer.area) && <small>{[customer.address, customer.area].filter(Boolean).join(", ")}</small>}</span>{value === customer.id && <Check size={19}/>}</button>)}
        {!matches.length && <div className="customer-search-empty"><Search size={26}/><strong>No matching customers</strong><p>Try another name or mobile number, or add a customer.</p></div>}
      </div>
      <footer><button type="button" onClick={() => dialog.current?.close()}>Cancel</button>{can("customers")&&<button type="button" onClick={() => { dialog.current?.close(); onAdd(); }}><UserPlus size={18}/>Add customer</button>}</footer>
    </dialog>
  </div>;
}
