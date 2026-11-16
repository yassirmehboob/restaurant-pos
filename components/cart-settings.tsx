"use client";
import { useId, useState, useTransition } from "react";
import { Check, LoaderCircle, ShoppingCart } from "lucide-react";
import { saveCartSettings } from "@/app/(dashboard)/settings/business/cart-actions";
import type { CartIncreaseMode } from "@/lib/pos-cart";

export function CartSettings({ mode }: { mode: CartIncreaseMode }) {
  const id = useId(), [value, setValue] = useState(mode), [saved, setSaved] = useState(mode);
  const dirty = value !== saved;
  const [pending, start] = useTransition(), [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  return <form className="waiter-settings-card" aria-labelledby={`${id}-title`} onSubmit={event => {
    event.preventDefault();
    if (pending || !dirty) return;
    const submitted = value;
    setFeedback(null);
    start(async () => {
      try { await saveCartSettings(submitted); setSaved(submitted); setFeedback({ ok: true, message: "Cart preferences saved." }); }
      catch { setFeedback({ ok: false, message: "Could not save. Please try again." }); }
    });
  }}>
    <div className="waiter-settings-content">
      <header className="waiter-settings-header"><span className="waiter-settings-icon" aria-hidden="true"><ShoppingCart size={20} /></span><h2 id={`${id}-title`}>Cart behavior</h2><p>Choose how increases work when editing a placed order in the POS.</p></header>
      <div className="waiter-settings-body">
        <fieldset disabled={pending} className="cart-settings-options"><legend>Increasing a placed item</legend>
          {([ ["SAME_LINE", "Increase quantity in the same row", "Adding the same item or pressing + updates the existing row."], ["NEW_LINE", "Add increases as a new row", "Placed rows keep their quantity. Extra quantities go to a new row and print separately on the customer invoice."] ] as const).map(([option, label, description]) => <label className="cart-settings-option" key={option}>
            <input type="radio" name="cartIncreaseMode" value={option} checked={value === option} onChange={() => { setValue(option); setFeedback(null); }} />
            <span><strong>{label}</strong><small>{description}</small></span>
          </label>)}
        </fieldset>
        <p className="cart-settings-help">In both modes, placed rows can be decreased or removed. Items added during the current edit can be increased in their new row.</p>
      </div>
    </div>
    <footer className="waiter-settings-footer"><div className={`waiter-settings-feedback${feedback && !feedback.ok ? " is-error" : ""}`} role="status" aria-live="polite">{feedback?.ok && <Check size={16} />}<span>{feedback?.message ?? (dirty ? "You have unsaved changes." : "Applies when opening an order in the POS.")}</span></div><button type="submit" disabled={pending || !dirty}>{pending && <LoaderCircle className="waiter-settings-spinner" size={16} />}<span>{pending ? "Saving…" : "Save changes"}</span></button></footer>
  </form>;
}
