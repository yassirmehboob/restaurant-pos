// Thermal printers only carry their built-in fonts. Any other family is drawn on the counter PC and
// printed as an image (QZ Tray), or used directly by the browser print pages.
export const RECEIPT_FAMILIES=["PRINTER","ARIAL","TAHOMA","VERDANA","SEGOE","CALIBRI","TIMES","COURIER","CONSOLAS"] as const;
export type ReceiptFamily=(typeof RECEIPT_FAMILIES)[number];

export const FAMILY_FONTS:Record<ReceiptFamily,{label:string;css:string}>={
  PRINTER:{label:"Printer font (fastest)",css:`"Courier New",Courier,monospace`},
  ARIAL:{label:"Arial",css:`Arial,"Helvetica Neue",Helvetica,sans-serif`},
  TAHOMA:{label:"Tahoma",css:`Tahoma,Verdana,sans-serif`},
  VERDANA:{label:"Verdana",css:`Verdana,Tahoma,sans-serif`},
  SEGOE:{label:"Segoe UI",css:`"Segoe UI",system-ui,sans-serif`},
  CALIBRI:{label:"Calibri",css:`Calibri,Carlito,sans-serif`},
  TIMES:{label:"Times New Roman",css:`"Times New Roman",Times,serif`},
  COURIER:{label:"Courier New",css:`"Courier New",Courier,monospace`},
  CONSOLAS:{label:"Consolas",css:`Consolas,"Lucida Console",monospace`},
};

// Sindhi and Urdu item names on kitchen tickets. Noto Naskh Arabic ships with the app (@fontsource), so it
// works offline and covers the extra Sindhi letters; system fonts are only a fallback.
export const LOCAL_FONT_CSS=`"Noto Naskh Arabic","Segoe UI",Tahoma,sans-serif`;
// Web fonts load only when text uses them, so a canvas drawing Sindhi or Urdu must ask for them first.
export async function loadLocalFont(){
  try{await Promise.all([document.fonts.load(`400 24px "Noto Naskh Arabic"`,"ڪڙاهي"),document.fonts.load(`700 24px "Noto Naskh Arabic"`,"ڪڙاهي")])}catch{/* Falls back to the system fonts in LOCAL_FONT_CSS. */}
}

export const receiptFamily=(value:unknown):ReceiptFamily=>RECEIPT_FAMILIES.includes(value as ReceiptFamily)?value as ReceiptFamily:"PRINTER";
