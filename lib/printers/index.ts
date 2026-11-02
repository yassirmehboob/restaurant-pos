import { BrowserPrinterAdapter } from "./browser";
import { QzTrayPrinterAdapter } from "./qz-tray";
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
