import "server-only";
import type { PrinterTarget } from "@/lib/printer-target";
import type { PaperWidth } from "@/lib/escpos";
import type { ReceiptFamily } from "@/lib/receipt-fonts";
import { familyFor,paperWidth,renderQrSlip,renderReceipt,type PrintPart,type QrSlip,type ReceiptBusiness,type ReceiptExtras,type ReceiptKind,type ReceiptOrder } from "@/lib/receipt-layout";
import { readyTimeMessage } from "@/lib/preparation-time";
import { receiptPreparationMinutes } from "@/lib/receipt-preparation";
import { orderCashierName } from "@/lib/order-cashier";
import { Business } from "@/models/Business";
import { Order } from "@/models/Order";
import { Payment } from "@/models/Payment";
import { WaiterRequest } from "@/models/WaiterRequest";
import { kitchenTranslations } from "@/lib/menu-translations";
import { LOCAL_TEXT } from "@/lib/escpos";
import { withKitchenCategories } from "@/lib/kitchen-categories";

export type { PrintPart,ReceiptKind };
// True when a part carries Sindhi or Urdu text (ESC ~, see EscPos.local).
const hasLocalText=(parts:PrintPart[])=>parts.some(part=>part.type==="command"&&Buffer.from(part.base64,"base64").includes(Buffer.from([0x1b,LOCAL_TEXT])));
export type PrintJob={kind:ReceiptKind;role:ReceiptKind;printer:PrinterTarget;copies:number;paper:PaperWidth;family:ReceiptFamily;parts:PrintPart[]};

const target=(business:Record<string,unknown>,role:ReceiptKind):PrinterTarget=>({connection:business[`${role}PrinterConnection`]==="LAN"?"LAN":"USB",name:String(business[`${role}PrinterName`]??""),host:String(business[`${role}PrinterHost`]??""),port:Number(business[`${role}PrinterPort`]??9100)||9100});

async function customerExtras(businessId:string,order:{_id:unknown}&Parameters<typeof orderCashierName>[0]&Parameters<typeof receiptPreparationMinutes>[1],business:{showOrderReadyTime?:boolean|null}):Promise<ReceiptExtras>{
  const[payments,cashier]=await Promise.all([Payment.find({orderId:order._id,businessId,reversal:null}).select("method amount tenderedAmount changeAmount").sort({paidAt:1}).lean(),orderCashierName(order)]);
  const readyMessage=readyTimeMessage(Boolean(business.showOrderReadyTime),business.showOrderReadyTime?await receiptPreparationMinutes(businessId,order):null);
  return{payments,cashier,readyMessage};
}

export async function buildPrintJob(businessId:string,orderId:string,kind:ReceiptKind):Promise<PrintJob|{error:string}>{
  if(!/^[a-f\d]{24}$/i.test(orderId))return{error:"Order not found."};
  const[order,business]=await Promise.all([Order.findOne({_id:orderId,businessId}).lean(),Business.findOne({_id:businessId,isActive:true}).lean()]);
  if(!order||!business)return{error:"Order not found."};
  if(kind==="customer"&&business.customerPrintingEnabled===false)return{error:"Customer printing is turned off in Printing settings."};
  if(kind==="kitchen"&&business.kitchenPrintingEnabled===false)return{error:"Kitchen printing is turned off in Printing settings."};
  const extras=kind==="customer"?await customerExtras(businessId,order,business):{translations:await kitchenTranslations(businessId,order,business)};
  // A ticket per category needs each item's category; orders do not store it.
  const printed=kind==="kitchen"&&business.kitchenTicketPerCategory?{...order,items:await withKitchenCategories(businessId,order.items)}:order;
  const settings=business as unknown as ReceiptBusiness,parts=renderReceipt(kind,settings,printed as unknown as ReceiptOrder,extras);
  // Sindhi and Urdu can only be drawn as an image, so a ticket carrying them never prints in the raw printer font.
  const family=familyFor(settings,kind)==="PRINTER"&&hasLocalText(parts)?"TAHOMA":familyFor(settings,kind);
  // One-printer mode sends kitchen tickets to the customer printer.
  const role:ReceiptKind=kind==="kitchen"&&business.onePrinterMode===false?"kitchen":"customer";
  // An unpaid dine-in bill has its own copy count (often one for the table and one for the waiter).
  const unpaidDineIn=kind==="customer"&&order.orderType==="DINE_IN"&&order.paymentStatus!=="PAID";
  const copies=Math.min(5,Math.max(1,Number(kind==="kitchen"?business.kitchenReceiptCopies:unpaidDineIn?business.unpaidDineInReceiptCopies:business.customerReceiptCopies)||1));
  return{kind,role,printer:target(business as unknown as Record<string,unknown>,role),copies,paper:paperWidth(settings),family,parts};
}

// QR guest order slip, printed on the customer (counter) printer before the order is approved.
export async function buildQrSlipJob(businessId:string,requestId:string):Promise<PrintJob|{error:string}>{
  const slip=await loadQrSlip(businessId,requestId);
  if(!slip)return{error:"This QR order is no longer waiting for approval."};
  const{business,data}=slip;
  if(business.customerPrintingEnabled===false)return{error:"Customer printing is turned off in Printing settings."};
  const settings=business as unknown as ReceiptBusiness;
  return{kind:"customer",role:"customer",printer:target(business as unknown as Record<string,unknown>,"customer"),copies:1,paper:paperWidth(settings),family:familyFor(settings,"kitchen"),parts:renderQrSlip(settings,data,business.qrShowBillSummary!==false)};
}
export async function loadQrSlip(businessId:string,requestId:string){
  if(!/^[a-f\d]{24}$/i.test(requestId))return null;
  const[request,business]=await Promise.all([WaiterRequest.findOne({_id:requestId,businessId,source:"QR",status:"PENDING"}).lean(),Business.findOne({_id:businessId,isActive:true}).lean()]);
  if(!request||!business)return null;
  const data:QrSlip={tableName:String(request.tableName??"Table"),guestName:String(request.guest?.name??""),guestPhone:String(request.guest?.phone??""),createdAt:request.createdAt,lines:request.displayLines,grandTotal:request.summary?.grandTotal};
  return{business,data};
}
