import { notFound,redirect } from "next/navigation";
import { requirePagePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { familyFor,receiptStyle,styleClass } from "@/lib/receipt-layout";
import { FAMILY_FONTS } from "@/lib/receipt-fonts";
import { loadQrSlip } from "@/lib/receipt-print";
import { COUNTER_ROLES } from "@/lib/roles";
import { ReceiptItemTable } from "@/components/receipt-item-table";
import { ReceiptToolbar } from "@/components/receipt-toolbar";

const money=(value:number)=>value.toLocaleString("en-PK",{maximumFractionDigits:2});

// Browser-printed slip for a QR guest order awaiting approval; the waiter checks it with the guest at the table.
export default async function QrSlipPage({params}:{params:Promise<{id:string}>}){
 const user=await requirePagePermission("pos"),{id}=await params;
 if(!COUNTER_ROLES.includes(user.role))redirect("/access-denied");
 await connectToDatabase();
 const slip=await loadQrSlip(user.businessId,id);
 if(!slip)notFound();
 const{business,data}=slip,prices=business.qrShowBillSummary!==false;
 return <main className={`receipt-page kitchen-receipt paper-${business.receiptPaperWidth??"80"} ${styleClass(receiptStyle(business,"kitchen"))}`} style={{"--receipt-family":FAMILY_FONTS[familyFor(business,"kitchen")].css} as React.CSSProperties}>
  <ReceiptToolbar orderId={id} backHref="/pos" backLabel="POS"/>
  <article className="receipt">
   <header><h1>QR ORDER — PLEASE CONFIRM</h1><h2>{data.tableName}</h2><p>Not sent to the kitchen yet</p></header>
   <section className="receipt-meta"><div><span>Guest</span><b>{data.guestName||"Guest"}</b></div><div><span>Mobile</span><b>{data.guestPhone||"-"}</b></div><div><span>Ordered</span><b>{formatDateTime(data.createdAt)}</b></div></section>
   <ReceiptItemTable className="kitchen-item-table" prices={prices} rows={data.lines.map((line,index)=>({key:index,name:<>{line.name}{line.note&&<small className="kitchen-item-note">Note: {line.note}</small>}</>,price:money(line.unitPrice??0),quantity:line.quantity,amount:money((line.unitPrice??0)*line.quantity)}))}/>
   {prices&&data.grandTotal!=null&&<section className="receipt-totals"><div className="receipt-grand"><span>Estimated total</span><b>{money(data.grandTotal)}</b></div></section>}
   <section className="qr-slip-sign"><p>Confirmed with guest: ____________</p><p>Waiter: __________________</p><p><b>This is not a bill.</b></p></section>
   <footer><p className="developer-credit">Software developed by: Cubedevsys.com<br/>Contact 03113809764</p></footer>
  </article>
 </main>;
}
