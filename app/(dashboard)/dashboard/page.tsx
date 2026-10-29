import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Banknote, CalendarDays, ChartNoAxesCombined, ChefHat, CircleDot, ClipboardList, CreditCard, Layers, Plus, ReceiptText, ShoppingBag, Sparkles, TrendingUp, Truck, UtensilsCrossed, WalletCards } from "lucide-react";
import { DashboardPrivacy, DashboardAmount, DashboardAmountToggle } from "@/components/dashboard-privacy";
import { can, type Privilege } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { activeSaleSession } from "@/lib/sale-sessions";
import { requireUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { buildSalesReport } from "@/lib/reporting";
import "./dashboard.css";

const money = (value: number) => <DashboardAmount value={`Rs ${value.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`} />;
const orderTypes = {
  DINE_IN: { label: "Dine-in", icon: UtensilsCrossed, color: "blue" },
  TAKEAWAY: { label: "Takeaway", icon: ShoppingBag, color: "violet" },
  DELIVERY: { label: "Delivery", icon: Truck, color: "amber" },
};
const readable = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

export default async function DashboardPage() {
  const user = await requireUser();
  if (user.role === "WAITER") redirect("/waiter");
  const shortcuts = [
    { permission: "pos", href: "/pos", label: "New order", description: "Open the point of sale", icon: Plus, color: "blue" },
    { permission: "orders", href: "/orders", label: "Orders", description: "Follow every ticket", icon: ClipboardList, color: "violet" },
    { permission: "kitchen", href: "/kitchen", label: "Kitchen", description: "See what is cooking", icon: ChefHat, color: "amber" },
    { permission: "reports", href: "/reports", label: "Reports", description: "Explore your numbers", icon: ChartNoAxesCombined, color: "teal" },
  ].filter(item => can(user, item.permission as Privilege));
  const quickActions = <section className="overview-shortcuts" aria-label="Quick actions">{shortcuts.map(item => <Link href={item.href} key={item.href}><span className={`overview-icon ${item.color}`}><item.icon size={19} /></span><div><strong>{item.label}</strong><small>{item.description}</small></div><ArrowUpRight size={16} /></Link>)}</section>;

  if (!can(user, "sales") && !can(user, "reports")) return (
    <main className="dashboard-content overview-dashboard">
      <header className="overview-header"><div><p className="overview-eyebrow">YOUR WORKSPACE</p><h1>Welcome, {user.fullName}</h1><p>Everything you need for your next service.</p></div></header>
      {quickActions}
    </main>
  );
  await connectToDatabase();
  const sale = await activeSaleSession(user);
  const report = await buildSalesReport(user.businessId, sale ? { range: "CUSTOM", from: sale.saleDate, to: sale.saleDate } : { range: "TODAY" });
  const { summary } = report;
  const bestSellers = [...report.products.map(row => ({ ...row, kind: "Item" })), ...report.deals.map(row => ({ ...row, kind: "Deal" }))].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const itemsSold = [...report.products, ...report.deals].reduce((total, row) => total + row.quantity, 0);
  const paymentTotal = report.paymentMethods.reduce((total, row) => total + row.amount, 0);
  const historyHref = can(user, "sales") ? "/sales" : "/reports";

  return (
    <DashboardPrivacy>
      <main className="dashboard-content overview-dashboard">
        <header className="overview-header">
          <div><p className="overview-eyebrow">{user.businessName} / OVERVIEW</p><h1>Good day, {user.fullName.split(" ")[0]}<span className="overview-greeting">.</span></h1><p>Here is how your restaurant is doing this sale date.</p></div>
          <div className="overview-header-tools"><span className="overview-date"><CalendarDays size={16} />{formatDate(report.range.fromText)}</span><DashboardAmountToggle /></div>
        </header>
        <section className="overview-hero-grid" aria-label="Sales overview">
          <article className="overview-revenue">
            <div className="overview-revenue-top"><span><span className="overview-live-dot" /> SALES SNAPSHOT</span><ReceiptText size={22} /></div>
            <p>Total paid sales</p><h2>{money(summary.netSales)}</h2>
            <div className="overview-revenue-bottom"><span><b>{summary.orders}</b> paid {summary.orders === 1 ? "order" : "orders"}<span className="overview-divider" />{itemsSold} items &amp; deals sold</span><Link href={historyHref} aria-label="View sales details"><ArrowUpRight size={23} /></Link></div>
          </article>
          <article className="overview-session">
            <div className="overview-session-top"><span className="overview-icon teal"><CircleDot size={22} /></span><span className={`overview-session-state ${sale ? "open" : "closed"}`}>{sale ? "Sale open" : "No active sale"}</span></div>
            <h2>{sale ? sale.counterName : "Ready for the next service?"}</h2>
            <p>{sale ? `Your counter is open for sale date ${formatDate(sale.saleDate)}. These figures cover all paid sales for your restaurant on this date.` : "Start a sale session to set your business date and opening cash before taking orders."}</p>
            {can(user, "sale_sessions") ? <Link href="/sale-sessions">{sale ? "Manage your sale" : "Start a sale"}<ArrowRight size={16} /></Link> : <span className="overview-session-note">{sale ? "Paid sales are independent of kitchen progress." : "Contact your manager to prepare your counter."}</span>}
          </article>
        </section>
        <section className="overview-kpis" aria-label="Key figures">
          <article><span className="overview-icon blue"><ClipboardList size={19} /></span><div><p>Paid orders</p><strong>{summary.orders.toLocaleString("en-PK")}</strong><small>Completed payments</small></div></article>
          <article><span className="overview-icon violet"><WalletCards size={19} /></span><div><p>Average order</p><strong>{money(summary.orders ? summary.netSales / summary.orders : 0)}</strong><small>Per paid ticket</small></div></article>
          <article><span className="overview-icon amber"><ReceiptText size={19} /></span><div><p>Tax collected</p><strong>{money(summary.tax)}</strong><small>Included in paid sales</small></div></article>
          {can(user, "profit") && <article><span className="overview-icon teal"><TrendingUp size={19} /></span><div><p>Estimated gross profit</p><strong>{money(summary.grossProfit)}</strong><small>Sales less stored item costs</small></div></article>}
        </section>
        {!!shortcuts.length && quickActions}
        <div className="overview-analysis-grid">
          <section className="overview-card">
            <div className="overview-card-heading"><div><p className="overview-eyebrow">SERVICE CHANNELS</p><h2>Your order mix</h2></div><span className="overview-icon blue"><Layers size={19} /></span></div>
            <p className="overview-card-description">Where your paid orders are coming from.</p>
            <div className="overview-mix-bar" aria-hidden="true">{report.types.map(row => <span className={orderTypes[row.type as keyof typeof orderTypes]?.color ?? "blue"} key={row.type} style={{ flex: row.orders }} />)}{!report.types.length && <span className="empty" />}</div>
            {report.types.length ? report.types.map(row => {
              const config = orderTypes[row.type as keyof typeof orderTypes] ?? { label: readable(row.type), icon: ShoppingBag, color: "blue" };
              const share = summary.orders ? Math.round(row.orders / summary.orders * 100) : 0;
              return <div className="overview-channel" key={row.type}><span className={`overview-icon ${config.color}`}><config.icon size={18} /></span><div><strong>{config.label}</strong><small>{row.orders} orders / {share}% of orders</small></div><strong>{money(row.sales)}</strong></div>;
            }) : <div className="overview-empty"><ShoppingBag size={27} /><strong>Your first sale starts the story</strong><p>Order channels appear after a payment is completed.</p></div>}
            <div className="overview-card-note"><CircleDot size={13} /> Shares are based on paid order count.</div>
          </section>
          <section className="overview-card">
            <div className="overview-card-heading"><div><p className="overview-eyebrow">MENU PERFORMANCE</p><h2>Best sellers</h2></div><span className="overview-icon amber"><Sparkles size={19} /></span></div>
            <p className="overview-card-description">Top items and deals, ranked by item revenue.</p>
            {bestSellers.length ? <div className="overview-bestsellers">{bestSellers.map((row, index) => <div className="overview-bestseller" key={`${row.kind}-${row.name}`}><span className={`overview-rank ${index === 0 ? "first" : ""}`}>{String(index + 1).padStart(2, "0")}</span><div><strong>{row.name}</strong><small>{row.kind} / {row.quantity} sold</small><div className="overview-item-track" aria-hidden="true"><span style={{ width: `${bestSellers[0].revenue > 0 ? Math.max(0, row.revenue / bestSellers[0].revenue * 100) : 0}%` }} /></div></div><strong>{money(row.revenue)}</strong></div>)}</div> : <div className="overview-empty"><UtensilsCrossed size={27} /><strong>Your menu standouts go here</strong><p>Complete a payment to see which items lead the way.</p></div>}
          </section>
        </div>
        <div className="overview-bottom-grid">
          <section className="overview-card overview-recent">
            <div className="overview-card-heading"><div><p className="overview-eyebrow">LATEST ACTIVITY</p><h2>Recent paid orders</h2></div><Link href={historyHref}>View all <ArrowRight size={14} /></Link></div>
            {report.orders.length ? <div className="overview-table-scroll"><table><thead><tr><th>Order</th><th>Service</th><th>Payment</th><th>Amount</th></tr></thead><tbody>{report.orders.slice(0, 5).map(order => <tr key={String(order._id)}><td>{can(user, "orders") ? <Link href={`/orders/${order._id}`}>{order.orderNumber}</Link> : <strong>{order.orderNumber}</strong>}<small>{order.tableNameSnapshot || order.customerSnapshot?.name || "Guest order"}</small></td><td>{orderTypes[order.orderType as keyof typeof orderTypes]?.label ?? readable(order.orderType)}</td><td><span className="overview-paid"><span />Paid</span></td><td>{money(order.grandTotal)}</td></tr>)}</tbody></table></div> : <div className="overview-empty"><ReceiptText size={27} /><strong>No paid orders yet</strong><p>Paid tickets for this sale date will appear here.</p></div>}
          </section>
          <section className="overview-card overview-payments">
            <div className="overview-card-heading"><div><p className="overview-eyebrow">COLLECTIONS</p><h2>Payment methods</h2></div><span className="overview-icon violet"><CreditCard size={19} /></span></div>
            {report.paymentMethods.length ? report.paymentMethods.map(row => <div className="overview-payment" key={row.method}><div><span>{row.method === "CASH" ? <Banknote size={17} /> : <CreditCard size={17} />}{readable(row.method)}</span><strong>{money(row.amount)}</strong></div><div className="overview-payment-track" aria-hidden="true"><span style={{ width: `${paymentTotal > 0 ? Math.max(0, row.amount / paymentTotal * 100) : 0}%` }} /></div></div>) : <p className="overview-payment-empty">Payment methods appear when sales are paid.</p>}
            <div className="overview-adjustments"><div><span>Discounts</span><strong>{money(summary.discount)}</strong></div><div><span>Delivery charges</span><strong>{money(summary.delivery)}</strong></div></div>
          </section>
        </div>
        <p className="overview-footnote"><CircleDot size={12} /> Figures reflect paid, non-cancelled orders for {formatDate(report.range.fromText)}. Refresh to see the latest payments.</p>
      </main>
    </DashboardPrivacy>
  );
}
