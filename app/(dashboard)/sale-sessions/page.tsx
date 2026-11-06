import { OpenCounters } from "@/components/open-counters";
import { requirePagePermission } from "@/data/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import Link from "next/link";
import { ArrowRight, ChevronDown, History, ReceiptText } from "lucide-react";
import { activeSaleSession, sessionTotals, sessionUnpaidOrders, sessionsUncollected } from "@/lib/sale-sessions";
import { SaleSession } from "@/models/SaleSession";
import { MasterHeader } from "@/components/master-shell";
import { StartSaleForm, CloseSaleForm } from "@/components/sale-session-forms";
import { uncollectedTotal, type SessionTotals } from "@/lib/sale-session-totals";
import { SHIFT_MANAGER_ROLES } from "@/lib/roles";
import { can } from "@/lib/permissions";

const money = (amount: number) => `Rs ${amount.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const timestamp = formatDateTime;
function Totals({ opening, totals, uncollected }: { opening: number; totals: SessionTotals; uncollected?: number }) {
  const showUncollected = uncollected !== undefined;
  return <div className="session-totals">
    <div className={`session-main-totals${showUncollected ? " has-uncollected" : ""}`}>{[["Opening balance", opening], ["Collected sales", totals.sales], ...(showUncollected ? [["Uncollected sales", uncollected]] : []), ["Expenses", totals.expenses], ["Total balance", totals.balance]].map(([label, amount]) => <div key={label} className={label === "Uncollected sales" && Number(amount) > 0 ? "is-uncollected" : undefined}><span>{label}</span><strong>{money(Number(amount))}</strong></div>)}</div>
    <div className="session-cash-totals"><span>Cash sales <strong>{money(totals.cashSales)}</strong></span><span>Cash expenses <strong>{money(totals.cashExpenses)}</strong></span><span>Expected drawer cash <strong>{money(totals.expectedCash)}</strong></span></div>
    <p>{totals.paymentCount} payments · {totals.expenseCount} expenses. Balance includes all methods; drawer cash excludes card and bank payments.{showUncollected ? " Uncollected sales are not part of the balance." : ""}</p>
  </div>;
}

type UnpaidOrder = Awaited<ReturnType<typeof sessionUnpaidOrders>>[number];
function UnpaidInvoices({ orders, canOpen }: { orders: UnpaidOrder[]; canOpen: boolean }) {
  if (!orders.length) return null;
  return <section className="session-unpaid" aria-label="Unpaid invoices">
    <header><ReceiptText size={18}/><strong>Unpaid invoices</strong><span>{orders.length}</span></header>
    <ul>{orders.map(order => {
      const id = String(order._id), who = order.tableNameSnapshot ?? order.customerSnapshot?.name ?? "Counter";
      const details = <><span className="session-unpaid-order"><strong>{order.orderNumber}</strong><small>{order.orderType.replace("_", "-")} · {who} · {timestamp(order.createdAt)}</small></span><b className={`order-status status-${order.status.toLowerCase()}`}>{order.status.replaceAll("_", " ")}</b><strong className="session-unpaid-due">{money(order.dueAmount)}</strong></>;
      return <li key={id}>{canOpen ? <Link href={`/orders/${id}`}>{details}<ArrowRight size={16}/></Link> : <div>{details}</div>}</li>;
    })}</ul>
  </section>;
}

export default async function SaleSessionsPage() {
  const user = await requirePagePermission("sale_sessions"), active = await activeSaleSession(user);
  const manager = SHIFT_MANAGER_ROLES.includes(user.role);
  const history = await SaleSession.find({ businessId: user.businessId, ...(!manager ? { userId: user.id } : {}), status: "CLOSED" }).sort({ closedAt: -1 }).limit(100).lean();
  const openCounters=await SaleSession.find({businessId:user.businessId,status:"OPEN"}).sort({openedAt:1}).lean();
  const totals = active ? await sessionTotals(user.businessId, String(active._id), active.openingBalance) : null;
  const unpaid = active ? await sessionUnpaidOrders(user.businessId, String(active._id)) : [];
  // Other counters' takings are only shown to the people who can already see every shift.
  const counterUnpaid = manager ? await sessionsUncollected(user.businessId, openCounters.map(counter => String(counter._id))) : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return <main className="master-page sale-sessions-page">
    <MasterHeader eyebrow="Counters & shifts" title="Start / Close Sale" description="Manage your opening cash, shift totals and closing balance." />
    {active && totals ? <section className="session-card"><div className="session-heading"><div><span className="session-open-label">Sale open</span><h2>{active.counterName} <small>{formatDate(active.saleDate)}</small></h2><p>{active.userNameSnapshot} · Started {timestamp(active.openedAt)}</p></div><Link className="session-pos-link" href="/pos">Continue to POS<ArrowRight size={17}/></Link></div><Totals opening={active.openingBalance} totals={totals} uncollected={uncollectedTotal(unpaid)} /><UnpaidInvoices orders={unpaid} canOpen={can(user, "orders")} /><CloseSaleForm key={String(active._id)} id={String(active._id)} unpaidCount={unpaid.length} /></section> : <StartSaleForm today={today} />}
    <OpenCounters isOwner={user.role==="OWNER"} counters={openCounters.map(counter=>({id:String(counter._id),name:counter.counterName,userName:counter.userNameSnapshot,saleDate:counter.saleDate,openedAt:counter.openedAt.toISOString(),own:String(counter.userId)===user.id,unpaid:counterUnpaid?.get(String(counter._id))}))}/>
    <details className="session-history"><summary><History size={20}/><strong>{manager ? "Business shift history" : "Your shift history"}</strong><span>{history.length} recent shifts</span><ChevronDown size={18}/></summary><div className="session-history-list">
      {history.map(sale => <details className="session-card" key={String(sale._id)}><summary><strong>{formatDate(sale.saleDate)} · {sale.counterName}</strong><span>{sale.userNameSnapshot} · Closed {timestamp(sale.closedAt)} · {money(sale.closingTotals?.balance ?? 0)}</span></summary><p>{sale.closedByOwner?`Closed by owner ${sale.closedByNameSnapshot} / `:""}Started {timestamp(sale.openedAt)} · Closed {timestamp(sale.closedAt)}</p>{sale.closingTotals && <Totals opening={sale.openingBalance} totals={sale.closingTotals as SessionTotals} />}</details>)}
      {!history.length && <p>No closed shifts yet.</p>}
    </div></details>
  </main>;
}
