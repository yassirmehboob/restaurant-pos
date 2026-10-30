"use client";
import { useActionState,useState } from "react";
import { useFormStatus } from "react-dom";
import { ChefHat,Printer,ReceiptText,Settings2 } from "lucide-react";
import type { MasterState } from "@/app/(dashboard)/master-actions";
import { updatePrintingSettings } from "@/app/(dashboard)/settings/printing/actions";
import type { PrinterTarget } from "@/lib/printer-target";
import "./printing-settings-form.css";

type Role="customer"|"kitchen";
type Option={value:string;label:string};
export type PrintingValues={
  receiptPaperWidth:"58"|"80";printerMode:"BROWSER"|"QZ";onePrinterMode:boolean;
  receiptHeader:string;receiptFooter:string;showLogoOnCustomerReceipt:boolean;showOrderReadyTime:boolean;showPricesOnKitchenReceipt:boolean;
  customerPrintingEnabled:boolean;kitchenPrintingEnabled:boolean;autoPrintCustomerOnPayment:boolean;
  customerReceiptCopies:number;kitchenReceiptCopies:number;customer:PrinterTarget;kitchen:PrinterTarget;
};
const yesNo:Option[]=[{value:"YES",label:"Yes"},{value:"NO",label:"No"}];
const yn=(value:boolean)=>value?"YES":"NO";

function Save(){const{pending}=useFormStatus();return <button className="master-save" disabled={pending}>{pending?"Saving...":"Save printing settings"}</button>}

export function PrintingSettingsForm({values}:{values:PrintingValues}){
  const[state,formAction]=useActionState<MasterState,FormData>(updatePrintingSettings,undefined);
  // Tracked only to show the fields that apply; hidden fields still submit their values.
  const[mode,setMode]=useState(values.printerMode),[onePrinter,setOnePrinter]=useState(values.onePrinterMode);
  const[connection,setConnection]=useState<Record<Role,string>>({customer:values.customer.connection,kitchen:values.kitchen.connection});
  const[enabled,setEnabled]=useState<Record<Role,boolean>>({customer:values.customerPrintingEnabled,kitchen:values.kitchenPrintingEnabled});
  const errors=(name:string)=>state?.errors?.[name]?.map(error=><small className="field-error" key={error}>{error}</small>);
  const select=(name:string,label:string,value:string,options:Option[],onChange?:(value:string)=>void,hint?:string)=><div className="field"><label htmlFor={name}>{label}</label><select id={name} name={name} defaultValue={value} onChange={event=>onChange?.(event.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>{hint&&<small className="printing-hint">{hint}</small>}{errors(name)}</div>;
  const input=(name:string,label:string,value:string|number,props:React.InputHTMLAttributes<HTMLInputElement>={})=><div className="field"><label htmlFor={name}>{label}</label><input id={name} name={name} defaultValue={value} {...props}/>{errors(name)}</div>;

  const printerFields=(role:Role)=>{
    const target=values[role],shared=role==="kitchen"&&onePrinter;
    return <fieldset className="printing-group">
      <legend><Printer size={15}/>Printer</legend>
      {mode!=="QZ"&&<p className="printing-note">Prints through the browser print dialog. Choose QZ Tray under General to send straight to a USB or LAN printer.</p>}
      {mode==="QZ"&&shared&&<p className="printing-note">One printer mode is on, so kitchen tickets print on the customer receipt printer.</p>}
      <div className="printing-fields" hidden={mode!=="QZ"||shared}>
        {select(`${role}PrinterConnection`,"Connection",target.connection,[{value:"USB",label:"USB (Windows printer)"},{value:"LAN",label:"LAN (network IP)"}],value=>setConnection(current=>({...current,[role]:value})))}
        <div hidden={connection[role]!=="USB"}>{input(`${role}PrinterName`,"Windows printer name",target.name,{placeholder:"e.g. EPSON TM-T88V Receipt"})}</div>
        <div className="printing-lan" hidden={connection[role]!=="LAN"}>
          {input(`${role}PrinterHost`,"Printer IP address",target.host,{placeholder:role==="customer"?"e.g. 192.168.1.50":"e.g. 192.168.1.51",inputMode:"decimal"})}
          {input(`${role}PrinterPort`,"Port",target.port,{type:"number",min:1,max:65535})}
        </div>
      </div>
    </fieldset>;
  };

  return <form action={formAction} className="master-form printing-form">
    {state?.message&&<p className={state.ok?"success-message":"form-alert"}>{state.message}</p>}
    <section className="printing-card">
      <header><span><Settings2 size={18}/></span><div><h2>General</h2><p>How this restaurant prints, for both customer receipts and kitchen tickets.</p></div></header>
      <div className="printing-fields printing-fields-3">
        {select("printerMode","Printing mode",values.printerMode,[{value:"BROWSER",label:"Browser print dialog"},{value:"QZ",label:"QZ Tray (direct USB / LAN)"}],value=>setMode(value as PrintingValues["printerMode"]),"QZ Tray must be installed on every PC that prints.")}
        {select("onePrinterMode","Printers",yn(values.onePrinterMode),[{value:"YES",label:"One printer for both"},{value:"NO",label:"Separate customer and kitchen printers"}],value=>setOnePrinter(value==="YES"))}
        {select("receiptPaperWidth","Paper width",values.receiptPaperWidth,[{value:"80",label:"80 mm"},{value:"58",label:"58 mm"}])}
      </div>
    </section>

    <div className="printing-columns">
      <section className={`printing-card ${enabled.customer?"":"is-off"}`}>
        <header><span className="is-customer"><ReceiptText size={18}/></span><div><h2>Customer receipt</h2><p>The bill handed to the customer.</p></div></header>
        {select("customerPrintingEnabled","Print customer receipts",yn(values.customerPrintingEnabled),yesNo,value=>setEnabled(current=>({...current,customer:value==="YES"})))}
        {printerFields("customer")}
        <fieldset className="printing-group">
          <legend><ReceiptText size={15}/>Receipt content</legend>
          <div className="printing-fields">
            {input("receiptHeader","Header",values.receiptHeader,{placeholder:"Printed under the business name"})}
            <div className="field"><label htmlFor="receiptFooter">Footer</label><textarea id="receiptFooter" name="receiptFooter" defaultValue={values.receiptFooter}/>{errors("receiptFooter")}</div>
            <div className="printing-fields printing-fields-2">
              {select("showLogoOnCustomerReceipt","Show logo",yn(values.showLogoOnCustomerReceipt),yesNo)}
              {select("showOrderReadyTime","Show order ready time",yn(values.showOrderReadyTime),yesNo)}
            </div>
          </div>
        </fieldset>
        <fieldset className="printing-group">
          <legend><Printer size={15}/>When to print</legend>
          <div className="printing-fields printing-fields-2">
            {select("autoPrintCustomerOnPayment","Auto-print after payment",yn(values.autoPrintCustomerOnPayment),yesNo)}
            {input("customerReceiptCopies","Copies",values.customerReceiptCopies,{type:"number",min:1,max:5})}
          </div>
        </fieldset>
      </section>

      <section className={`printing-card ${enabled.kitchen?"":"is-off"}`}>
        <header><span className="is-kitchen"><ChefHat size={18}/></span><div><h2>Kitchen ticket</h2><p>The order slip the kitchen cooks from.</p></div></header>
        {select("kitchenPrintingEnabled","Print kitchen tickets",yn(values.kitchenPrintingEnabled),yesNo,value=>setEnabled(current=>({...current,kitchen:value==="YES"})))}
        {printerFields("kitchen")}
        <fieldset className="printing-group">
          <legend><ChefHat size={15}/>Ticket content</legend>
          <div className="printing-fields printing-fields-2">
            {select("showPricesOnKitchenReceipt","Show prices",yn(values.showPricesOnKitchenReceipt),yesNo)}
            {input("kitchenReceiptCopies","Copies",values.kitchenReceiptCopies,{type:"number",min:1,max:5})}
          </div>
        </fieldset>
      </section>
    </div>

    <div className="printing-actions"><Save/></div>
  </form>;
}
