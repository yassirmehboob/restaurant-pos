import Link from "next/link";
import { Eye } from "lucide-react";
import { requirePagePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { activeSaleSession } from "@/lib/sale-sessions";
import { businessDateQuery, type ReportQuery } from "@/lib/reporting";
import { buildReversalReport } from "@/lib/reversal-report";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/dates";
import { DatePicker } from "@/components/date-picker";
import { MasterHeader } from "@/components/master-shell";
import { EmptyState } from "@/components/master-data";

const money = (value: number) => `Rs ${value.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

export default async function ReversalReportPage({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const user = await requirePagePermission("reverse_payments"), query = await searchParams;
  await connectToDatabase();
  const sale = await activeSaleSession(user), report = await buildReversalReport(user.businessId, businessDateQuery(query, sale?.saleDate)), canOpen = can(user, "orders");
  return <main className="master-page reports-page">
    <MasterHeader eyebrow="Owner controls" title="Reversed Payments" description="Payments that were recorded by mistake and put back to unpaid, with who reversed them and why. Dates are the sale date of the reversal." />
    <form className="report-range" method="get">
      <div className="range-presets">{[["TODAY", "Today"], ["YESTERDAY", "Yesterday"], ["WEEK", "This Week"], ["MONTH", "This Month"], ["CUSTOM", "Custom"]].map(([value, label]) => <button name="range" value={value} className={report.range.preset === value ? "active" : ""} key={value}>{label}</button>)}</div>
      <label>From<DatePicker name="from" label="From" key={`from:${report.range.fromText}`} defaultValue={report.range.fromText} /></label>
      <label>To<DatePicker name="to" label="To" key={`to:${report.range.toText}`} defaultValue={report.range.toText} /></label>
      <button className="apply-range" name="range" value="CUSTOM">Apply dates</button>
    </form>
    <section className="report-kpis discount-kpis">
      <article><span>Reversals</span><strong>{report.totals.count}</strong><small>{formatDate(report.range.fromText)} – {formatDate(report.range.toText)}</small></article>
      <article><span>Total reversed</span><strong>{money(report.totals.amount)}</strong></article>
      <article><span>Cash reversed</span><strong>{money(report.totals.cash)}</strong></article>
      <article><span>Card, bank and other</span><strong>{money(report.totals.other)}</strong></article>
    </section>
    <section className="master-list">
      <div className="list-heading"><h2>Reversals</h2><span>{report.reversals.length} found</span></div>
      {report.reversals.length ? <div className="sms-log-table-wrap"><table className="sms-log-table discount-report-table"><thead><tr><th scope="col">Invoice</th><th scope="col">Amount</th><th scope="col">Originally paid</th><th scope="col">Reversed</th><th scope="col">Reason</th><th scope="col">Order now</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{report.reversals.map(row => <tr key={row.id}>
          <td data-label="Invoice"><strong>{row.orderNumber}</strong><small>{row.orderType.replace("_", "-")}</small></td>
          <td data-label="Amount"><strong>{money(row.amount)}</strong><small>{row.method}</small></td>
          <td data-label="Originally paid">{formatDateTime(row.paidAt)}<small>{row.receivedBy || "—"}</small></td>
          <td data-label="Reversed">{formatDateTime(row.reversedAt)}<small>{row.reversedBy || "—"}{row.counter ? ` · ${row.counter}` : ""}</small></td>
          <td data-label="Reason" className="discount-report-remarks">{row.reason}</td>
          <td data-label="Order now">{row.outcome}</td>
          <td className="discount-report-action">{canOpen && <Link className="discount-report-view" href={`/orders/${row.orderId}`}><Eye size={15} />View order</Link>}</td>
        </tr>)}</tbody></table></div> : <EmptyState title="No reversed payments" copy="No payment was reversed in these dates." />}
    </section>
  </main>;
}
