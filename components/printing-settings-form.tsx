"use client";
import { useActionState,useMemo,useState } from "react";
import { useFormStatus } from "react-dom";
import { Banknote,ChefHat,ClipboardList,Eye,Languages,LoaderCircle,Printer,ReceiptText,Save as SaveIcon,Settings2 } from "lucide-react";
import Link from "next/link";
import { KITCHEN_LANGUAGES,KITCHEN_LANGUAGE_LABELS,type KitchenLanguage } from "@/lib/kitchen-language";
import type { MasterState } from "@/app/(dashboard)/master-actions";
import { updatePrintingSettings } from "@/app/(dashboard)/settings/printing/actions";
import type { PrinterTarget } from "@/lib/printer-target";
import type { CashDrawerOpenOn,CashDrawerPin } from "@/lib/cash-drawer";
import type { ReceiptStyle } from "@/lib/escpos";
import { FAMILY_FONTS,RECEIPT_FAMILIES,type ReceiptFamily } from "@/lib/receipt-fonts";
import type { ReceiptBusiness } from "@/lib/receipt-layout";
import { ReceiptPreview } from "@/components/receipt-preview";
import "./printing-settings-form.css";

type Role="customer"|"kitchen";
type Option={value:string;label:string};
export type PrintingValues={
  receiptPaperWidth:"58"|"80";printerMode:"BROWSER"|"QZ";onePrinterMode:boolean;
  receiptHeader:string;receiptFooter:string;showLogoOnCustomerReceipt:boolean;showOrderReadyTime:boolean;showPricesOnKitchenReceipt:boolean;
  customerPrintingEnabled:boolean;kitchenPrintingEnabled:boolean;autoPrintCustomerOnPayment:boolean;autoPrintUnpaidDineIn:boolean;unpaidDineInReceiptCopies:number;
  customerReceiptCopies:number;kitchenReceiptCopies:number;customerStyle:ReceiptStyle;kitchenStyle:ReceiptStyle;customerFamily:ReceiptFamily;kitchenFamily:ReceiptFamily;kitchenLanguage:KitchenLanguage;kitchenTicketPerCategory:boolean;kitchenTicketWholeOrder:boolean;kitchenWaiterCopy:boolean;kitchenWaiterCopies:number;cashDrawerOpenOn:CashDrawerOpenOn;cashDrawerPin:CashDrawerPin;customer:PrinterTarget;kitchen:PrinterTarget;
};
type PreviewBusiness={name:string;address:string;phone:string;taxNumber:string;logoUrl:string;paymentQrUrl:string;paymentQrCaption:string;paymentQrShowOn:string};
const fontOptions:Option[]=[{value:"STANDARD",label:"Standard (Font A)"},{value:"COMPACT",label:"Compact (Font B)"},{value:"BOLD",label:"Bold"}];
const familyOptions:Option[]=RECEIPT_FAMILIES.map(value=>({value,label:FAMILY_FONTS[value].label}));
const languageOptions:Option[]=KITCHEN_LANGUAGES.map(value=>({value,label:KITCHEN_LANGUAGE_LABELS[value]}));
const sizeOptions:Option[]=[{value:"NORMAL",label:"Normal"},{value:"TALL",label:"Tall (double height)"},{value:"LARGE",label:"Large (double size)"}];
// Form fields the preview reads; everything else on the form does not change how a receipt looks.
const PREVIEW_FIELDS=["receiptPaperWidth","receiptHeader","receiptFooter","showLogoOnCustomerReceipt","showOrderReadyTime","showPricesOnKitchenReceipt","customerReceiptFont","customerReceiptSize","kitchenReceiptFont","kitchenReceiptSize","customerReceiptFamily","kitchenReceiptFamily","kitchenReceiptLanguage","kitchenTicketPerCategory","kitchenWaiterCopy"] as const;
type Draft=Record<(typeof PREVIEW_FIELDS)[number],string>;
const drawerOptions:Option[]=[{value:"NEVER",label:"Never"},{value:"CASH",label:"When cash is received"},{value:"ALL",label:"On every payment"}];
const pinOptions:Option[]=[{value:"PIN2",label:"Pin 2 (most drawers)"},{value:"PIN5",label:"Pin 5"}];
const yesNo:Option[]=[{value:"YES",label:"Yes"},{value:"NO",label:"No"}];
const yn=(value:boolean)=>value?"YES":"NO";

function Save(){const{pending}=useFormStatus();return <button type="submit" className="master-save printing-save" disabled={pending}>{pending?<LoaderCircle className="printing-save-spin" size={18}/>:<SaveIcon size={18}/>}{pending?"Saving...":"Save printing settings"}</button>}

export function PrintingSettingsForm({values,business}:{values:PrintingValues;business:PreviewBusiness}){
  const[state,formAction]=useActionState<MasterState,FormData>(updatePrintingSettings,undefined);
  // Tracked only to show the fields that apply; hidden fields still submit their values.
  const[mode,setMode]=useState(values.printerMode),[onePrinter,setOnePrinter]=useState(values.onePrinterMode);
  const[connection,setConnection]=useState<Record<Role,string>>({customer:values.customer.connection,kitchen:values.kitchen.connection});
  const[enabled,setEnabled]=useState<Record<Role,boolean>>({customer:values.customerPrintingEnabled,kitchen:values.kitchenPrintingEnabled});
  // Tickets: one for the order, one per category, or one per category plus a whole-order ticket.
  const ticketMode=values.kitchenTicketPerCategory?values.kitchenTicketWholeOrder?"BOTH":"YES":"NO";
  const[draft,setDraft]=useState<Draft>({receiptPaperWidth:values.receiptPaperWidth,receiptHeader:values.receiptHeader,receiptFooter:values.receiptFooter,showLogoOnCustomerReceipt:yn(values.showLogoOnCustomerReceipt),showOrderReadyTime:yn(values.showOrderReadyTime),showPricesOnKitchenReceipt:yn(values.showPricesOnKitchenReceipt),customerReceiptFont:values.customerStyle.font,customerReceiptSize:values.customerStyle.size,kitchenReceiptFont:values.kitchenStyle.font,kitchenReceiptSize:values.kitchenStyle.size,customerReceiptFamily:values.customerFamily,kitchenReceiptFamily:values.kitchenFamily,kitchenReceiptLanguage:values.kitchenLanguage,kitchenTicketPerCategory:ticketMode,kitchenWaiterCopy:yn(values.kitchenWaiterCopy)});
  const readDraft=(form:HTMLFormElement)=>{const data=new FormData(form);setDraft(current=>{const next={...current};for(const field of PREVIEW_FIELDS)next[field]=String(data.get(field)??current[field]);return PREVIEW_FIELDS.some(field=>next[field]!==current[field])?next:current})};
  const preview=useMemo<ReceiptBusiness>(()=>({...business,...draft,showLogoOnCustomerReceipt:draft.showLogoOnCustomerReceipt==="YES",showPricesOnKitchenReceipt:draft.showPricesOnKitchenReceipt==="YES",kitchenTicketPerCategory:draft.kitchenTicketPerCategory!=="NO",kitchenTicketWholeOrder:draft.kitchenTicketPerCategory==="BOTH",kitchenWaiterCopy:draft.kitchenWaiterCopy==="YES"}),[business,draft]);
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

  return <form action={formAction} className="master-form printing-form" onChange={event=>readDraft(event.currentTarget)}>
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
              <div className="printing-span-2">{select("customerReceiptFamily","Font family",values.customerFamily,familyOptions,undefined,"Other fonts are drawn on the counter PC and printed as an image, which is a little slower.")}</div>
              {select("customerReceiptFont","Font style",values.customerStyle.font,fontOptions)}
              {select("customerReceiptSize","Text size",values.customerStyle.size,sizeOptions,undefined,"Large fits half as many characters per line.")}
            </div>
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
          <div className="printing-fields printing-fields-2">
            {select("autoPrintUnpaidDineIn","Auto-print unpaid dine-in receipt",yn(values.autoPrintUnpaidDineIn),yesNo,undefined,"Prints the bill when a dine-in order is placed.")}
            {input("unpaidDineInReceiptCopies","Copies",values.unpaidDineInReceiptCopies,{type:"number",min:1,max:5})}
          </div>
          <div className="printing-fields printing-fields-2">
            {select("kitchenWaiterCopy","Waiter copy",yn(values.kitchenWaiterCopy),[{value:"NO",label:"No"},{value:"YES",label:"Print the whole order for the waiter"}],undefined,"Each time the kitchen ticket prints, this printer also prints a WAITER COPY with every item of the order, for the waiter to keep.")}
            {input("kitchenWaiterCopies","Copies",values.kitchenWaiterCopies,{type:"number",min:1,max:5})}
          </div>
        </fieldset>
        <fieldset className="printing-group">
          <legend><Banknote size={15}/>Cash drawer</legend>
          {mode!=="QZ"&&<p className="printing-note">The cash drawer needs QZ Tray. Choose QZ Tray under General: the browser print dialog cannot open a drawer.</p>}
          <div className="printing-fields printing-fields-2">
            {select("cashDrawerOpenOn","Open the cash drawer",values.cashDrawerOpenOn,drawerOptions,undefined,"Plug the drawer cable into the receipt printer's drawer port (DK).")}
            {select("cashDrawerPin","Drawer connector",values.cashDrawerPin,pinOptions,undefined,"Try pin 5 if the test does not open it.")}
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
            <div className="printing-span-2">{select("kitchenReceiptFamily","Font family",values.kitchenFamily,familyOptions,undefined,"Other fonts are drawn on the counter PC and printed as an image, which is a little slower.")}</div>
            <div className="printing-span-2">{select("kitchenReceiptLanguage","Item names in",values.kitchenLanguage,languageOptions,undefined,"Sindhi and Urdu names are translated offline and printed as an image. Review or correct them under Kitchen translations.")}<Link className="printing-translations-link" href="/settings/translations"><Languages size={15}/>Kitchen translations</Link></div>
            {select("kitchenReceiptFont","Font style",values.kitchenStyle.font,fontOptions)}
            {select("kitchenReceiptSize","Text size",values.kitchenStyle.size,sizeOptions,undefined,"Item lines are always printed tall.")}
          </div>
          <div className="printing-fields printing-fields-2">
            {select("showPricesOnKitchenReceipt","Show prices",yn(values.showPricesOnKitchenReceipt),yesNo)}
            {input("kitchenReceiptCopies","Copies",values.kitchenReceiptCopies,{type:"number",min:1,max:5})}
            <div className="printing-span-2">{select("kitchenTicketPerCategory","Tickets",ticketMode,[{value:"NO",label:"One ticket for the whole order"},{value:"YES",label:"Separate ticket per item category"},{value:"BOTH",label:"Separate ticket per item category + one whole order ticket"}],undefined,"For kitchens with a counter per category: each counter gets a slip with only its items. Deals are split by their items' categories. The whole order ticket prints last, on the kitchen printer, for the kitchen delivery men.")}</div>
          </div>
        </fieldset>
      </section>
    </div>

    <section className="printing-card printing-preview-card">
      <header><span><Eye size={18}/></span><div><h2>Receipt preview</h2><p>Sample order, laid out exactly as the printer receives it. Updates as you change the settings above.</p></div></header>
      <div className="printing-previews">
        <figure><figcaption><ReceiptText size={15}/>Customer receipt{!enabled.customer&&<small>Turned off</small>}</figcaption><ReceiptPreview kind="customer" family={draft.customerReceiptFamily as ReceiptFamily} business={preview} readyTime={draft.showOrderReadyTime==="YES"} off={!enabled.customer}/></figure>
        <figure><figcaption><ChefHat size={15}/>Kitchen ticket{!enabled.kitchen&&<small>Turned off</small>}</figcaption><ReceiptPreview kind="kitchen" family={draft.kitchenReceiptFamily as ReceiptFamily} business={preview} readyTime={false} off={!enabled.kitchen}/></figure>
        {draft.kitchenWaiterCopy==="YES"&&<figure><figcaption><ClipboardList size={15}/>Waiter copy (counter printer){!enabled.customer&&<small>Turned off</small>}</figcaption><ReceiptPreview kind="kitchen" waiterCopy family={draft.kitchenReceiptFamily as ReceiptFamily} business={preview} readyTime={false} off={!enabled.customer}/></figure>}
      </div>
    </section>

    <div className="printing-actions"><p>Applies to every counter.{mode==="QZ"&&<> Printers chosen under <b>This computer</b> override these on that PC only.</>}</p><Save/></div>
  </form>;
}
