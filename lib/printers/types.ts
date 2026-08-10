export type ReceiptKind="customer"|"kitchen";
export type PrintResult={ok:boolean;confirmed:boolean;message:string};
export interface PrinterAdapter{listPrinters():Promise<string[]>;printCustomerReceipt(orderId:string):Promise<PrintResult>;printKitchenReceipt(orderId:string):Promise<PrintResult>}
