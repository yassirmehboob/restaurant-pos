import { EscPos,LOCAL_TEXT,columnsFor,type PaperWidth } from "@/lib/escpos";
import { FAMILY_FONTS,LOCAL_FONT_CSS,type ReceiptFamily } from "@/lib/receipt-fonts";

// invert: reverse print (GS B), drawn white on a black band.
export type LineStyle={align:number;bold:boolean;size:number;font:number;invert?:boolean};
// rtl rows hold Sindhi or Urdu text (EscPos.local), drawn right-aligned in the bundled Arabic-script font.
export type ReceiptRow={kind:"text";text:string;style:LineStyle;rtl?:boolean}|{kind:"barcode";value:string;align:number}|{kind:"cut"};

// Replays ESC/POS bytes the way a TM-T88 lays them out: one row per printed line, plus barcodes and cuts.
export function decodeEscPos(base64:string):ReceiptRow[]{
  const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0)),rows:ReceiptRow[]=[],fresh=():LineStyle=>({align:0,bold:false,size:0,font:0});
  let style=fresh(),line="";
  const flush=()=>{rows.push({kind:"text",text:line,style:{...style}});line=""};
  for(let i=0;i<bytes.length;i++){
    const byte=bytes[i],next=bytes[i+1];
    if(byte===0x1b){
      if(next===0x40){style=fresh();i++}
      else if(next===0x61){style.align=bytes[i+2];i+=2}
      else if(next===0x45){style.bold=bytes[i+2]===1;i+=2}
      else if(next===0x4d){style.font=bytes[i+2];i+=2}
      else if(next===0x64){if(line)flush();for(let n=0;n<bytes[i+2];n++)flush();i+=2}
      else if(next===LOCAL_TEXT){
        if(line)flush();
        const length=bytes[i+2]|(bytes[i+3]<<8),start=i+4;
        rows.push({kind:"text",text:new TextDecoder().decode(bytes.slice(start,start+length)),style:{...style},rtl:true});
        i=start+length-1;if(bytes[i+1]===0x0a)i++;
      }
      else i+=2;
    }else if(byte===0x1d){
      if(next===0x21){style.size=bytes[i+2];i+=2}
      else if(next===0x42){if(bytes[i+2]&1)style.invert=true;else delete style.invert;i+=2}
      else if(next===0x6b){const length=bytes[i+3];rows.push({kind:"barcode",value:String.fromCharCode(...bytes.slice(i+4,i+4+length)).replace(/^\{B/,""),align:style.align});i+=3+length;if(bytes[i+1]===0x0a)i++}
      else if(next===0x56){rows.push({kind:"cut"});i+=3}
      else i+=2;
    }else if(byte===0x0a)flush();
    else line+=String.fromCharCode(byte);
  }
  if(line)flush();
  return rows;
}

// Image width in printer dots (180 dpi): exactly the Font A line, 12 dots per column.
export const rasterWidth=(paper:PaperWidth)=>columnsFor(paper)*12;
const metrics=(style:LineStyle)=>{
  const compact=style.font===1,wide=(style.size&0x10)!==0,tall=(style.size&0x01)!==0;
  // Double height alone is drawn 1.4x larger and stretched the rest of the way; a full 2x stretch looks squashed in desktop fonts.
  const heightOnly=tall&&!wide;
  return{compact,wide,tall,line:(compact?24:30)*(tall?2:1),px:(compact?17:23)*(wide?2:heightOnly?1.4:1),stretch:heightOnly?2/1.4:1};
};
const numeric=/^[-+]?[\d.,:%/x]+$/i;

// Draws text rows in a desktop font. Every character keeps its printer column, so
// right-aligned amounts and table columns line up even with proportional fonts.
// Arabic-script letters carry dots and marks above and below, so their rows get more height than Latin ones.
const RTL_LINE=1.5,RTL_TEXT=1.15;
const rowHeight=(row:Extract<ReceiptRow,{kind:"text"}>)=>Math.round(metrics(row.style).line*(row.rtl?RTL_LINE:1));
export function drawRows(rows:Extract<ReceiptRow,{kind:"text"}>[],paper:PaperWidth,family:ReceiptFamily){
  const width=rasterWidth(paper),canvas=document.createElement("canvas");
  canvas.width=width;canvas.height=Math.max(1,rows.reduce((sum,row)=>sum+rowHeight(row),0));
  const context=canvas.getContext("2d");if(!context)return canvas;
  context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle="#000";context.textBaseline="alphabetic";
  let y=0;
  for(const row of rows){
    if(row.rtl){
      // Right-aligned at the paper edge; the browser joins the letters and orders the words right to left.
      const {px}=metrics(row.style),line=rowHeight(row),text=row.text.trim();
      context.font=`${row.style.bold?700:400} ${Math.round(px*RTL_TEXT)}px ${LOCAL_FONT_CSS}`;
      context.direction="rtl";context.textAlign="left";
      const measured=context.measureText(text).width,room=width-8,squeeze=measured>room?room/measured:1;
      context.save();context.translate(width-4-measured*squeeze,y+Math.round(line*0.7));context.scale(squeeze,1);context.fillText(text,0,0);context.restore();
      context.direction="ltr";context.textAlign="start";
      y+=line;continue;
    }
    if(row.style.invert){context.fillRect(0,y,width,rowHeight(row));context.fillStyle="#fff"}
    const {compact,wide,line,px,stretch}=metrics(row.style),columns=columnsFor(paper,compact?"COMPACT":"STANDARD")/(wide?2:1),cell=width/columns,baseline=y+line-(compact?6:7)*stretch;
    context.font=`${row.style.bold?700:400} ${px}px ${FAMILY_FONTS[family].css}`;
    const draw=(text:string,x:number,room:number,anchor:"left"|"right"|"center")=>{
      const measured=context.measureText(text).width,squeeze=measured>room?room/measured:1,drawn=measured*squeeze;
      const left=anchor==="left"?x:anchor==="right"?x-drawn:x-drawn/2;
      context.save();context.translate(left,baseline);context.scale(squeeze,stretch);context.fillText(text,0,0);context.restore();
    };
    const text=row.text.replace(/\s+$/,"");
    if(/^-{6,}$/.test(text)){context.fillRect(0,y+line/2-1,width,2)}
    else if(row.style.align!==0&&text.trim()){const trimmed=text.trim();draw(trimmed,row.style.align===1?width/2:width,width,row.style.align===1?"center":"right")}
    else for(const match of text.matchAll(/\S+(?: \S+)*/g)){
      const start=match.index,end=start+match[0].length;
      // Amounts, quantities and anything ending at the paper edge hug the right of their columns; words start at their column.
      if(numeric.test(match[0])||end>=Math.floor(columns))draw(match[0],end*cell,match[0].length*cell,"right");else draw(match[0],start*cell,match[0].length*cell,"left");
    }
    context.fillStyle="#000";
    y+=line;
  }
  return canvas;
}

export type RasterBlock={kind:"image";canvas:HTMLCanvasElement}|{kind:"barcode";value:string;align:number}|{kind:"cut"};
// Groups consecutive text rows into one image; barcodes and cuts stay native so scanners and cutters work.
export function rasterBlocks(rows:ReceiptRow[],paper:PaperWidth,family:ReceiptFamily):RasterBlock[]{
  const blocks:RasterBlock[]=[];let text:Extract<ReceiptRow,{kind:"text"}>[]=[];
  const flush=()=>{if(text.length)blocks.push({kind:"image",canvas:drawRows(text,paper,family)});text=[]};
  for(const row of rows){if(row.kind==="text")text.push(row);else{flush();blocks.push(row)}}
  flush();
  return blocks;
}

export function nativeCommand(block:Exclude<RasterBlock,{kind:"image"}>){
  const p=new EscPos(42).reset();
  return(block.kind==="barcode"?p.align(block.align===1?"center":block.align===2?"right":"left").barcode(block.value).align("left"):p.cut()).toBase64();
}
