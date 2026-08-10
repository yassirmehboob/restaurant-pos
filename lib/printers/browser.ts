import type { PrinterAdapter,PrintResult,ReceiptKind } from "./types";
export class BrowserPrinterAdapter implements PrinterAdapter{
  async listPrinters(){return[]}
  private open(orderId:string,kind:ReceiptKind):PrintResult{const popup=window.open(`/print/order/${orderId}/${kind}`,`receipt-${kind}-${orderId}`,"popup,width=520,height=760");return popup?{ok:true,confirmed:false,message:"Print dialog opened. Browser printing cannot confirm paper output."}:{ok:false,confirmed:false,message:"The browser blocked the print window. Allow popups and try again."}}
  async printCustomerReceipt(orderId:string){return this.open(orderId,"customer")}
  async printKitchenReceipt(orderId:string){return this.open(orderId,"kitchen")}
}
