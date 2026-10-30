import "server-only";
import { formatDate,formatDateTime } from "@/lib/dates";
import { EscPos,columnsFor,type PaperWidth } from "@/lib/escpos";
import type { PrinterTarget } from "@/lib/printer-target";
import { readyTimeMessage } from "@/lib/preparation-time";
import { receiptPreparationMinutes } from "@/lib/receipt-preparation";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";

export type ReceiptKind="customer"|"kitchen";
// "logo" marks where the client inserts the logo image; QZ Tray rasterises it between the command parts.
export type PrintPart={type:"command";base64:string}|{type:"logo";url:string};
export type PrintJob={kind:ReceiptKind;role:ReceiptKind;printer:PrinterTarget;copies:number;parts:PrintPart[]};
type Line={lineId:string;quantity:number;nameSnapshot:string;unitPrice:number;lineTotal:number;notes?:string;dealItemsSnapshot?:{name:string;quantity:number}[]};

const money=(value:number)=>(value??0).toLocaleString("en-PK",{minimumFractionDigits:2,maximumFractionDigits:2});
const target=(business:Record<string,unknown>,role:ReceiptKind):PrinterTarget=>({connection:business[`${role}PrinterConnection`]==="LAN"?"LAN":"USB",name:String(business[`${role}PrinterName`]??""),host:String(business[`${role}PrinterHost`]??""),port:Number(business[`${role}PrinterPort`]??9100)||9100});

export async function buildPrintJob(businessId:string,orderId:string,kind:ReceiptKind):Promise<PrintJob|{error:string}>{
  if(!/^[a-f\d]{24}$/i.test(orderId))return{error:"Order not found."};
  const[order,business]=await Promise.all([Order.findOne({_id:orderId,businessId}).lean(),Business.findOne({_id:businessId,isActive:true}).lean()]);
  if(!order||!business)return{error:"Order not found."};
  if(kind==="customer"&&business.customerPrintingEnabled===false)return{error:"Customer printing is turned off in Printing settings."};
  if(kind==="kitchen"&&business.kitchenPrintingEnabled===false)return{error:"Kitchen printing is turned off in Printing settings."};
  const paper:PaperWidth=business.receiptPaperWidth==="58"?"58":"80",p=new EscPos(columnsFor(paper)),parts:PrintPart[]=[];
  const meta=(label:string,value:string)=>p.row(label,value);
  if(kind==="customer"){
    const payments=await Payment.find({orderId,businessId}).select("amount tenderedAmount changeAmount").lean();
    const readyMessage=readyTimeMessage(Boolean(business.showOrderReadyTime),business.showOrderReadyTime?await receiptPreparationMinutes(businessId,order):null);
    p.align("center");
    if(business.showLogoOnCustomerReceipt!==false&&business.logoUrl){parts.push({type:"command",base64:p.toBase64()},{type:"logo",url:business.logoUrl});p.reset()}
    p.align("center").bold(true).size("tall").text(business.name).size("normal").bold(false);
    for(const line of [business.receiptHeader,business.address,business.phone,business.taxNumber?`Tax #: ${business.taxNumber}`:""])if(line)p.text(line);
    p.align("left").divider();
    meta("Receipt",order.orderNumber);meta("Date",formatDateTime(order.createdAt));
    if(order.saleDate)meta("Sale date",formatDate(order.saleDate));
    meta("Type",order.orderType.replace("_","-"));
    if(order.tableNameSnapshot)meta("Table",order.tableNameSnapshot);
    if(order.waiterNameSnapshot)meta("Waiter",order.waiterNameSnapshot);
    if(order.customerSnapshot?.name)meta("Customer",order.customerSnapshot.name);
    if(order.orderType==="DELIVERY"){p.text("Address: "+(order.customerSnapshot?.address||"Not provided"));p.text("Area: "+(order.customerSnapshot?.area||"Not provided"))}
    meta("Payment",order.paymentStatus);
    p.divider();
    // With a discount, lines show their full price so they add up to the subtotal above the coupon line.
    const discounted=(order.discountAmount??0)>0;
    for(const line of order.items as Line[]){
      p.row(`${line.quantity}x ${line.nameSnapshot}`,money(discounted?line.unitPrice*line.quantity:line.lineTotal));
      p.text(`   @ ${money(line.unitPrice)}${line.notes?` - ${line.notes}`:""}`);
    }
    p.divider();
    p.row("Subtotal",money(order.subtotal));
    if(discounted)p.row(`Coupon${order.couponCode?` ${order.couponCode}`:""}`,"-"+money(order.discountAmount));
    if(order.taxAmount>0)p.row(`Tax${order.taxRateSnapshot!==undefined?` (${order.taxRateSnapshot}%)`:""}`,money(order.taxAmount));
    if(order.deliveryChargeAmount>0)p.row("Delivery",money(order.deliveryChargeAmount));
    p.bold(true).size("tall").row("TOTAL",money(order.grandTotal)).size("normal").bold(false);
    p.row("Paid",money(order.paidAmount));
    if(payments.length){p.row("Received",money(payments.reduce((sum,payment)=>sum+(payment.tenderedAmount??payment.amount),0)));p.row("Change",money(payments.reduce((sum,payment)=>sum+(payment.changeAmount??0),0)))}
    p.row("Balance",money(order.dueAmount));
    const coupons=(order.issuedCoupons??[]) as {code:string;batchName:string;description:string;expiresOn?:string;usage?:string}[];
    if(coupons.length){
      p.divider().align("center").bold(true).text("Your coupon for next time").bold(false);
      for(const coupon of coupons){p.bold(true).size("large").text(coupon.code,p.columnsAt("large")).size("normal").bold(false).text(coupon.batchName);p.text(`${coupon.description}${coupon.usage==="NEXT_VISIT"?" - use on your next visit":""}${coupon.expiresOn?` - valid until ${formatDate(coupon.expiresOn)}`:""}`)}
      p.align("left");
    }
    p.feed(1).align("center").barcode(order.orderNumber).text(business.receiptFooter||"Thank you!");
    if(readyMessage)p.bold(true).text(readyMessage).bold(false);
  }else{
    p.align("center").bold(true).text("KITCHEN ORDER").size("large").text(order.orderNumber,p.columnsAt("large")).size("normal").bold(false);
    p.barcode(order.orderNumber).align("left").divider();
    if(order.saleDate)meta("Sale date",formatDate(order.saleDate));
    meta("Created",formatDateTime(order.createdAt));meta("Type",order.orderType.replace("_","-"));
    if(order.tableNameSnapshot)meta("Table",order.tableNameSnapshot);
    if(order.waiterNameSnapshot)meta("Waiter",order.waiterNameSnapshot);
    p.divider();
    for(const line of order.items as Line[]){
      p.size("tall").bold(true);
      if(business.showPricesOnKitchenReceipt)p.row(`${line.quantity}x ${line.nameSnapshot}`,money(line.lineTotal));else p.text(`${line.quantity}x ${line.nameSnapshot}`);
      p.size("normal").bold(false);
      for(const item of line.dealItemsSnapshot??[])p.text(`  > ${item.quantity}x ${item.name}`);
      if(line.notes)p.bold(true).text(`  NOTE: ${line.notes}`).bold(false);
    }
    if(order.notes)p.divider().bold(true).text("ORDER NOTE").bold(false).text(order.notes);
  }
  p.feed(1).align("center").text("Software developed by: Cubedevsys.com").text("Contact 03113809764").cut();
  parts.push({type:"command",base64:p.toBase64()});
  // One-printer mode sends kitchen tickets to the customer printer.
  const role:ReceiptKind=kind==="kitchen"&&business.onePrinterMode===false?"kitchen":"customer";
  const copies=Math.min(5,Math.max(1,Number(kind==="kitchen"?business.kitchenReceiptCopies:business.customerReceiptCopies)||1));
  return{kind,role,printer:target(business as unknown as Record<string,unknown>,role),copies,parts};
}
