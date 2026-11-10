import type qzTray from "qz-tray";
import { EscPos,columnsFor,type PaperWidth } from "@/lib/escpos";
import { describePrinter,type PrinterTarget } from "@/lib/printer-target";
import { drawerKickBase64,type CashDrawerPin } from "@/lib/cash-drawer";
import { loadLocalFont,type ReceiptFamily } from "@/lib/receipt-fonts";
import { decodeEscPos,nativeCommand,rasterBlocks } from "@/lib/receipt-raster";
import type { PrinterAdapter,PrintResult,ReceiptKind } from "./types";

type Qz=typeof qzTray;
type PrintPart={type:"command";base64:string}|{type:"logo";url:string;width?:number};
type PrintJob={kind:ReceiptKind;role:ReceiptKind;printer:PrinterTarget;copies:number;paper:PaperWidth;family:ReceiptFamily;parts:PrintPart[];also?:PrintJob[]};
export type StationPrinters=Partial<Record<ReceiptKind,PrinterTarget>>;

// Each counter PC can override the business printers (e.g. its own USB receipt printer).
export const STATION_KEY="restaurant-pos.station-printers";
export function stationPrintersRaw(){try{return localStorage.getItem(STATION_KEY)??""}catch{return""}}
export function parseStationPrinters(raw:string|null):StationPrinters{try{return raw?JSON.parse(raw)??{}:{}}catch{return{}}}
export const readStationPrinters=()=>parseStationPrinters(stationPrintersRaw());
export function saveStationPrinters(value:StationPrinters){try{localStorage.setItem(STATION_KEY,JSON.stringify(value));window.dispatchEvent(new StorageEvent("storage",{key:STATION_KEY}))}catch{/* Falls back to the business printers. */}}

let client:Promise<Qz>|null=null;
function loadQz(){
  client??=import("qz-tray").then(({default:qz})=>{
    qz.security.setCertificatePromise((resolve)=>{fetch("/api/qz/certificate",{cache:"no-store"}).then(response=>response.ok?response.text():"").then(resolve,()=>resolve(""))});
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise(toSign=>(resolve)=>{fetch("/api/qz/sign",{method:"POST",body:toSign,cache:"no-store"}).then(response=>response.ok?response.text():"").then(resolve,()=>resolve(""))});
    return qz;
  }).catch(error=>{client=null;throw error});
  return client;
}
export async function connectQz(){
  const qz=await loadQz();
  if(!qz.websocket.isActive()){
    try{await qz.websocket.connect({retries:2,delay:1})}
    catch{throw new Error("QZ Tray is not running on this computer. Start QZ Tray (or install it from qz.io/download) and try again.")}
  }
  return qz;
}
export async function listQzPrinters(){const found=await (await connectQz()).printers.find();return Array.isArray(found)?found:[found]}

const message=(error:unknown)=>error instanceof Error?error.message:String(error);
// QZ Tray rasterises PNG/JPEG only, so the image is redrawn as a white-backed PNG first.
// A logo shrinks to at most 256 dots; an image with a width (the payment QR code) is scaled to exactly that width,
// and enlarged without smoothing, so the QR modules stay sharp black squares a phone can scan.
async function logoBase64(url:string,width?:number){
  const response=await fetch(url,{cache:"force-cache"});if(!response.ok)return null;
  const bitmap=await createImageBitmap(await response.blob()),scale=width?width/bitmap.width:Math.min(1,256/bitmap.width),canvas=document.createElement("canvas");
  canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const context=canvas.getContext("2d");if(!context)return null;
  context.imageSmoothingEnabled=scale<1;
  context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/png").split(",")[1]??null;
}

const pngBase64=(canvas:HTMLCanvasElement)=>canvas.toDataURL("image/png").split(",")[1]??"";
const image=(data:string):Parameters<Qz["print"]>[1][number]=>({type:"raw",format:"image",flavor:"base64",data,options:{language:"ESCPOS",dotDensity:"double"}});
// Desktop font families: the text is drawn on this PC and printed as images; barcodes and the cut stay printer commands.
async function rasterParts(parts:PrintPart[],paper:PaperWidth,family:ReceiptFamily){
  await loadLocalFont();await document.fonts?.ready;
  const data:Parameters<Qz["print"]>[1]=[{type:"raw",format:"command",flavor:"base64",data:btoa("\x1b@")}];
  for(const part of parts){
    if(part.type==="logo"){const logo=await logoBase64(part.url,part.width).catch(()=>null);if(logo)data.push(image(logo));continue}
    for(const block of rasterBlocks(decodeEscPos(part.base64),paper,family))data.push(block.kind==="image"?image(pngBase64(block.canvas)):{type:"raw",format:"command",flavor:"base64",data:nativeCommand(block)});
  }
  return data;
}

type QzData=Parameters<Qz["print"]>[1];
async function printerOf(qz:Qz,target:PrinterTarget){
  if(target.connection==="LAN"&&!target.host)throw new Error("Enter the LAN printer's IP address in Printing settings.");
  const printer=target.connection==="LAN"?{host:target.host,port:target.port||9100}:target.name||await qz.printers.getDefault();
  if(!printer)throw new Error("No printer selected and Windows has no default printer.");
  return printer;
}
async function printerData(parts:PrintPart[],style?:{paper:PaperWidth;family:ReceiptFamily}){
  const data:QzData=style&&style.family!=="PRINTER"?await rasterParts(parts,style.paper,style.family):[];
  if(!data.length)for(const part of parts){
    if(part.type==="command"){data.push({type:"raw",format:"command",flavor:"base64",data:part.base64});continue}
    const logo=await logoBase64(part.url,part.width).catch(()=>null);
    if(logo)data.push({type:"raw",format:"image",flavor:"base64",data:logo,options:{language:"ESCPOS",dotDensity:"double"}});
  }
  return data;
}

export async function sendToPrinter(target:PrinterTarget,parts:PrintPart[],copies=1,style?:{paper:PaperWidth;family:ReceiptFamily}){
  const qz=await connectQz(),printer=await printerOf(qz,target),data=await printerData(parts,style);
  try{for(let copy=0;copy<Math.max(1,copies);copy++)await qz.print(qz.configs.create(printer),data)}
  catch(error){throw new Error(`Could not print to ${describePrinter(target)}. ${message(error)}`)}
}

// Everything printed when an order is placed (kitchen ticket, waiter copy, unpaid bill), in that order.
// Slips for the same printer go out as ONE QZ job: a LAN printer that is still taking in the kitchen ticket
// drops it when the next job's connection arrives, so sending them back to back lost the kitchen ticket.
export async function printQzOrder(orderId:string,kinds:ReceiptKind[]):Promise<Record<ReceiptKind,PrintResult|undefined>>{
  const results:Record<ReceiptKind,PrintResult|undefined>={kitchen:undefined,customer:undefined};
  const fail=(kind:ReceiptKind,text:string)=>{results[kind]??={ok:false,confirmed:false,message:text}};
  const groups=new Map<string,{target:PrinterTarget;kinds:Set<ReceiptKind>;slips:{parts:PrintPart[];copies:number;style:{paper:PaperWidth;family:ReceiptFamily}}[]}>();
  for(const kind of kinds){
    try{
      const response=await fetch(`/api/print/order/${encodeURIComponent(orderId)}?kind=${kind}`,{cache:"no-store"});
      const job=await response.json() as PrintJob&{message?:string};
      if(!response.ok){fail(kind,job.message??"Could not prepare the receipt.");continue}
      for(const slip of [job,...job.also??[]]){
        const target=readStationPrinters()[slip.role]??slip.printer,key=JSON.stringify(target);
        const group=groups.get(key)??{target,kinds:new Set<ReceiptKind>(),slips:[]};groups.set(key,group);
        group.kinds.add(kind);group.slips.push({parts:slip.parts,copies:Math.max(1,slip.copies),style:{paper:slip.paper,family:slip.family}});
      }
    }catch(error){fail(kind,message(error))}
  }
  let qz:Qz|null=null;
  for(const group of groups.values()){
    try{
      qz??=await connectQz();
      const printer=await printerOf(qz,group.target),data:QzData=[];
      for(const slip of group.slips){const slipData=await printerData(slip.parts,slip.style);for(let copy=0;copy<slip.copies;copy++)data.push(...slipData)}
      try{await qz.print(qz.configs.create(printer),data)}
      catch(error){throw new Error(`Could not print to ${describePrinter(group.target)}. ${message(error)}`)}
    }catch(error){for(const kind of group.kinds)fail(kind,message(error))}
  }
  for(const kind of kinds)results[kind]??={ok:true,confirmed:true,message:"Sent to the printer."};
  return results;
}

export async function printTestPage(target:PrinterTarget,paper:PaperWidth,label:string){
  const page=new EscPos(columnsFor(paper)).align("center").bold(true).size("tall").text("PRINTER TEST").size("normal").bold(false)
    .text(label).text(describePrinter(target)).text(new Date().toLocaleString()).align("left").divider().row("Item","Amount").row("1x Sample item","100.00").divider().feed(2).cut();
  await sendToPrinter(target,[{type:"command",base64:page.toBase64()}]);
}

// Opens the cash drawer plugged into the receipt printer. This PC's own receipt printer wins over the business one.
export async function openCashDrawer(printer:PrinterTarget,pin:CashDrawerPin,{useStation=true}={}):Promise<PrintResult>{
  const target=(useStation?readStationPrinters().customer:undefined)??printer;
  try{await sendToPrinter(target,[{type:"command",base64:drawerKickBase64(pin)}]);return{ok:true,confirmed:true,message:`Cash drawer opened on ${describePrinter(target)}.`}}
  catch(error){return{ok:false,confirmed:false,message:message(error)}}
}

export async function printQzQrSlip(requestId:string):Promise<PrintResult>{
  try{
    const response=await fetch(`/api/print/qr-request/${encodeURIComponent(requestId)}`,{cache:"no-store"});
    const job=await response.json() as PrintJob&{message?:string};
    if(!response.ok)return{ok:false,confirmed:false,message:job.message??"Could not prepare the slip."};
    const target=readStationPrinters().customer??job.printer;
    await sendToPrinter(target,job.parts,job.copies,{paper:job.paper,family:job.family});
    return{ok:true,confirmed:true,message:`Sent to ${describePrinter(target)}.`};
  }catch(error){return{ok:false,confirmed:false,message:message(error)}}
}

export class QzTrayPrinterAdapter implements PrinterAdapter{
  async listPrinters(){return listQzPrinters()}
  private async print(orderId:string,kind:ReceiptKind):Promise<PrintResult>{
    try{
      const response=await fetch(`/api/print/order/${encodeURIComponent(orderId)}?kind=${kind}`,{cache:"no-store"});
      const job=await response.json() as PrintJob&{message?:string};
      if(!response.ok)return{ok:false,confirmed:false,message:job.message??"Could not prepare the receipt."};
      const target=readStationPrinters()[job.role]??job.printer;
      await sendToPrinter(target,job.parts,job.copies,{paper:job.paper,family:job.family});
      // Further slips for other printers, such as the waiter copy on the counter printer.
      for(const extra of job.also??[]){
        const other=readStationPrinters()[extra.role]??extra.printer;
        try{await sendToPrinter(other,extra.parts,extra.copies,{paper:extra.paper,family:extra.family})}
        catch(error){return{ok:false,confirmed:false,message:`Kitchen ticket sent to ${describePrinter(target)}, but the waiter copy was NOT printed on ${describePrinter(other)}: ${message(error)}`}}
      }
      return{ok:true,confirmed:true,message:`Sent to ${describePrinter(target)}.`};
    }catch(error){return{ok:false,confirmed:false,message:message(error)}}
  }
  printCustomerReceipt(orderId:string){return this.print(orderId,"customer")}
  printKitchenReceipt(orderId:string){return this.print(orderId,"kitchen")}
}
