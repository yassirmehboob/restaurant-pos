// ESC/POS command builder for Epson TM receipt printers (TM-T88V and compatibles).
// Output is plain bytes, so the same job prints over USB (Windows queue) or LAN (raw port 9100).

const ESC=0x1b,GS=0x1d;
// ESC ~ is not an ESC/POS command; it marks right-to-left text for the counter PC to draw (EscPos.local).
export const LOCAL_TEXT=0x7e;
export type PaperWidth="58"|"80";
export const RECEIPT_FONTS=["STANDARD","COMPACT","BOLD"] as const;
export const RECEIPT_SIZES=["NORMAL","TALL","LARGE"] as const;
export type ReceiptFont=(typeof RECEIPT_FONTS)[number];
export type ReceiptSize=(typeof RECEIPT_SIZES)[number];
export type ReceiptStyle={font:ReceiptFont;size:ReceiptSize};
type Size="normal"|"tall"|"large";
// Font A columns: TM-T88V prints 42 on 80 mm and 30 on 58 mm; 48-column printers just keep a wider margin.
// Compact uses Font B (9x17 dots), which fits a third more characters on the same paper.
export const columnsFor=(paper:PaperWidth,font:ReceiptFont="STANDARD")=>font==="COMPACT"?(paper==="58"?40:56):(paper==="58"?30:42);
const sizeRank:Record<Size,number>={normal:0,tall:1,large:2},sizes:Size[]=["normal","tall","large"];

// Code page 16 (WPC1252) covers Latin text; anything else prints as "?" instead of garbage bytes.
const encode=(text:string)=>Array.from(text.normalize("NFC").replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,"-").replace(/…/g,"...").replace(/×/g,"x"),char=>{const code=char.charCodeAt(0);return code>=0x20&&code<=0xff?code:0x3f});

export function wrap(text:string,width:number){
  const lines:string[]=[];
  for(const source of text.split(/\r?\n/)){
    // Leading spaces indent every wrapped line of the paragraph (item details, notes).
    const indent=/^ */.exec(source)?.[0].slice(0,Math.floor(width/2))??"";
    if(indent){lines.push(...wrap(source.trimStart(),width-indent.length).map(line=>indent+line));continue}
    const paragraph=source;
    let line="";
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
      if(word.length>width){
        if(line)lines.push(line);
        const chunks=word.match(new RegExp(`.{1,${width}}`,"g"))??[];
        line=chunks.pop()??"";lines.push(...chunks);continue
      }
      if(!line)line=word;else if(line.length+1+word.length<=width)line+=" "+word;else{lines.push(line);line=word}
    }
    lines.push(line);
  }
  return lines;
}

// The receipt style is the base: size("normal") and bold(false) return to it, so layouts only describe emphasis.
export class EscPos{
  private bytes:number[]=[];
  private readonly baseSize:Size;
  private readonly baseBold:boolean;
  private readonly font:ReceiptFont;
  // Columns available to normal body text at the base size.
  readonly columns:number;
  constructor(fontColumns:number,style?:ReceiptStyle){
    this.font=style?.font??"STANDARD";this.baseBold=this.font==="BOLD";this.baseSize=style?.size==="LARGE"?"large":style?.size==="TALL"?"tall":"normal";
    this.columns=this.baseSize==="large"?Math.floor(fontColumns/2):fontColumns;
    this.raw(ESC,0x40,ESC,0x74,16).applyStyle();
  }
  raw(...values:number[]){this.bytes.push(...values);return this}
  // Defaults are left implicit so a plain receipt keeps its original bytes.
  private applyStyle(){if(this.font==="COMPACT")this.raw(ESC,0x4d,1);if(this.baseBold)this.bold(false);if(this.baseSize!=="normal")this.size("normal");return this}
  // Starts a new command part (after an image) without re-initialising the printer.
  reset(){this.bytes=[];return this.applyStyle()}
  align(value:"left"|"center"|"right"){return this.raw(ESC,0x61,value==="left"?0:value==="center"?1:2)}
  bold(on:boolean){return this.raw(ESC,0x45,on||this.baseBold?1:0)}
  // Reverse print (white on black), GS B.
  invert(on:boolean){return this.raw(GS,0x42,on?1:0)}
  // A full-width white-on-black band, centred, for what the reader must spot first (order number, kitchen counter).
  band(value:string,size:Size="large"){
    const width=this.columnsAt(size);
    this.align("left").bold(true).size(size).invert(true);
    for(const line of wrap(value,width)){const left=Math.floor((width-line.length)/2);this.bytes.push(...encode((" ".repeat(left)+line).padEnd(width)),0x0a)}
    return this.invert(false).size("normal").bold(false);
  }
  private effective(value:Size){return sizes[Math.max(sizeRank[value],sizeRank[this.baseSize])]}
  // Double width halves the usable columns, so callers wrap against columnsAt(size).
  size(value:Size){const size=this.effective(value);return this.raw(GS,0x21,size==="normal"?0:size==="tall"?0x01:0x11)}
  columnsAt(value:Size){return this.effective(value)==="large"&&this.baseSize!=="large"?Math.floor(this.columns/2):this.columns}
  text(value:string,width=this.columns){for(const line of wrap(value,width))this.bytes.push(...encode(line),0x0a);return this}
  // Left text wraps; the right value sits on the last line, right-aligned.
  row(left:string,right:string,width=this.columns){
    const room=Math.max(1,width-right.length-1),lines=wrap(left,room),last=lines.pop()??"";
    for(const line of lines)this.text(line,width);
    this.bytes.push(...encode(last+" ".repeat(Math.max(1,width-last.length-right.length))+right),0x0a);return this
  }
  // Prints pre-aligned text (tables) as is: spacing is kept, nothing wraps, and overflow is cut at the paper width.
  line(value:string){this.bytes.push(...encode(value.slice(0,this.columns)),0x0a);return this}
  divider(char="-"){this.bytes.push(...encode(char.repeat(this.columns)),0x0a);return this}
  // Right-to-left text (Sindhi, Urdu) that printers cannot draw from their code pages. It travels as a private
  // ESC ~ <length> <UTF-8> record that only the counter PC reads, and is drawn into the receipt image there
  // (lib/receipt-raster.ts). A ticket carrying it is therefore always printed as an image, never raw.
  local(value:string){
    const utf8=new TextEncoder().encode(value.trim()).slice(0,0xffff);
    this.raw(ESC,LOCAL_TEXT,utf8.length&0xff,utf8.length>>8);for(const byte of utf8)this.bytes.push(byte);
    this.bytes.push(0x0a);this.localText=true;return this;
  }
  localText=false;
  feed(lines=1){return this.raw(ESC,0x64,Math.min(255,Math.max(0,lines)))}
  barcode(value:string){
    const data=encode("{B"+value.slice(0,40));
    return this.raw(GS,0x68,60,GS,0x77,2,GS,0x48,2,GS,0x66,1,GS,0x6b,73,data.length,...data).raw(0x0a)
  }
  // Feed past the tear bar, then partial cut.
  cut(){return this.raw(GS,0x56,66,3)}
  toBytes(){return Uint8Array.from(this.bytes)}
  toBase64(){let binary="";for(const byte of this.bytes)binary+=String.fromCharCode(byte);return btoa(binary)}
}
