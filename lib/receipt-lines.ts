import { wrap } from "@/lib/escpos";

export type ReceiptItem={name:string;unitPrice:number;quantity:number;notes?:string;components?:string[]};
// "item" rows carry the item name, "detail" rows a deal component, "note" rows the line note.
type Row={text:string;bold?:boolean;kind:"head"|"item"|"detail"|"note"};

// Thermal item table. With prices, each item prints its name across the full row, so long names fit on one line, with # | Price | Qty | Amount on the row below.
// Without prices (kitchen tickets) there is room for # | Item | Qty on one row, which keeps the quantity beside the name for the cook.
// Qty and Amount columns are wider than their values so the figures keep a clear gap between them.
const NO=3,PRICE=9,QTY=5,AMOUNT=11;
export function receiptItemRows(items:ReceiptItem[],columns:number,money:(value:number)=>string,{prices=true}:{prices?:boolean}={}):Row[]{
  // Price follows a space already, so it may fill its column; Qty and Amount always keep a space before them so figures never run together.
  const pad=(value:string,width:number,gap=1)=>value.length+gap<=width?value.padStart(width):" ".repeat(gap)+value;
  const figures=(price:string,qty:string,amount:string)=>prices?pad(price,PRICE,0)+pad(qty,QTY)+pad(amount,AMOUNT):pad(qty,QTY);
  const itemWidth=columns-NO-1-figures("","","").length,stacked=prices||itemWidth<12,rows:Row[]=[];
  // # on the left, figures on the right. Figures too wide for the columns (very large amounts, large print) close up and wrap rather than being cut off.
  const numberRow=(no:string,price:string,qty:string,amount:string)=>{
    const numbers=figures(price,qty,amount);
    return no.length+numbers.length<=columns?[no+numbers.padStart(columns-no.length)]:wrap([no,...(prices?[price,qty,amount]:[qty])].join(" "),columns);
  };
  if(stacked)rows.push({text:"Item",bold:true,kind:"head"},...numberRow("#".padEnd(NO),"Price","Qty","Amount").map(text=>({text,bold:true,kind:"head" as const})));
  else rows.push({text:"#".padEnd(NO)+"Item".padEnd(itemWidth)+" "+figures("Price","Qty","Amount"),bold:true,kind:"head"});
  items.forEach((item,index)=>{
    const no=String(index+1).padEnd(NO),price=money(item.unitPrice),qty=String(item.quantity),amount=money(item.unitPrice*item.quantity),numbers=figures(price,qty,amount);
    if(stacked||NO+itemWidth+1+numbers.length>columns){
      for(const text of wrap(item.name,columns))rows.push({text,kind:"item"});
      for(const text of numberRow(no,price,qty,amount))rows.push({text,kind:"item"});
    }
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
