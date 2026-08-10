import { BrowserPrinterAdapter } from "./browser";
import { QzTrayPrinterAdapter } from "./qz-tray";
import type { PrinterAdapter } from "./types";
export function createPrinterAdapter(mode:"BROWSER"|"QZ"):PrinterAdapter{return mode==="QZ"?new QzTrayPrinterAdapter():new BrowserPrinterAdapter()}
