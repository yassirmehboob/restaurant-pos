import type { PrinterAdapter,PrintResult } from "./types";
const unavailable:PrintResult={ok:false,confirmed:false,message:"QZ Tray is not connected. Use browser printing or connect the local print bridge."};
export class QzTrayPrinterAdapter implements PrinterAdapter{async listPrinters(){return[]}async printCustomerReceipt(){return unavailable}async printKitchenReceipt(){return unavailable}}
