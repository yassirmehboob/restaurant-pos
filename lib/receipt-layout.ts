import { formatDate,formatDateTime } from "@/lib/dates";
import { EscPos,columnsFor,RECEIPT_FONTS,RECEIPT_SIZES,type PaperWidth,type ReceiptStyle } from "@/lib/escpos";
import { receiptFamily,type ReceiptFamily } from "@/lib/receipt-fonts";
import { receiptItemRows,receivedRows } from "@/lib/receipt-lines";
import { kitchenLanguage,localName,nameViewOf,type TranslationMap } from "@/lib/kitchen-language";
import { kitchenTickets,type TicketCategory } from "@/lib/kitchen-tickets";

// Pure receipt layout: the printer job and the settings preview both render through here, so they always match.
export type ReceiptKind="customer"|"kitchen";
// "logo" marks where the client inserts an image (the logo, the payment QR code); QZ Tray rasterises it between the command parts.
// width: the image is scaled to exactly this many printer dots (a QR code must stay large enough to scan); without it, logo size.
export type PrintPart={type:"command";base64:string}|{type:"logo";url:string;width?:number};
export type ReceiptBusiness={
  name:string;address?:string|null;phone?:string|null;taxNumber?:string|null;receiptHeader?:string|null;receiptFooter?:string|null;logoUrl?:string|null;
  showLogoOnCustomerReceipt?:boolean|null;showPricesOnKitchenReceipt?:boolean|null;receiptPaperWidth?:string|null;
  customerReceiptFont?:string|null;customerReceiptSize?:string|null;kitchenReceiptFont?:string|null;kitchenReceiptSize?:string|null;
  customerReceiptFamily?:string|null;kitchenReceiptFamily?:string|null;kitchenReceiptLanguage?:string|null;
  // One kitchen ticket per menu category, for restaurants with separate kitchen counters.
  kitchenTicketPerCategory?:boolean|null;
  paymentQrUrl?:string|null;paymentQrCaption?:string|null;paymentQrShowOn?:string|null;
};
// Category fields are filled in by lib/kitchen-categories.ts when the business prints a ticket per category.
type Line=TicketCategory&{quantity:number;nameSnapshot:string;unitPrice:number;notes?:string;dealItemsSnapshot?:(TicketCategory&{name:string;quantity:number})[]};
type IssuedCoupon={code:string;batchName:string;description:string;expiresOn?:string;usage?:string};
export type ReceiptOrder={
  orderNumber:string;createdAt:Date|string;saleDate?:string|null;orderType:string;tableNameSnapshot?:string|null;waiterNameSnapshot?:string|null;
  customerSnapshot?:{name?:string|null;address?:string|null;area?:string|null}|null;paymentStatus:string;items:Line[];notes?:string|null;orderSource?:string|null;
  subtotal:number;discountAmount?:number|null;couponCode?:string|null;invoiceDiscount?:{name:string;percent:number;amount:number}|null;
  taxAmount:number;taxRateSnapshot?:number|null;deliveryChargeAmount?:number|null;grandTotal:number;paidAmount:number;dueAmount:number;issuedCoupons?:IssuedCoupon[]|null;
};
// translations: English item name -> Sindhi or Urdu, for the kitchen ticket's language (lib/kitchen-language.ts).
export type ReceiptExtras={payments?:{method?:string;amount:number;tenderedAmount?:number|null;changeAmount?:number|null}[];cashier?:string|null;readyMessage?:string|null;translations?:TranslationMap};

const money=(value:number)=>(value??0).toLocaleString("en-PK",{minimumFractionDigits:2,maximumFractionDigits:2});
const pick=<T extends string>(values:readonly T[],value:unknown,fallback:T)=>values.includes(value as T)?value as T:fallback;
export const paperWidth=(business:Pick<ReceiptBusiness,"receiptPaperWidth">):PaperWidth=>business.receiptPaperWidth==="58"?"58":"80";
export function receiptStyle(business:ReceiptBusiness,kind:ReceiptKind):ReceiptStyle{
  return{font:pick(RECEIPT_FONTS,business[`${kind}ReceiptFont`],"STANDARD"),size:pick(RECEIPT_SIZES,business[`${kind}ReceiptSize`],"NORMAL")};
}
export const familyFor=(business:ReceiptBusiness,kind:ReceiptKind):ReceiptFamily=>receiptFamily(business[`${kind}ReceiptFamily`]);
// Browser print pages approximate the same style with CSS classes (app/receipts.css).
export const styleClass=(style:ReceiptStyle)=>`font-${style.font.toLowerCase()} size-${style.size.toLowerCase()}`;

// Bills printed before payment say so plainly, so they are never mistaken for a paid receipt.
export const unpaidLabel=(order:Pick<ReceiptOrder,"paymentStatus">)=>order.paymentStatus==="PAID"?null:order.paymentStatus==="PARTIAL"?"PARTIALLY PAID BILL":"UNPAID BILL";

// Each printed slip ends with the developer credit and a cut.
const footer=(p:EscPos)=>p.feed(1).align("center").text("Software developed by: Cubedevsys.com").text("Contact 03113809764").cut();

export const PAYMENT_QR_SHOW_ON=["UNPAID","ALL","NEVER"] as const;
export type PaymentQrShowOn=(typeof PAYMENT_QR_SHOW_ON)[number];
export const paymentQrShowOn=(value:unknown):PaymentQrShowOn=>PAYMENT_QR_SHOW_ON.includes(value as PaymentQrShowOn)?value as PaymentQrShowOn:"UNPAID";
// The payment QR code prints on unpaid (and part-paid) bills, or on every customer receipt, as the business chose.
export function showPaymentQr(business:Pick<ReceiptBusiness,"paymentQrUrl"|"paymentQrShowOn">,order:Pick<ReceiptOrder,"paymentStatus">){
  const showOn=paymentQrShowOn(business.paymentQrShowOn);
  return Boolean(business.paymentQrUrl)&&(showOn==="ALL"||showOn==="UNPAID"&&order.paymentStatus!=="PAID");
}
export const PAYMENT_QR_CAPTION="Scan to pay";
// About 60% of the paper (the receipt image is 504 dots wide on 80 mm, 360 on 58 mm).
export const paymentQrWidth=(paper:PaperWidth)=>paper==="58"?224:304;

export function renderReceipt(kind:ReceiptKind,business:ReceiptBusiness,order:ReceiptOrder,extras:ReceiptExtras={}):PrintPart[]{
  const paper=paperWidth(business),style=receiptStyle(business,kind),p=new EscPos(columnsFor(paper,style.font),style),parts:PrintPart[]=[];
  const meta=(label:string,value:string)=>p.row(label,value);
  if(kind==="customer"){
    const payments=extras.payments??[];
    p.align("center");
    if(business.showLogoOnCustomerReceipt!==false&&business.logoUrl){parts.push({type:"command",base64:p.toBase64()},{type:"logo",url:business.logoUrl});p.reset()}
    p.align("center").bold(true).size("tall").text(business.name).size("normal").bold(false);
    for(const line of [business.receiptHeader,business.address,business.phone,business.taxNumber?`Tax #: ${business.taxNumber}`:""])if(line)p.text(line);
    p.align("left").divider();
    const unpaid=unpaidLabel(order);
    if(unpaid)p.align("center").bold(true).size("tall").text(unpaid).size("normal").bold(false).align("left").divider();
    meta("Receipt",order.orderNumber);meta("Date",formatDateTime(order.createdAt));
    if(order.saleDate)meta("Sale date",formatDate(order.saleDate));
    meta("Type",order.orderType.replace("_","-"));
    if(order.tableNameSnapshot)meta("Table",order.tableNameSnapshot);
    if(extras.cashier)meta("Cashier",extras.cashier);
    if(order.waiterNameSnapshot)meta("Waiter",order.waiterNameSnapshot);
    if(order.customerSnapshot?.name)meta("Customer",order.customerSnapshot.name);
    if(order.orderType==="DELIVERY"){p.text("Address: "+(order.customerSnapshot?.address||"Not provided"));p.text("Area: "+(order.customerSnapshot?.area||"Not provided"))}
    meta("Payment",order.paymentStatus);
    p.divider();
    // Lines print before tax and discount so they add up to the subtotal; tax and coupon follow it. Item notes are for the kitchen, not the customer.
    const invoiceDiscount=(order.invoiceDiscount?.amount??0)>0?order.invoiceDiscount:null,couponDiscount=(order.discountAmount??0)-(invoiceDiscount?.amount??0);
    for(const row of receiptItemRows(order.items.map(line=>({name:line.nameSnapshot,unitPrice:line.unitPrice,quantity:line.quantity})),p.columnsAt("normal"),money))p.bold(Boolean(row.bold)).line(row.text).bold(false);
    p.divider();
    p.row("Subtotal",money(order.subtotal));
    if(couponDiscount>0)p.row(`Coupon${order.couponCode?` ${order.couponCode}`:""}`,"-"+money(couponDiscount));
    if(invoiceDiscount)p.row(`${invoiceDiscount.name} (${invoiceDiscount.percent}%)`,"-"+money(invoiceDiscount.amount));
    if(order.taxAmount>0)p.row(`Tax${order.taxRateSnapshot!==undefined&&order.taxRateSnapshot!==null?` (${order.taxRateSnapshot}%)`:""}`,money(order.taxAmount));
    if((order.deliveryChargeAmount??0)>0)p.row("Delivery",money(order.deliveryChargeAmount??0));
    p.bold(true).size("tall").row("TOTAL",money(order.grandTotal)).size("normal").bold(false);
    p.row("Paid",money(order.paidAmount));
    if(payments.length){for(const row of receivedRows(payments))p.row(row.label,money(row.amount));p.row("Change",money(payments.reduce((sum,payment)=>sum+(payment.changeAmount??0),0)))}
    p.row("Balance",money(order.dueAmount));
    if(showPaymentQr(business,order)&&business.paymentQrUrl){
      p.divider().align("center").bold(true).text(business.paymentQrCaption||PAYMENT_QR_CAPTION).bold(false);
      parts.push({type:"command",base64:p.toBase64()},{type:"logo",url:business.paymentQrUrl,width:paymentQrWidth(paper)});p.reset();
      p.align("left");
    }
    const coupons=order.issuedCoupons??[];
    if(coupons.length){
      p.divider().align("center").bold(true).text("Your coupon for next time").bold(false);
      for(const coupon of coupons){p.bold(true).size("large").text(coupon.code,p.columnsAt("large")).size("normal").bold(false).text(coupon.batchName);p.text(`${coupon.description}${coupon.usage==="NEXT_VISIT"?" - use on your next visit":""}${coupon.expiresOn?` - valid until ${formatDate(coupon.expiresOn)}`:""}`)}
      p.align("left");
    }
    p.feed(1).align("center").barcode(order.orderNumber).text(business.receiptFooter||"Thank you!");
    if(extras.readyMessage)p.bold(true).text(extras.readyMessage).bold(false);
    footer(p);
  }else{
    // Item names can also print in Sindhi or Urdu; a name with no translation yet prints in English.
    const names=nameViewOf(kitchenLanguage(business.kitchenReceiptLanguage)),translations=extras.translations??{};
    const split=Boolean(business.kitchenTicketPerCategory)&&order.items.length>0,tickets=split?kitchenTickets(order.items):[{category:"",items:order.items}];
    tickets.forEach((ticket,index)=>{
      // Order number and kitchen counter print white on black, so the cook spots them at a glance.
      p.align("center").bold(true).size("tall").text(business.name).size("normal").text("KITCHEN ORDER").bold(false);
      p.band(order.orderNumber);
      if(split){p.feed(1).band(ticket.category.toUpperCase());if(tickets.length>1)p.align("center").bold(true).text(`Ticket ${index+1} of ${tickets.length}`).bold(false)}
      p.align("center").barcode(order.orderNumber).align("left").divider();
      // Table and waiter tell the counter where the dish goes, so they print tall.
      if(order.tableNameSnapshot)p.bold(true).size("tall").row("Table",order.tableNameSnapshot).size("normal").bold(false);
      if(order.waiterNameSnapshot)p.bold(true).size("tall").row("Waiter",order.waiterNameSnapshot).size("normal").bold(false);
      if(order.saleDate)meta("Sale date",formatDate(order.saleDate));
      meta("Created",formatDateTime(order.createdAt));meta("Type",order.orderType.replace("_","-"));
      if(order.orderSource==="QR")meta("Source","QR code order");
      p.divider();
      // Same item table as the customer receipt; the cook reads item names and notes in bold.
      const items=ticket.items.map(line=>({name:line.nameSnapshot,unitPrice:line.unitPrice,quantity:line.quantity,notes:line.notes,components:(line.dealItemsSnapshot??[]).map(item=>`${item.name} - Qty ${item.quantity}`),
        ...(names==="EN"?{}:{local:localName(line.nameSnapshot,translations),localComponents:(line.dealItemsSnapshot??[]).map(item=>{const local=localName(item.name,translations);return local?`${local} × ${item.quantity}`:undefined})})}));
      for(const row of receiptItemRows(items,p.columnsAt("normal"),money,{prices:Boolean(business.showPricesOnKitchenReceipt),names})){p.bold(row.kind!=="detail");if(row.rtl)p.local(row.text);else p.line(row.text);p.bold(false)}
      // The order note applies to the whole order, so every counter gets it.
      if(order.notes)p.divider().bold(true).text("ORDER NOTE").bold(false).text(order.notes);
      footer(p);
    });
  }
  parts.push({type:"command",base64:p.toBase64()});
  return parts;
}

// Slip for a QR guest order that is not approved yet: the waiter takes it to the table and checks it with the guest.
export type QrSlip={tableName:string;guestName:string;guestPhone:string;createdAt:Date|string;lines:{name:string;quantity:number;note?:string;unitPrice?:number}[];grandTotal?:number|null};
export function renderQrSlip(business:ReceiptBusiness,slip:QrSlip,prices:boolean):PrintPart[]{
  const paper=paperWidth(business),style=receiptStyle(business,"kitchen"),p=new EscPos(columnsFor(paper,style.font),style);
  p.align("center").bold(true).text("QR ORDER - PLEASE CONFIRM").size("large").text(slip.tableName,p.columnsAt("large")).size("normal").bold(false).text("Not sent to the kitchen yet").align("left").divider();
  p.row("Guest",slip.guestName||"Guest");p.row("Mobile",slip.guestPhone||"-");p.row("Ordered",formatDateTime(slip.createdAt));
  p.divider();
  const items=slip.lines.map(line=>({name:line.name,unitPrice:line.unitPrice??0,quantity:line.quantity,notes:line.note}));
  for(const row of receiptItemRows(items,p.columnsAt("normal"),money,{prices}))p.bold(row.kind!=="detail").line(row.text).bold(false);
  if(prices&&slip.grandTotal!=null)p.divider().bold(true).row("Estimated total",money(slip.grandTotal)).bold(false);
  p.divider().feed(1).text("Confirmed with guest: ____________").feed(1).text("Waiter: __________________").feed(1).align("center").text("This is not a bill.");
  footer(p);
  return[{type:"command",base64:p.toBase64()}];
}
