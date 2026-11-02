"use client";
import { useMemo,useSyncExternalStore } from "react";
import { columnsFor } from "@/lib/escpos";
import { readyTimeMessage } from "@/lib/preparation-time";
import type { ReceiptFamily } from "@/lib/receipt-fonts";
import { paperWidth,renderReceipt,type ReceiptBusiness,type ReceiptKind,type ReceiptOrder } from "@/lib/receipt-layout";
import { decodeEscPos,rasterBlocks,type ReceiptRow } from "@/lib/receipt-raster";
import "./receipt-preview.css";

type Row=ReceiptRow|{kind:"logo";url:string};
type Shown=Row|{kind:"image";src:string};
const noop=()=>()=>{};

const SAMPLE_ORDER:ReceiptOrder={
  orderNumber:"ORD-1024",createdAt:"2026-11-02T08:45:00.000Z",saleDate:"2026-11-02",orderType:"DINE_IN",tableNameSnapshot:"Table 4",waiterNameSnapshot:"Ahmed",
  customerSnapshot:{name:"Walk-in customer"},paymentStatus:"PAID",notes:"Less spicy please",
  items:[
    {quantity:1,nameSnapshot:"Chicken Karahi (Full)",unitPrice:1800},
    {quantity:4,nameSnapshot:"Garlic Naan",unitPrice:60,notes:"Extra butter"},
    {quantity:1,nameSnapshot:"Family Deal",unitPrice:2499,dealItemsSnapshot:[{name:"Zinger Burger",quantity:2},{name:"Fries",quantity:1},{name:"Soft drink 1.5L",quantity:1}]},
  ],
  subtotal:4539,taxAmount:726.24,taxRateSnapshot:16,grandTotal:5265.24,paidAmount:5265.24,dueAmount:0,
};
const SAMPLE_PAYMENTS=[{method:"CASH",amount:5265.24,tenderedAmount:5300,changeAmount:34.76}];

// Code 128-looking bars derived from the value; only the size and position need to be faithful.
function Barcode({value}:{value:string}){
  const bars=[...value].flatMap(char=>[...char.charCodeAt(0).toString(2).padStart(8,"0")].map(bit=>bit==="1"?2:1));
  let x=0;const rects=bars.map((width,index)=>{const rect=index%2?null:<rect key={index} x={x} width={width} height="40"/>;x+=width;return rect});
  return <div className="receipt-preview-barcode"><svg viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" aria-hidden="true">{rects}</svg><span>{value}</span></div>;
}

export function ReceiptPreview({kind,family,business,readyTime,off}:{kind:ReceiptKind;family:ReceiptFamily;business:ReceiptBusiness;readyTime:boolean;off?:boolean}){
  // Desktop fonts are drawn on a canvas, which only exists in the browser.
  const browser=useSyncExternalStore(noop,()=>true,()=>false);
  const rows=useMemo(()=>{
    const rows:Row[]=[];
    for(const part of renderReceipt(kind,business,SAMPLE_ORDER,{payments:SAMPLE_PAYMENTS,cashier:"Counter 1",readyMessage:readyTimeMessage(readyTime,25)})){
      if(part.type==="logo")rows.push({kind:"logo",url:part.url});else rows.push(...decodeEscPos(part.base64));
    }
    return rows;
  },[kind,business,readyTime]);
  const paper=paperWidth(business),columns=columnsFor(paper);
  // Other families render exactly as QZ Tray prints them: text rows become the same images.
  const shown=useMemo<Shown[]>(()=>{
    if(family==="PRINTER"||!browser)return rows;
    const shown:Shown[]=[];let text:ReceiptRow[]=[];
    const flush=()=>{for(const block of rasterBlocks(text,paper,family))shown.push(block.kind==="image"?{kind:"image",src:block.canvas.toDataURL("image/png")}:block);text=[]};
    for(const row of rows){if(row.kind==="logo"){flush();shown.push(row)}else text.push(row)}
    flush();
    return shown;
  },[rows,family,paper,browser]);
  return <div className={`receipt-preview${off?" is-off":""}`}>
    <div className="receipt-preview-paper" style={{width:`calc(${columns}ch + 28px)`}} aria-label={`${kind==="customer"?"Customer receipt":"Kitchen ticket"} preview`} role="img">
      {shown.map((row,index)=>{
        // Business logo from uploads and canvas snapshots, shown at printer size.
        // eslint-disable-next-line @next/next/no-img-element
        if(row.kind==="logo"||row.kind==="image")return <img key={index} className={row.kind==="logo"?"receipt-preview-logo":"receipt-preview-raster"} src={row.kind==="logo"?row.url:row.src} alt=""/>;
        if(row.kind==="barcode")return <Barcode key={index} value={row.value}/>;
        if(row.kind==="cut")return <div key={index} className="receipt-preview-cut" aria-hidden="true"/>;
        const {align,bold,size,font}=row.style,wide=(size&0x10)!==0,tall=!wide&&(size&0x01)!==0;
        return <div key={index} className={`receipt-preview-line${tall?" is-tall":""}`} style={{textAlign:align===1?"center":align===2?"right":"left",fontWeight:bold?800:400}}><span style={{fontSize:`${(font===1?.75:1)*(wide?2:1)}em`}}>{row.text||" "}</span></div>;
      })}
    </div>
  </div>;
}
