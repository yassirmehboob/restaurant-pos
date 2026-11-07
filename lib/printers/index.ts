import { BrowserPrinterAdapter } from "./browser";
import { QzTrayPrinterAdapter,printQzQrSlip } from "./qz-tray";
export { openCashDrawer } from "./qz-tray";
import type { PrinterAdapter } from "./types";
export function createPrinterAdapter(mode:"BROWSER"|"QZ"):PrinterAdapter{return mode==="QZ"?new QzTrayPrinterAdapter():new BrowserPrinterAdapter()}

type PlacedOrder={orderId:string;printKitchen?:boolean;printBill?:boolean;printerMode:"BROWSER"|"QZ"};
// Prints what the server asked for when an order was placed: the kitchen ticket first, then the unpaid bill.
// Returns one message per print that failed, so the caller can tell the cashier.
export async function printPlacedOrder(order:PlacedOrder){
  const adapter=createPrinterAdapter(order.printerMode),failures:{title:string;text:string}[]=[];
  if(order.printKitchen){const result=await adapter.printKitchenReceipt(order.orderId);if(!result.ok)failures.push({title:"Kitchen ticket was NOT printed",text:result.message})}
  if(order.printBill){const result=await adapter.printCustomerReceipt(order.orderId);if(!result.ok)failures.push({title:"Unpaid bill was NOT printed",text:result.message})}
  return failures;
}

// Slip for a QR guest order before approval: a popup page in browser mode, the counter printer with QZ Tray.
export async function printQrSlip(requestId:string,mode:"BROWSER"|"QZ"){
  if(mode==="QZ")return printQzQrSlip(requestId);
  const popup=window.open(`/print/qr-request/${requestId}`,`qr-slip-${requestId}`,"popup,width=520,height=760");
  return popup?{ok:true,confirmed:false,message:"Print dialog opened."}:{ok:false,confirmed:false,message:"The browser blocked the print window. Allow popups and try again."};
}
