import Link from "next/link";
import { Eye } from "lucide-react";
import { requirePagePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { activeSaleSession } from "@/lib/sale-sessions";
import { businessDateQuery } from "@/lib/reporting";
import { buildDiscountReport,type DiscountReportQuery } from "@/lib/discount-report";
import { formatDate,formatDateTime } from "@/lib/dates";
import { DatePicker } from "@/components/date-picker";
import { MasterHeader } from "@/components/master-shell";
import { EmptyState } from "@/components/master-data";
import { Business } from "@/models/Business";

const money=(value:number)=>`Rs ${value.toLocaleString("en-PK",{maximumFractionDigits:2})}`;

export default async function DiscountReportPage({searchParams}:{searchParams:Promise<DiscountReportQuery>}){
 const user=await requirePagePermission("reports"),query=await searchParams;await connectToDatabase();
 const sale=await activeSaleSession(user),[report,business]=await Promise.all([buildDiscountReport(user.businessId,{...businessDateQuery(query,sale?.saleDate),type:query.type}),Business.findOne({_id:user.businessId}).select("discountTypes").lean()]);
 const typeNames=[...new Set([...(business?.discountTypes??[]).map((type:{name:string})=>type.name),...report.invoices.map(row=>row.name)])];
 return <main className="master-page reports-page">
  <MasterHeader eyebrow="Paid sales" title="Discounted Invoices" description="Paid invoices that received a discount at payment, with who gave it and why."/>
  <form className="report-range discount-range" method="get">
   <div className="range-presets">{[["TODAY","Today"],["YESTERDAY","Yesterday"],["WEEK","This Week"],["MONTH","This Month"],["CUSTOM","Custom"]].map(([value,label])=><button name="range" value={value} className={report.range.preset===value?"active":""} key={value}>{label}</button>)}</div>
   <label>From<DatePicker name="from" label="From" key={`from:${report.range.fromText}`} defaultValue={report.range.fromText}/></label>
   <label>To<DatePicker name="to" label="To" key={`to:${report.range.toText}`} defaultValue={report.range.toText}/></label>
   <label>Discount<select name="type" defaultValue={report.type} key={`type:${report.type}`}><option value="">All discounts</option>{typeNames.map(name=><option value={name} key={name}>{name}</option>)}</select></label>
   <button className="apply-range" name="range" value="CUSTOM">Apply</button>
  </form>
  <section className="report-kpis discount-kpis">
   <article><span>Discounted invoices</span><strong>{report.totals.count}</strong><small>{formatDate(report.range.fromText)} – {formatDate(report.range.toText)}</small></article>
   <article><span>Amount before discount</span><strong>{money(report.totals.before)}</strong></article>
   <article><span>Total discount</span><strong>{money(report.totals.discount)}</strong></article>
   <article><span>Amount after discount</span><strong>{money(report.totals.after)}</strong></article>
  </section>
  <section className="master-list">
   <div className="list-heading"><h2>Invoices</h2><span>{report.invoices.length} found</span></div>
   {report.invoices.length?<div className="sms-log-table-wrap"><table className="sms-log-table discount-report-table"><thead><tr><th scope="col">Invoice</th><th scope="col">Discount</th><th scope="col">Amount</th><th scope="col">Discount amount</th><th scope="col">After discount</th><th scope="col">Cashier</th><th scope="col">Waiter</th><th scope="col">Remarks</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{report.invoices.map(row=><tr key={row.id}>
     <td data-label="Invoice"><strong>{row.orderNumber}</strong><small>{row.saleDate?`Sale date ${formatDate(row.saleDate)}`:formatDateTime(row.createdAt)}</small></td>
     <td data-label="Discount">{row.name}<small>{row.percent}%</small></td>
     <td data-label="Amount">{money(row.amountBefore)}</td>
     <td data-label="Discount amount">-{money(row.amount)}</td>
     <td data-label="After discount"><strong>{money(row.amountAfter)}</strong></td>
     <td data-label="Cashier">{row.cashier||"—"}</td>
     <td data-label="Waiter">{row.waiter||"—"}</td>
     <td data-label="Remarks" className="discount-report-remarks">{row.remarks||"—"}</td>
     <td className="discount-report-action"><Link className="discount-report-view" href={`/orders/${row.id}`}><Eye size={15}/>View order</Link></td>
    </tr>)}</tbody></table></div>:<EmptyState title="No discounted invoices" copy="No paid invoice in these dates received a discount."/>}
  </section>
 </main>;
}
