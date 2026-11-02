import { wrap } from "@/lib/escpos";

export type ReceiptItem={name:string;unitPrice:number;quantity:number;notes?:string;components?:string[]};
// "item" rows carry the item name, "detail" rows a deal component, "note" rows the line note.
type Row={text:string;bold?:boolean;kind:"head"|"item"|"detail"|"note"};

// Thermal item table: # | Item | Price | Qty | Amount (or # | Item | Qty without prices, for kitchen tickets). On 80 mm paper the item name wraps inside its column;
// 58 mm paper is too narrow for that, so the name takes its own line and the figures go on the line below it.
// Qty and Amount columns are wider than their values so the figures keep a clear gap between them.
const NO=3,PRICE=9,QTY=5,AMOUNT=11;
export function receiptItemRows(items:ReceiptItem[],columns:number,money:(value:number)=>string,{prices=true}:{prices?:boolean}={}):Row[]{
  // Price follows a space already, so it may fill its column; Qty and Amount always keep a space before them so figures never run together.
  const pad=(value:string,width:number,gap=1)=>value.length+gap<=width?value.padStart(width):" ".repeat(gap)+value;
  const figures=(price:string,qty:string,amount:string)=>prices?pad(price,PRICE,0)+pad(qty,QTY)+pad(amount,AMOUNT):pad(qty,QTY);
  const itemWidth=columns-NO-1-figures("","","").length,stacked=itemWidth<12,rows:Row[]=[];
  const name=(item:ReceiptItem,no:string)=>wrap(item.name,columns-NO).forEach((part,line)=>rows.push({text:(line?"".padEnd(NO):no)+part,kind:"item"}));
  if(stacked)rows.push({text:"#".padEnd(NO)+"Item",bold:true,kind:"head"},{text:figures("Price","Qty","Amount").padStart(columns),bold:true,kind:"head"});
  else rows.push({text:"#".padEnd(NO)+"Item".padEnd(itemWidth)+" "+figures("Price","Qty","Amount"),bold:true,kind:"head"});
  items.forEach((item,index)=>{
    const no=String(index+1).padEnd(NO),numbers=figures(money(item.unitPrice),String(item.quantity),money(item.unitPrice*item.quantity));
    if(stacked){name(item,no);rows.push({text:numbers.padStart(columns),kind:"item"})}
    // Figures too wide for the table (very large amounts) drop to their own line rather than being cut off.
    else if(NO+itemWidth+1+numbers.length>columns){name(item,no);rows.push({text:numbers.trimStart().padStart(columns),kind:"item"})}
    else wrap(item.name,itemWidth).forEach((part,line)=>rows.push({text:line?"".padEnd(NO)+part:no+part.padEnd(itemWidth)+" "+numbers,kind:"item"}));
    for(const component of item.components??[])for(const part of wrap(`> ${component}`,columns-NO))rows.push({text:"".padEnd(NO)+part,kind:"detail"});
    if(item.notes)for(const part of wrap(`Note: ${item.notes}`,columns-NO))rows.push({text:"".padEnd(NO)+part,kind:"note"});
  });
  return rows;
}

const METHOD_LABELS:Record<string,string>={CASH:"Cash",CARD:"Card",BANK:"Bank",OTHER:"Other"};
// One "Received - <method>" row per payment method, in the order they were first used; split payments list each method.
export function receivedRows(payments:{method?:string;amount:number;tenderedAmount?:number|null}[]){
  const totals=new Map<string,number>();
  for(const payment of payments){const label=`Received - ${METHOD_LABELS[payment.method??""]??"Other"}`;totals.set(label,(totals.get(label)??0)+(payment.tenderedAmount??payment.amount))}
  return [...totals].map(([label,amount])=>({label,amount}));
}
