"use client";
import { useCan } from "@/components/permission-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowRight, Check, CheckCheck, ChefHat, ClipboardList, Clock3, Flame, Maximize2, Minimize2, RefreshCw, Search, StickyNote, UserRound, Utensils, X } from "lucide-react";
import { changeOrderStatus } from "@/app/(dashboard)/orders/actions";
import { formatElapsedTime } from "@/lib/elapsed-time";
import { formatTime } from "@/lib/dates";

type KitchenStatus = "SENT_TO_KITCHEN" | "PREPARING" | "READY";
type OrderType = "ALL" | "DINE_IN" | "TAKEAWAY" | "DELIVERY";
type KitchenOrder = {
  id: string; orderNumber: string; status: KitchenStatus; orderType: string;
  customer: string; table: string; waiter: string; createdAt: string; kitchenSentAt: string;
  preparingAt?: string; readyAt?: string; notes?: string;
  items: { id: string; name: string; quantity: number; notes?: string; dealItems?: { name: string; quantity: number }[] }[];
};
const stages = [
  { status: "SENT_TO_KITCHEN", title: "New orders", detail: "Ready to start", Icon: ClipboardList },
  { status: "PREPARING", title: "Preparing", detail: "Cooking in progress", Icon: Flame },
  { status: "READY", title: "Ready to serve", detail: "Waiting for collection", Icon: CheckCheck },
] as const;
const orderTypes: { value: OrderType; label: string }[] = [
  { value: "ALL", label: "All orders" }, { value: "DINE_IN", label: "Dine-in" },
  { value: "TAKEAWAY", label: "Takeaway" }, { value: "DELIVERY", label: "Delivery" },
];
const typeLabel = (type: string) => orderTypes.find(option => option.value === type)?.label ?? type;


export function KitchenBoard({ orders, timing, initialNow }: { orders: KitchenOrder[]; timing?: { preparingSeconds: number; readyMinutes: number }; initialNow: number }) {
  const can = useCan(), router = useRouter(), inFlight = useRef(false);
  const [orderType, setOrderType] = useState<OrderType>("ALL"), [query, setQuery] = useState("");
  const [now, setNow] = useState(initialNow), [movingId, setMovingId] = useState("");
  const [error, setError] = useState(""), [fullscreen, setFullscreen] = useState(false);
  const [pending, startTransition] = useTransition(), [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()); startRefresh(() => router.refresh()); }, 15000);
    return () => window.clearInterval(timer);
  }, [router]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { setError("Full screen is unavailable in this browser."); }
  };
  const advance = (order: KitchenOrder) => {
    if (inFlight.current || !can("kitchen")) return;
    const next = order.status === "SENT_TO_KITCHEN" ? "PREPARING" : order.status === "PREPARING" ? "READY" : null;
    if (!next) return;
    inFlight.current = true; setMovingId(order.id); setError("");
    startTransition(async () => {
      try { await changeOrderStatus(order.id, next); router.refresh(); }
      catch { setError("Could not update " + order.orderNumber + ". Refresh and try again."); }
      finally { inFlight.current = false; setMovingId(""); }
    });
  };
  const search = query.trim().toLowerCase();
  const visible = orders.filter(order => (orderType === "ALL" || order.orderType === orderType) &&
    (!search || [order.orderNumber, order.table, order.waiter, order.customer, ...order.items.flatMap(item => [item.name, ...(item.dealItems ?? []).map(component => component.name)])].some(value => value.toLowerCase().includes(search))));
  const filtered = orderType !== "ALL" || Boolean(search);
  return <main className="kitchen-board-page">
    <header className="kitchen-board-header">
      <div className="kitchen-brand"><span className="kitchen-brand-icon"><ChefHat size={27}/></span><div><span>Kitchen workspace</span><h1>Kitchen Display</h1></div></div>
      <div className="kitchen-type-filters" aria-label="Filter by order type">{orderTypes.map(option => <button type="button" key={option.value} aria-pressed={orderType === option.value} onClick={() => setOrderType(option.value)}>{option.label}<span>{option.value === "ALL" ? orders.length : orders.filter(order => order.orderType === option.value).length}</span></button>)}</div>
      <div className="kitchen-header-actions"><span className="kitchen-live"><i/>{orders.length} active orders</span>
        <button type="button" onClick={() => startRefresh(() => { setNow(Date.now()); router.refresh(); })} disabled={refreshing} aria-label="Refresh kitchen orders"><RefreshCw size={17} className={refreshing ? "kitchen-spin" : ""}/><span>Refresh</span></button>
        <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit full screen" : "Enter full screen"} title={fullscreen ? "Exit full screen" : "Full screen"}>{fullscreen ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}</button>
        {can("orders") && <Link href="/orders" aria-label="Placed Orders"><ClipboardList size={17}/><span>Placed Orders</span></Link>}
      </div>
    </header>
    <div className="kitchen-board-info"><div className="kitchen-board-meta"><span><span className="kitchen-auto-dot"/>Auto refresh every 15 seconds{filtered ? " / " + visible.length + " matching orders" : " / Oldest orders first"}</span><span>{timing ? "Auto preparing: " + timing.preparingSeconds + " sec / Auto ready: " + timing.readyMinutes + " min" : "Use the button on each ticket to update its stage"}</span><span>Open sales / Orders stay visible for 5 hours after sale closes</span></div><div className="kitchen-search"><Search size={18}/><input aria-label="Search kitchen orders" placeholder="Find order, table or item..." value={query} onChange={event => setQuery(event.target.value)}/>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={16}/></button>}</div></div>
    {error && <div className="kitchen-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError("")}><X size={18}/></button></div>}
    <section className="kitchen-columns" aria-label="Kitchen order stages">{stages.map(({ status, title, detail, Icon }) => {
      const rows = visible.filter(order => order.status === status);
      return <section className={"kitchen-column kitchen-" + status.toLowerCase()} aria-label={title} key={status}>
        <header><span className="kitchen-stage-icon"><Icon size={21}/></span><div><h2>{title}</h2><p>{detail}</p></div><span className="kitchen-stage-count">{rows.length}</span></header>
        <div className="kitchen-order-list">{rows.map(order => {
          const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
          const since = status === "READY" ? order.readyAt ?? order.kitchenSentAt : status === "PREPARING" ? order.preparingAt ?? order.kitchenSentAt : order.kitchenSentAt;
          return <article className="kitchen-order-card" key={order.id} aria-label={order.orderNumber} aria-busy={pending && movingId === order.id}>
            <header className="kitchen-card-head"><div><span className={"kitchen-order-type type-" + order.orderType.toLowerCase()}><Utensils size={12}/>{typeLabel(order.orderType)}</span><h3>{order.orderNumber}</h3></div><div className="kitchen-ticket-age"><span><Clock3 size={14}/>{formatElapsedTime(since, now)}</span><small>{status === "READY" ? "since ready" : status === "PREPARING" ? "preparing" : "waiting"}</small></div></header>
            <div className="kitchen-ticket-assignment"><strong>{order.orderType === "DINE_IN" ? order.table || "No table assigned" : order.customer}</strong>{order.waiter && <span><UserRound size={14}/>{order.orderType === "DELIVERY" ? "Rider: " : "Waiter: "}{order.waiter}</span>}{order.orderType === "DINE_IN" && order.customer !== "Walk-in customer" && <small>{order.customer}</small>}</div>
            <div className="kitchen-items-heading"><span>{count} {count === 1 ? "item" : "items"}</span><time dateTime={order.createdAt}>Ordered {formatTime(order.createdAt)}</time></div>
            <ul className="kitchen-items">{order.items.map(item => <li key={item.id}><span className="kitchen-item-quantity">{item.quantity}<small>x</small></span><div><strong>{item.name}</strong>{Boolean(item.dealItems?.length) && <ul className="kitchen-deal-components">{item.dealItems?.map((component, index) => <li key={index}><b>{component.quantity}x</b> {component.name}</li>)}</ul>}{item.notes && <p className="kitchen-item-note"><StickyNote size={14}/><span>{item.notes}</span></p>}</div></li>)}</ul>
            {order.notes && <div className="kitchen-order-note"><StickyNote size={16}/><div><strong>Order note</strong><p>{order.notes}</p></div></div>}
            <footer>{status === "READY" ? <div className="kitchen-ready-label"><CheckCheck size={19}/>Ready for collection</div> : <button type="button" disabled={pending || !can("kitchen")} onClick={() => advance(order)} aria-label={(status === "SENT_TO_KITCHEN" ? "Start preparing " : "Mark ready ") + order.orderNumber}>{movingId === order.id ? <><RefreshCw size={18} className="kitchen-spin"/>Updating...</> : status === "SENT_TO_KITCHEN" ? <><Flame size={19}/>Start preparing<ArrowRight size={17}/></> : <><Check size={20}/>Mark ready<ArrowRight size={17}/></>}</button>}</footer>
          </article>;
        })}{!rows.length && <div className="kitchen-empty"><span><Icon size={28}/></span><strong>{filtered ? "No matching orders" : status === "SENT_TO_KITCHEN" ? "All caught up" : status === "PREPARING" ? "Nothing cooking yet" : "No orders ready yet"}</strong><p>{filtered ? "Try another filter or search." : status === "SENT_TO_KITCHEN" ? "New kitchen orders will appear here." : status === "PREPARING" ? "Start a new order to move it here." : "Finished orders will appear here."}</p></div>}</div>
      </section>;
    })}</section>
  </main>;
}
