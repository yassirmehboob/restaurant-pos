import { requirePagePermission } from "@/data/auth";
import { MasterHeader } from "@/components/master-shell";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { PrinterStationSettings } from "@/components/printer-station-settings";
import { PrintingSettingsForm } from "@/components/printing-settings-form";
import { businessPrinter } from "@/lib/printer-target";
export default async function PrintingSettingsPage(){const user=await requirePagePermission("settings");await connectToDatabase();const business=await Business.findOne({_id:user.businessId,isActive:true}).lean();if(!business)return null;const customer=businessPrinter(business,"customer"),kitchen=businessPrinter(business,"kitchen"),paper=business.receiptPaperWidth==="58"?"58":"80",printerMode=business.printerMode==="QZ"?"QZ":"BROWSER";
 const values={receiptPaperWidth:paper,printerMode,onePrinterMode:business.onePrinterMode!==false,receiptHeader:business.receiptHeader??"",receiptFooter:business.receiptFooter??"Thank you!",showLogoOnCustomerReceipt:business.showLogoOnCustomerReceipt!==false,showOrderReadyTime:Boolean(business.showOrderReadyTime),showPricesOnKitchenReceipt:Boolean(business.showPricesOnKitchenReceipt),customerPrintingEnabled:business.customerPrintingEnabled!==false,kitchenPrintingEnabled:business.kitchenPrintingEnabled!==false,autoPrintCustomerOnPayment:Boolean(business.autoPrintCustomerOnPayment),customerReceiptCopies:business.customerReceiptCopies??1,kitchenReceiptCopies:business.kitchenReceiptCopies??1,customer,kitchen} as const;
 return <main className="master-page printing-settings-page"><MasterHeader eyebrow="Receipts & routing" title="Printing" description="Set up the customer receipt and the kitchen ticket separately."/><PrintingSettingsForm values={values}/>{printerMode==="QZ"&&<PrinterStationSettings customer={customer} kitchen={kitchen} onePrinter={business.onePrinterMode!==false} paper={paper}/>}</main>}
