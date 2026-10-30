"use client";
import { useId,useState,useSyncExternalStore } from "react";
import { Cable,Check,LoaderCircle,Monitor,Printer,RefreshCw,Wifi } from "lucide-react";
import { describePrinter,printerTargetSchema,type PrinterTarget } from "@/lib/printer-target";
import type { PaperWidth } from "@/lib/escpos";
import { listQzPrinters,parseStationPrinters,printTestPage,saveStationPrinters,stationPrintersRaw,type StationPrinters } from "@/lib/printers/qz-tray";
import "./printer-station-settings.css";

type Role="customer"|"kitchen";
type Draft={mode:"BUSINESS"|"USB"|"LAN";name:string;host:string;port:string};
const subscribe=(onChange:()=>void)=>{window.addEventListener("storage",onChange);return()=>window.removeEventListener("storage",onChange)};
const toDraft=(target?:PrinterTarget):Draft=>target?{mode:target.connection,name:target.name,host:target.host,port:String(target.port||9100)}:{mode:"BUSINESS",name:"",host:"",port:"9100"};

export function PrinterStationSettings({customer,kitchen,onePrinter,paper}:{customer:PrinterTarget;kitchen:PrinterTarget;onePrinter:boolean;paper:PaperWidth}){
  const id=useId(),roles:Role[]=onePrinter?["customer"]:["customer","kitchen"],business={customer,kitchen};
  // Saved choices live in this browser; unsaved edits override them until saved.
  const saved=parseStationPrinters(useSyncExternalStore(subscribe,stationPrintersRaw,()=>null));
  const [edits,setEdits]=useState<Partial<Record<Role,Draft>>>({});
  const drafts:Record<Role,Draft>={customer:edits.customer??toDraft(saved.customer),kitchen:edits.kitchen??toDraft(saved.kitchen)};
  const [printers,setPrinters]=useState<string[]>([]),[status,setStatus]=useState<{ok:boolean;message:string}|null>(null),[busy,setBusy]=useState<string|null>(null);

  const resolve=(role:Role):{target?:PrinterTarget;error?:string}=>{
    const draft=drafts[role];if(draft.mode==="BUSINESS")return{target:business[role]};
    const parsed=printerTargetSchema.safeParse({connection:draft.mode,name:draft.name,host:draft.host,port:draft.port});
    return parsed.success?{target:parsed.data}:{error:parsed.error.issues[0]?.message??"Check the printer details."};
  };
  const run=async(key:string,task:()=>Promise<string>)=>{setBusy(key);setStatus(null);try{setStatus({ok:true,message:await task()})}catch(error){setStatus({ok:false,message:error instanceof Error?error.message:"Something went wrong."})}finally{setBusy(null)}};
  const detect=()=>run("detect",async()=>{const found=await listQzPrinters();setPrinters(found);return`QZ Tray connected. ${found.length} printer${found.length===1?"":"s"} found on this computer.`});
  const save=()=>run("save",async()=>{
    const next:StationPrinters={};
    for(const role of roles){const result=resolve(role);if(result.error)throw new Error(`${role==="customer"?"Customer":"Kitchen"} printer: ${result.error}`);if(drafts[role].mode!=="BUSINESS"&&result.target)next[role]=result.target}
    saveStationPrinters(next);setEdits({});return"Saved for this computer only.";
  });
  const test=(role:Role)=>run(`test-${role}`,async()=>{const result=resolve(role);if(!result.target)throw new Error(result.error);await printTestPage(result.target,paper,role==="customer"?"Customer receipt printer":"Kitchen printer");return`Test page sent to ${describePrinter(result.target)}.`});
  const update=(role:Role,patch:Partial<Draft>)=>setEdits(current=>({...current,[role]:{...drafts[role],...current[role],...patch}}));

  return <section className="printer-station" aria-labelledby={`${id}-title`}>
    <header><span aria-hidden="true"><Monitor size={20}/></span><div><h2 id={`${id}-title`}>This computer</h2><p>Each counter PC can print to its own USB or LAN printer. These choices are saved in this browser only.</p></div>
      <button type="button" onClick={detect} disabled={busy!==null}>{busy==="detect"?<LoaderCircle className="printer-station-spin" size={16}/>:<RefreshCw size={16}/>}Find printers</button></header>
    <div className="printer-station-roles">{roles.map(role=>{const draft=drafts[role],label=role==="customer"?(onePrinter?"Receipt printer (customer + kitchen)":"Customer receipt printer"):"Kitchen printer";return <fieldset key={role}>
      <legend><Printer size={16}/>{label}</legend>
      <div className="printer-station-modes" role="radiogroup" aria-label={label}>
        {([["BUSINESS",`Business setting · ${describePrinter(business[role])}`,Check],["USB","USB on this PC",Cable],["LAN","LAN / network IP",Wifi]] as const).map(([mode,text,Icon])=><label key={mode} className={draft.mode===mode?"is-active":""}><input type="radio" name={`${id}-${role}`} checked={draft.mode===mode} onChange={()=>update(role,{mode})}/><Icon size={15}/>{text}</label>)}
      </div>
      {draft.mode==="USB"&&<label className="printer-station-field">Windows printer name<input list={`${id}-printers`} value={draft.name} placeholder="Leave empty for the Windows default printer" onChange={event=>update(role,{name:event.target.value})}/></label>}
      {draft.mode==="LAN"&&<div className="printer-station-lan"><label className="printer-station-field">Printer IP address<input inputMode="decimal" value={draft.host} placeholder="192.168.1.50" onChange={event=>update(role,{host:event.target.value})}/></label><label className="printer-station-field">Port<input inputMode="numeric" value={draft.port} onChange={event=>update(role,{port:event.target.value})}/></label></div>}
      <button type="button" className="printer-station-test" onClick={()=>test(role)} disabled={busy!==null}>{busy===`test-${role}`?<LoaderCircle className="printer-station-spin" size={15}/>:<Printer size={15}/>}Print test page</button>
    </fieldset>})}</div>
    <datalist id={`${id}-printers`}>{printers.map(name=><option key={name} value={name}/>)}</datalist>
    <footer><p role="status" aria-live="polite" className={status&&!status.ok?"is-error":""}>{status?.message??"Install QZ Tray on this PC, then use Find printers to check the connection."}</p><button type="button" onClick={save} disabled={busy!==null}>{busy==="save"?<LoaderCircle className="printer-station-spin" size={16}/>:<Check size={16}/>}Save for this computer</button></footer>
  </section>;
}
