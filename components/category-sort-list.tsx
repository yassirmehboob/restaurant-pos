"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, GripVertical } from "lucide-react";
import { reorderCategories } from "@/app/(dashboard)/master-actions";

export type SortableCategory = { id: string; name: string; isActive: boolean; actions: React.ReactNode };

// Active categories are dragged by their handle (mouse or touch) or moved with the arrow keys on it.
// Inactive categories stay at the bottom and cannot be moved, matching how the POS hides them.
export function CategorySortList({ categories }: { categories: SortableCategory[] }) {
  const activeIds = categories.filter(row => row.isActive).map(row => row.id), key = activeIds.join(",");
  const [order, setOrder] = useState(activeIds), [synced, setSynced] = useState(key);
  const [dragging, setDragging] = useState<string | null>(null), [notice, setNotice] = useState<{ id: string; state: "saving" | "ok" | "error"; text: string } | null>(null), [saving, startSaving] = useTransition();
  const list = useRef<HTMLDivElement>(null), start = useRef<string[]>([]);
  if (synced !== key) { setSynced(key); setOrder(activeIds); }
  const byId = new Map(categories.map(row => [row.id, row]));
  const rows = [...order.map(id => byId.get(id)).filter(row => row !== undefined), ...categories.filter(row => !row.isActive)];

  // The result is shown on the category that was moved; a success note clears itself, an error stays until the next move.
  useEffect(() => { if (notice?.state !== "ok") return; const timer = setTimeout(() => setNotice(current => current === notice ? null : current), 2500); return () => clearTimeout(timer); }, [notice]);
  const save = (next: string[], previous: string[], id: string) => {
    if (next.join(",") === previous.join(",")) return;
    setNotice({ id, state: "saving", text: "Saving…" });
    startSaving(async () => {
      try {
        const result = await reorderCategories(next);
        if (result?.ok) setNotice({ id, state: "ok", text: "Saved" });
        else { setOrder(previous); setNotice({ id, state: "error", text: result?.message ?? "Order was not saved." }); }
      } catch { setOrder(previous); setNotice({ id, state: "error", text: "Order was not saved. Check the connection and try again." }); }
    });
  };
  const move = (from: number, to: number, ids: string[]) => { const next = [...ids], [item] = next.splice(from, 1); next.splice(to, 0, item); return next; };

  const orderRef = useRef(order), pointerY = useRef(0), frame = useRef(0), stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => { cancelAnimationFrame(frame.current); stopDrag.current?.(); }, []);
  // Places the dragged row in front of the first other row whose middle is below the pointer.
  const reposition = (id: string) => {
    if (!list.current) return;
    const current = orderRef.current, items = [...list.current.querySelectorAll<HTMLElement>("[data-sort-id]")];
    let target = items.findIndex(item => item.dataset.sortId !== id && pointerY.current < item.getBoundingClientRect().top + item.offsetHeight / 2);
    const from = current.indexOf(id);
    if (target === -1) target = current.length - 1; else if (target > from) target -= 1;
    if (target !== from) { const next = move(from, target, current); orderRef.current = next; setOrder(next); }
  };
  // While the pointer is held near the top or bottom edge, keep scrolling whatever area actually scrolls.
  const scroller = () => { for (let node = list.current?.parentElement; node; node = node.parentElement) { const style = getComputedStyle(node).overflowY; if ((style === "auto" || style === "scroll") && node.scrollHeight > node.clientHeight) return node; } return document.scrollingElement as HTMLElement | null; };
  const autoScroll = (id: string) => {
    const box = scroller();
    if (box) {
      const bounds = box === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : box.getBoundingClientRect(), edge = 56, y = pointerY.current;
      const speed = y < bounds.top + edge ? -Math.ceil((bounds.top + edge - y) / 4) : y > bounds.bottom - edge ? Math.ceil((y - bounds.bottom + edge) / 4) : 0;
      if (speed) { const before = box.scrollTop; box.scrollTop += speed; if (box.scrollTop !== before) reposition(id); }
    }
    frame.current = requestAnimationFrame(() => autoScroll(id));
  };
  // Moves and the release are watched on the window: React moves the row elements while sorting,
  // and a moved element loses pointer capture, so its own pointerup would never fire and nothing would save.
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (saving || event.button !== 0 || stopDrag.current) return;
    event.preventDefault();
    start.current = order; orderRef.current = order; pointerY.current = event.clientY; setDragging(id); setNotice(null);
    const pointerId = event.pointerId;
    const onMove = (moveEvent: PointerEvent) => { if (moveEvent.pointerId !== pointerId) return; moveEvent.preventDefault(); pointerY.current = moveEvent.clientY; reposition(id); };
    const onEnd = (endEvent: PointerEvent) => { if (endEvent.pointerId !== pointerId) return; stop(); setDragging(null); save(orderRef.current, start.current, id); };
    const stop = () => { cancelAnimationFrame(frame.current); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onEnd); window.removeEventListener("pointercancel", onEnd); stopDrag.current = null; };
    window.addEventListener("pointermove", onMove, { passive: false }); window.addEventListener("pointerup", onEnd); window.addEventListener("pointercancel", onEnd);
    stopDrag.current = stop;
    cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => autoScroll(id));
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (saving || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const from = order.indexOf(id), to = from + (event.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= order.length) return;
    const next = move(from, to, order); setOrder(next); save(next, order, id);
  };

  return <>
    <p className="category-sort-hint">Drag ⋮⋮ to change the order on the POS and menu.</p>
    <p className="sr-only" role="status">{notice ? `${byId.get(notice.id)?.name ?? "Category"}: ${notice.text}` : ""}</p>
    <div className={`data-table category-sort-list${dragging ? " is-sorting" : ""}`} ref={list}>
      {rows.map(row => {
        const position = order.indexOf(row.id);
        return <article key={row.id} data-sort-id={row.isActive ? row.id : undefined} className={`${row.isActive ? "" : "inactive"}${dragging === row.id ? " is-dragging" : ""}${notice?.id === row.id && !dragging ? ` is-${notice.state}` : ""}`}>
          <div className="record-main">
            {row.isActive ? <button type="button" className="category-drag-handle" aria-label={`Move ${row.name}. Use the up and down arrow keys.`} disabled={saving} onPointerDown={event => onPointerDown(event, row.id)} onKeyDown={event => onKeyDown(event, row.id)}><GripVertical size={18} /></button> : <span className="category-drag-handle" aria-hidden="true" />}
            <span className="record-avatar">{row.name.charAt(0)}</span>
            <div><strong>{row.name}</strong><small>{row.isActive ? `Position ${position + 1}` : "Inactive"}{notice?.id === row.id && <span className={`category-sort-status ${notice.state}`}>{notice.state === "ok" && <Check size={13} />}{notice.text}</span>}</small></div>
          </div>
          <div className="record-actions">{row.actions}</div>
        </article>;
      })}
    </div>
  </>;
}
