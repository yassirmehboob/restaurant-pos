import { receiptItemTaxes } from "@/lib/item-tax";
import { ItemTax } from "@/components/item-tax";
import { formatDate,formatDateTime } from "@/lib/dates";
import { notFound } from "next/navigation";
import { familyFor,receiptStyle,styleClass } from "@/lib/receipt-layout";
import { FAMILY_FONTS } from "@/lib/receipt-fonts";
import { ReceiptItemTable } from "@/components/receipt-item-table";
import { ReceiptToolbar } from "@/components/receipt-toolbar";
import { OrderBarcode } from "@/components/order-barcode";
import { requirePagePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { kitchenLanguage,localName,nameViewOf } from "@/lib/kitchen-language";
import { kitchenTranslations } from "@/lib/menu-translations";
import { LOCAL_FONT_CSS } from "@/lib/receipt-fonts";
import { withKitchenCategories } from "@/lib/kitchen-categories";
import { orderTickets,WAITER_COPY } from "@/lib/kitchen-tickets";

type Line={lineId:string;productId?:unknown;quantity:number;nameSnapshot:string;unitPrice:number;notes?:string;dealItemsSnapshot?:{productId?:unknown;name:string;quantity:number}[]};
const money=(value:number)=>value.toLocaleString("en-PK",{maximumFractionDigits:2});

export default async function KitchenReceiptPage({params}:{params:Promise<{id:string}>}){
  const user=await requirePagePermission("printing"),{id}=await params;await connectToDatabase();
  const[order,business]=await Promise.all([Order.findOne({_id:id,businessId:user.businessId}).lean(),Business.findOne({_id:user.businessId,isActive:true}).lean()]);
  if(!order||!business)notFound();
  const itemTaxes=await receiptItemTaxes(user.businessId,order);
  // Item names in the kitchen ticket language: English, the approved Sindhi or Urdu, or both (English when none is approved).
  const view=nameViewOf(kitchenLanguage(business.kitchenReceiptLanguage)),translations=await kitchenTranslations(user.businessId,order,business);
  const local=(english:string,className:string)=>{const text=view==="EN"?undefined:localName(english,translations);return text?<span className={`receipt-local ${className}`} dir="rtl" style={{fontFamily:LOCAL_FONT_CSS}}>{text}</span>:null};
  const itemName=(english:string)=>view==="LOCAL"&&local(english,"")?local(english,"is-only"):<>{english}{view==="BOTH"&&local(english,"")}</>;
  const componentName=(name:string,quantity:number)=>{const text=view==="EN"?undefined:localName(name,translations);return view==="LOCAL"&&text?<small className="kitchen-deal-item"><span className="receipt-local" dir="rtl" style={{fontFamily:LOCAL_FONT_CSS}}>{text} × {quantity}</span></small>:<><small className="kitchen-deal-item">&gt; {name} - Qty {quantity}</small>{view==="BOTH"&&text&&<small className="kitchen-deal-item"><span className="receipt-local" dir="rtl" style={{fontFamily:LOCAL_FONT_CSS}}>{text} × {quantity}</span></small>}</>};
  // Same split as the QZ Tray job (lib/receipt-layout.ts): one ticket per category, each on its own page. QZ Tray sends the
  // waiter copy to the counter printer; the browser dialog cannot pick a printer per page, so it is the last page here.
  const items=order.items as Line[],split=Boolean(business.kitchenTicketPerCategory)&&items.length>0;
  const tickets=orderTickets(split?await withKitchenCategories(user.businessId,items):items,{perCategory:split,waiterCopy:business.kitchenWaiterCopy&&business.customerPrintingEnabled!==false}),counters=tickets.filter(ticket=>!ticket.waiterCopy).length,waiterCopies=Math.min(5,Math.max(1,Number(business.kitchenWaiterCopies)||1));
  return <main className={`receipt-page kitchen-receipt paper-${business.receiptPaperWidth??"80"} ${styleClass(receiptStyle(business,"kitchen"))}`} style={{"--receipt-family":FAMILY_FONTS[familyFor(business,"kitchen")].css} as React.CSSProperties}>
    <ReceiptToolbar orderId={id}/>
    {tickets.flatMap(ticket=>ticket.waiterCopy?Array.from({length:waiterCopies},()=>ticket):[ticket]).map((ticket,index)=><article className="receipt kitchen-ticket" key={ticket.waiterCopy?`waiter-copy-${index}`:ticket.category||index}>
      <header>
        <h1>{business.name}</h1><p><b>KITCHEN ORDER</b></p>
        <h2 className="kitchen-band">{order.orderNumber}</h2>
        {ticket.waiterCopy?<><h2 className="kitchen-band kitchen-category">{WAITER_COPY.toUpperCase()}</h2><p><b>Full order</b></p></>:split&&<>
          <h2 className="kitchen-band kitchen-category">{ticket.category.toUpperCase()}</h2>
          {counters>1&&<p><b>Ticket {index+1} of {counters}</b></p>}
        </>}
      </header>
      <OrderBarcode value={order.orderNumber}/>
      <section className="receipt-meta">
        {order.tableNameSnapshot&&<div className="kitchen-meta-strong"><span>Table</span><b>{order.tableNameSnapshot}</b></div>}
        {order.waiterNameSnapshot&&<div className="kitchen-meta-strong"><span>Waiter</span><b>{order.waiterNameSnapshot}</b></div>}
        {order.saleDate&&<div><span>Sale date</span><b>{formatDate(order.saleDate)}</b></div>}
        <div><span>Created</span><b>{formatDateTime(order.createdAt)}</b></div>
        <div><span>Type</span><b>{order.orderType.replace("_","-")}</b></div>
        {order.orderSource==="QR"&&<div><span>Source</span><b>QR code order</b></div>}
      </section>
      <ReceiptItemTable className="kitchen-item-table" prices={Boolean(business.showPricesOnKitchenReceipt)} rows={ticket.items.map(line=>({key:`${line.lineId}-${ticket.category}`,name:<>{itemName(line.nameSnapshot)}{line.dealItemsSnapshot?.map((item,part)=><span key={part}>{componentName(item.name,item.quantity)}</span>)}{line.notes&&<small className="kitchen-item-note">Note: {line.notes}</small>}{business.showPricesOnKitchenReceipt&&<ItemTax rate={itemTaxes.get(line.lineId)?.rate} current={itemTaxes.get(line.lineId)?.current} className="receipt-item-tax"/>}</>,price:money(line.unitPrice),quantity:line.quantity,amount:money(line.unitPrice*line.quantity)}))}/>
      {order.notes&&<section className="kitchen-order-note"><b>ORDER NOTE</b><p>{order.notes}</p></section>}
      <footer><p className="developer-credit">Software developed by: Cubedevsys.com<br/>Contact 03113809764</p></footer>
    </article>)}
  </main>;
}
