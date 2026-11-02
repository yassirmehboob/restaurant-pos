import { formatDate,formatDateTime } from "@/lib/dates";
import { EscPos,columnsFor,RECEIPT_FONTS,RECEIPT_SIZES,type PaperWidth,type ReceiptStyle } from "@/lib/escpos";
import { receiptFamily,type ReceiptFamily } from "@/lib/receipt-fonts";
import { receiptItemRows,receivedRows } from "@/lib/receipt-lines";

// Pure receipt layout: the printer job and the settings preview both render through here, so they always match.
export type ReceiptKind="customer"|"kitchen";
// "logo" marks where the client inserts the logo image; QZ Tray rasterises it between the command parts.
export type PrintPart={type:"command";base64:string}|{type:"logo";url:string};
export type ReceiptBusiness={
  name:string;address?:string|null;phone?:string|null;taxNumber?:string|null;receiptHeader?:string|null;receiptFooter?:string|null;logoUrl?:string|null;
  showLogoOnCustomerReceipt?:boolean|null;showPricesOnKitchenReceipt?:boolean|null;receiptPaperWidth?:string|null;
  customerReceiptFont?:string|null;customerReceiptSize?:string|null;kitchenReceiptFont?:string|null;kitchenReceiptSize?:string|null;
  customerReceiptFamily?:string|null;kitchenReceiptFamily?:string|null;
};
type Line={quantity:number;nameSnapshot:string;unitPrice:number;notes?:string;dealItemsSnapshot?:{name:string;quantity:number}[]};
type IssuedCoupon={code:string;batchName:string;description:string;expiresOn?:string;usage?:string};
export type ReceiptOrder={
  orderNumber:string;createdAt:Date|string;saleDate?:string|null;orderType:string;tableNameSnapshot?:string|null;waiterNameSnapshot?:string|null;
  customerSnapshot?:{name?:string|null;address?:string|null;area?:string|null}|null;paymentStatus:string;items:Line[];notes?:string|null;
  subtotal:number;discountAmount?:number|null;couponCode?:string|null;invoiceDiscount?:{name:string;percent:number;amount:number}|null;
  taxAmount:number;taxRateSnapshot?:number|null;deliveryChargeAmount?:number|null;grandTotal:number;paidAmount:number;dueAmount:number;issuedCoupons?:IssuedCoupon[]|null;
};
export type ReceiptExtras={payments?:{method?:string;amount:number;tenderedAmount?:number|null;changeAmount?:number|null}[];cashier?:string|null;readyMessage?:string|null};

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
    // Lines print before tax and discount so they add up to the subtotal; tax and coupon follow it.
    const invoiceDiscount=(order.invoiceDiscount?.amount??0)>0?order.invoiceDiscount:null,couponDiscount=(order.discountAmount??0)-(invoiceDiscount?.amount??0);
    for(const row of receiptItemRows(order.items.map(line=>({name:line.nameSnapshot,unitPrice:line.unitPrice,quantity:line.quantity,notes:line.notes})),p.columnsAt("normal"),money))p.bold(Boolean(row.bold)).line(row.text).bold(false);
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
    const coupons=order.issuedCoupons??[];
    if(coupons.length){
      p.divider().align("center").bold(true).text("Your coupon for next time").bold(false);
      for(const coupon of coupons){p.bold(true).size("large").text(coupon.code,p.columnsAt("large")).size("normal").bold(false).text(coupon.batchName);p.text(`${coupon.description}${coupon.usage==="NEXT_VISIT"?" - use on your next visit":""}${coupon.expiresOn?` - valid until ${formatDate(coupon.expiresOn)}`:""}`)}
      p.align("left");
    }
    p.feed(1).align("center").barcode(order.orderNumber).text(business.receiptFooter||"Thank you!");
    if(extras.readyMessage)p.bold(true).text(extras.readyMessage).bold(false);
  }else{
    p.align("center").bold(true).text("KITCHEN ORDER").size("large").text(order.orderNumber,p.columnsAt("large")).size("normal").bold(false);
    p.barcode(order.orderNumber).align("left").divider();
    if(order.saleDate)meta("Sale date",formatDate(order.saleDate));
    meta("Created",formatDateTime(order.createdAt));meta("Type",order.orderType.replace("_","-"));
    if(order.tableNameSnapshot)meta("Table",order.tableNameSnapshot);
    if(order.waiterNameSnapshot)meta("Waiter",order.waiterNameSnapshot);
    p.divider();
    // Same item table as the customer receipt; the cook reads item names and notes in bold.
    const items=order.items.map(line=>({name:line.nameSnapshot,unitPrice:line.unitPrice,quantity:line.quantity,notes:line.notes,components:(line.dealItemsSnapshot??[]).map(item=>`${item.quantity}x ${item.name}`)}));
    for(const row of receiptItemRows(items,p.columnsAt("normal"),money,{prices:Boolean(business.showPricesOnKitchenReceipt)}))p.bold(row.kind!=="detail").line(row.text).bold(false);
    if(order.notes)p.divider().bold(true).text("ORDER NOTE").bold(false).text(order.notes);
  }
  p.feed(1).align("center").text("Software developed by: Cubedevsys.com").text("Contact 03113809764").cut();
  parts.push({type:"command",base64:p.toBase64()});
  return parts;
}
