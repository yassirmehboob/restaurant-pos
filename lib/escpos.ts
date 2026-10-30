// ESC/POS command builder for Epson TM receipt printers (TM-T88V and compatibles).
// Output is plain bytes, so the same job prints over USB (Windows queue) or LAN (raw port 9100).

const ESC=0x1b,GS=0x1d;
export type PaperWidth="58"|"80";
// Font A columns: TM-T88V prints 42 on 80 mm and 30 on 58 mm; 48-column printers just keep a wider margin.
export const columnsFor=(paper:PaperWidth)=>paper==="58"?30:42;

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

export class EscPos{
  private bytes:number[]=[];
  readonly columns:number;
  constructor(columns:number){this.columns=columns;this.raw(ESC,0x40,ESC,0x74,16)}
  raw(...values:number[]){this.bytes.push(...values);return this}
  // Starts a new command part (after an image) without re-initialising the printer.
  reset(){this.bytes=[];return this}
  align(value:"left"|"center"|"right"){return this.raw(ESC,0x61,value==="left"?0:value==="center"?1:2)}
  bold(on:boolean){return this.raw(ESC,0x45,on?1:0)}
  // Double width halves the usable columns, so callers wrap against columnsAt(size).
  size(value:"normal"|"tall"|"large"){return this.raw(GS,0x21,value==="normal"?0:value==="tall"?0x01:0x11)}
  columnsAt(value:"normal"|"tall"|"large"){return value==="large"?Math.floor(this.columns/2):this.columns}
  text(value:string,width=this.columns){for(const line of wrap(value,width))this.bytes.push(...encode(line),0x0a);return this}
  // Left text wraps; the right value sits on the last line, right-aligned.
  row(left:string,right:string,width=this.columns){
    const room=Math.max(1,width-right.length-1),lines=wrap(left,room),last=lines.pop()??"";
    for(const line of lines)this.text(line,width);
    this.bytes.push(...encode(last+" ".repeat(Math.max(1,width-last.length-right.length))+right),0x0a);return this
  }
  divider(char="-"){this.bytes.push(...encode(char.repeat(this.columns)),0x0a);return this}
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
