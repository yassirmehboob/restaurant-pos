import Link from "next/link";
import { Download, Eye } from "lucide-react";
import { requirePagePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { activeSaleSession } from "@/lib/sale-sessions";
import { businessDateQuery, type ReportQuery } from "@/lib/reporting";
import { buildTaxReport } from "@/lib/tax-report";
import { formatDate, formatDateTime } from "@/lib/dates";
import { DatePicker } from "@/components/date-picker";
import { MasterHeader } from "@/components/master-shell";
import { EmptyState } from "@/components/master-data";

const money = (value: number) => `Rs ${value.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;

export default async function TaxReportPage({ searchParams }: { searchParams: Promise<ReportQuery> }) {
  const user = await requirePagePermission("reports"), query = await searchParams;
  await connectToDatabase();
  const sale = await activeSaleSession(user);
  const report = await buildTaxReport(user.businessId, businessDateQuery(query, sale?.saleDate));
  const exportParams = new URLSearchParams({ range: "CUSTOM", from: report.range.fromText, to: report.range.toText });

  return <main className="master-page reports-page">
    <MasterHeader eyebrow="Paid sales" title="Tax Collection Report" description="Tax collected on paid, non-cancelled invoices for the selected sale dates, using the tax amounts saved on each order." actions={<>
      <a className="report-export" href={`/api/reports/tax/pdf?${exportParams}`}><Download size={16} />Export PDF</a>
      <a className="report-export" href={`/api/reports/tax/xlsx?${exportParams}`}><Download size={16} />Export Excel</a>
    </>} />
    <form className="report-range" method="get">
      <div className="range-presets">{[["TODAY", "Today"], ["YESTERDAY", "Yesterday"], ["WEEK", "This Week"], ["MONTH", "This Month"], ["CUSTOM", "Custom"]].map(([value, label]) => <button name="range" value={value} className={report.range.preset === value ? "active" : ""} key={value}>{label}</button>)}</div>
      <label>From<DatePicker name="from" label="From" key={`from:${report.range.fromText}`} defaultValue={report.range.fromText} /></label>
      <label>To<DatePicker name="to" label="To" key={`to:${report.range.toText}`} defaultValue={report.range.toText} /></label>
      <button className="apply-range" name="range" value="CUSTOM">Apply dates</button>
    </form>
    <section className="report-kpis">
      <article><span>Total tax collected</span><strong>{money(report.totals.tax)}</strong><small>{formatDate(report.range.fromText)} – {formatDate(report.range.toText)}</small></article>
      <article><span>Paid invoices with tax</span><strong>{report.totals.orders}</strong></article>
      <article><span>Total sales including tax</span><strong>{money(report.totals.sales)}</strong></article>
    </section>
    <section className="master-list">
      <div className="list-heading"><h2>Invoice tax collection</h2><span>{report.orders.length} found</span></div>
      {report.orders.length ? <div className="sms-log-table-wrap"><table className="sms-log-table discount-report-table">
        <thead><tr><th scope="col">Invoice</th><th scope="col">Order type</th><th scope="col">Payment method</th><th scope="col">Tax collected</th><th scope="col">Invoice total</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{report.orders.map(order => <tr key={String(order._id)}>
          <td data-label="Invoice"><strong>{order.orderNumber}</strong><small>{order.saleDate ? `Sale date ${formatDate(order.saleDate)}` : formatDateTime(order.completedAt ?? order.createdAt)}</small></td>
          <td data-label="Order type">{order.orderType.replaceAll("_", " ")}</td>
          <td data-label="Payment method">{order.paymentMethods.join(" + ") || "Not recorded"}</td>
          <td data-label="Tax collected"><strong>{money(order.taxAmount)}</strong></td>
          <td data-label="Invoice total">{money(order.grandTotal)}</td>
          <td className="discount-report-action"><Link className="discount-report-view" href={`/orders/${order._id}`}><Eye size={15} />View order</Link></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="No tax collected" copy="No paid invoices with tax collected were found for these dates." />}
    </section>
  </main>;
}
