import { businessPrinter,type PrinterTarget } from "@/lib/printer-target";

// The cash drawer plugs into the receipt printer's drawer port (RJ11/RJ12, often marked "DK"), and the printer opens it
// when it receives the ESC/POS kick command. This needs QZ Tray: the browser print dialog cannot send printer commands.
export const CASH_DRAWER_OPEN_ON=["NEVER","CASH","ALL"] as const;
export const CASH_DRAWER_PINS=["PIN2","PIN5"] as const;
export type CashDrawerOpenOn=(typeof CASH_DRAWER_OPEN_ON)[number];
export type CashDrawerPin=(typeof CASH_DRAWER_PINS)[number];
export type CashDrawerJob={printer:PrinterTarget;pin:CashDrawerPin};

export const cashDrawerOpenOn=(value:unknown):CashDrawerOpenOn=>CASH_DRAWER_OPEN_ON.includes(value as CashDrawerOpenOn)?value as CashDrawerOpenOn:"NEVER";
export const cashDrawerPin=(value:unknown):CashDrawerPin=>value==="PIN5"?"PIN5":"PIN2";

// ESC p m t1 t2: pulse drawer pin 2 (m=0) or pin 5 (m=1), on for 50 ms (25 x 2 ms) and off for 500 ms (250 x 2 ms).
export const drawerKickBase64=(pin:CashDrawerPin)=>btoa(String.fromCharCode(0x1b,0x70,pin==="PIN5"?1:0,25,250));

type DrawerBusiness=Parameters<typeof businessPrinter>[0]&{printerMode?:string|null;cashDrawerOpenOn?:string|null;cashDrawerPin?:string|null};
// What the counter PC should do after a payment: open the drawer on the customer receipt printer, or nothing.
export function cashDrawerFor(business:DrawerBusiness|null|undefined,method:string):CashDrawerJob|null{
  if(!business||business.printerMode!=="QZ")return null;
  const openOn=cashDrawerOpenOn(business.cashDrawerOpenOn);
  if(openOn==="NEVER"||(openOn==="CASH"&&method!=="CASH"))return null;
  return{printer:businessPrinter(business,"customer"),pin:cashDrawerPin(business.cashDrawerPin)};
}
