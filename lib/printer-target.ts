import { z } from "zod";

// USB = a printer installed in Windows on the PC running QZ Tray (or a shared \\PC\Printer).
// LAN = an Ethernet printer reached directly on its raw port, no Windows driver needed.
export const PRINTER_CONNECTIONS=["USB","LAN"] as const;
export type PrinterConnection=(typeof PRINTER_CONNECTIONS)[number];
export type PrinterTarget={connection:PrinterConnection;name:string;host:string;port:number};

const ipv4=/^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/,hostname=/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)*$/i;
// Anything made only of digits and dots must be a real IPv4 address (192.168.1.300 is rejected).
const validHost=(host:string)=>/^[\d.]+$/.test(host)?ipv4.test(host):hostname.test(host);
export const printerTargetSchema=z.object({
  connection:z.enum(PRINTER_CONNECTIONS),
  name:z.string().trim().max(150).default(""),
  host:z.string().trim().max(253).default(""),
  port:z.coerce.number().int().min(1,"Port must be 1-65535").max(65535,"Port must be 1-65535").default(9100),
}).superRefine((value,ctx)=>{
  if(value.connection==="LAN"&&!validHost(value.host))ctx.addIssue({code:"custom",path:["host"],message:"Enter the printer's IP address, for example 192.168.1.50"});
});

type StoredPrinters={[key in `${"customer"|"kitchen"}Printer${"Connection"|"Name"|"Host"}`]?:string|null}&{customerPrinterPort?:number|null;kitchenPrinterPort?:number|null};
export function businessPrinter(business:StoredPrinters,role:"customer"|"kitchen"):PrinterTarget{
  return{connection:business[`${role}PrinterConnection`]==="LAN"?"LAN":"USB",name:business[`${role}PrinterName`]??"",host:business[`${role}PrinterHost`]??"",port:business[`${role}PrinterPort`]??9100};
}

export function describePrinter(target:PrinterTarget){
  return target.connection==="LAN"?`LAN ${target.host||"(no IP)"}:${target.port}`:`USB ${target.name||"Windows default printer"}`;
}

// One-printer mode: the counter printer also prints the kitchen ticket whenever an order goes to the kitchen.
export function counterPrintsKitchen(business:{onePrinterMode?:boolean|null;kitchenPrintingEnabled?:boolean|null}|null|undefined){
  return Boolean(business&&business.onePrinterMode!==false&&business.kitchenPrintingEnabled!==false);
}

// Optional: the counter also prints the customer bill, unpaid, as soon as a dine-in order is placed.
export function autoPrintsUnpaidBill(business:{autoPrintUnpaidDineIn?:boolean|null;customerPrintingEnabled?:boolean|null}|null|undefined){
  return Boolean(business?.autoPrintUnpaidDineIn&&business.customerPrintingEnabled!==false);
}
