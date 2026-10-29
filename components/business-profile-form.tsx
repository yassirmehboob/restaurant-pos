"use client";

import Image from "next/image";
import { useEffect,useId,useRef,useState,useTransition } from "react";
import { Building2,Check,ImagePlus,LoaderCircle } from "lucide-react";
import { updateBusinessProfile } from "@/app/(dashboard)/settings/business/actions";
import type { MasterState } from "@/app/(dashboard)/master-actions";

type Profile={name:string;legalName:string;phone:string;email:string;address:string;city:string;country:string;taxNumber:string;currency:string;timezone:string};
type Field={name:keyof Profile;label:string;required?:boolean;type?:"email"|"tel"|"textarea";autoComplete?:string;maxLength:number;placeholder?:string;wide?:boolean};
const groups:{title:string;description:string;fields:Field[]}[]=[
 {title:"Business identity",description:"How your restaurant is identified on receipts.",fields:[{name:"name",label:"Restaurant name",required:true,maxLength:120,autoComplete:"organization"},{name:"legalName",label:"Legal business name",maxLength:160}]},
 {title:"Contact & location",description:"Help customers find and contact your restaurant.",fields:[{name:"phone",label:"Contact number",type:"tel",required:true,maxLength:30,autoComplete:"tel"},{name:"email",label:"Business email",type:"email",maxLength:254,autoComplete:"email",placeholder:"hello@yourrestaurant.com"},{name:"address",label:"Street address",type:"textarea",required:true,maxLength:500,autoComplete:"street-address",wide:true},{name:"city",label:"City",maxLength:100,autoComplete:"address-level2"},{name:"country",label:"Country",maxLength:100,autoComplete:"country-name"}]},
 {title:"Regional & tax",description:"Your local business details and receipt currency.",fields:[{name:"currency",label:"Currency code",required:true,maxLength:3,placeholder:"PKR"},{name:"timezone",label:"Time zone",required:true,maxLength:80,placeholder:"Asia/Karachi"},{name:"taxNumber",label:"Tax registration number",maxLength:80,wide:true}]},
];

export function BusinessProfileForm({initial,logoUrl}:{initial:Profile;logoUrl?:string}){
 const id=useId(),fileInput=useRef<HTMLInputElement>(null);
 const [values,setValues]=useState(initial),[saved,setSaved]=useState(initial),[preview,setPreview]=useState("");
 const [hasLogoChange,setHasLogoChange]=useState(false),[fileName,setFileName]=useState(""),[state,setState]=useState<MasterState>();
 const [pending,start]=useTransition();
 const dirty=hasLogoChange||Object.keys(values).some(key=>values[key as keyof Profile]!==saved[key as keyof Profile]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);

 return <form className="business-profile-card" aria-labelledby={`${id}-title`} onSubmit={event=>{
  event.preventDefault();if(pending||!dirty)return;
  const data=new FormData(event.currentTarget),submitted={...values};setState(undefined);
  start(async()=>{
   try{const result=await updateBusinessProfile(undefined,data);setState(result);if(result?.ok){setSaved(submitted);setHasLogoChange(false);setFileName("");if(fileInput.current)fileInput.current.value=""}}
   catch{setState({message:"Could not save your restaurant details. Please try again."})}
  });
 }}>
  <header className="business-profile-header"><span aria-hidden="true"><Building2 size={21} strokeWidth={1.7}/></span><div><h2 id={`${id}-title`}>Restaurant Details</h2><p>Your restaurant’s identity, contact information, and local preferences.</p></div></header>
  <fieldset className="business-profile-fields" disabled={pending}>
   <legend className="business-profile-sr-only">Restaurant profile</legend>
   <div className="business-profile-brand">
    <div className="business-profile-logo">{preview||logoUrl?<Image src={preview||logoUrl!} alt="Restaurant logo" fill sizes="72px" unoptimized/>:<span aria-hidden="true">{values.name.trim().charAt(0).toUpperCase()||<Building2 size={26}/>}</span>}</div>
    <div className="business-profile-brand-copy"><h3>Restaurant logo</h3><p>Displayed on receipts and your restaurant workspace.</p><small>{fileName||"JPG, PNG, or WebP · Up to 5 MB"}</small></div>
    <input ref={fileInput} type="file" name="logo" accept="image/jpeg,image/png,image/webp" aria-label="Choose restaurant logo" className="business-profile-sr-only" tabIndex={-1} onChange={event=>{
     const file=event.target.files?.[0];if(!file)return;
     if(file.size>5*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type)){setState({message:"Choose a JPG, PNG, or WebP image up to 5 MB."});event.target.value="";setHasLogoChange(false);setFileName("");setPreview("");return}
     setPreview(URL.createObjectURL(file));setFileName(file.name);setHasLogoChange(true);setState(undefined);
    }}/>
    <button type="button" className="business-profile-upload" onClick={()=>fileInput.current?.click()}><ImagePlus size={16}/>{logoUrl||preview?"Change logo":"Upload logo"}</button>
   </div>
   {groups.map(group=><section className="business-profile-section" key={group.title} aria-labelledby={`${id}-${group.fields[0].name}-group`}>
    <div className="business-profile-section-intro"><h3 id={`${id}-${group.fields[0].name}-group`}>{group.title}</h3><p>{group.description}</p></div>
    <div className="business-profile-grid">{group.fields.map(field=>{
     const inputId=`${id}-${field.name}`,errors=state?.errors?.[field.name];
     const shared={id:inputId,name:field.name,value:values[field.name],required:field.required,maxLength:field.maxLength,autoComplete:field.autoComplete,placeholder:field.placeholder,"aria-invalid":errors?.length?true:undefined,"aria-describedby":errors?.length?`${inputId}-error`:undefined,onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>{setValues(current=>({...current,[field.name]:event.target.value}));setState(undefined)}};
     return <div className={`business-profile-field${field.wide?" is-wide":""}`} key={field.name}><label htmlFor={inputId}>{field.label}{field.required?<span className="business-profile-required" aria-label="required"> *</span>:<small>Optional</small>}</label>{field.type==="textarea"?<textarea {...shared} rows={2} minLength={5}/>:<input {...shared} type={field.type??"text"} minLength={field.name==="name"?2:field.name==="phone"?7:field.name==="currency"||field.name==="timezone"?3:undefined} spellCheck={field.name==="currency"||field.name==="timezone"?false:undefined}/>} {errors?.length&&<span className="business-profile-field-error" id={`${inputId}-error`}>{errors[0]}</span>}</div>;
    })}</div>
   </section>)}
  </fieldset>
  <footer className="business-profile-footer"><div className={`business-profile-feedback${state?.message&&!state.ok?" is-error":""}`} role="status" aria-live="polite">{state?.ok&&<Check size={16}/>}<span>{state?.message??(state?.errors?"Check the highlighted fields.":dirty?"You have unsaved changes.":"Keep these details up to date for your customers.")}</span></div><div className="business-profile-actions"><button type="button" disabled={pending||!dirty} onClick={()=>{setValues({...saved});setPreview("");setHasLogoChange(false);setFileName("");setState(undefined);if(fileInput.current)fileInput.current.value=""}}>Discard</button><button type="submit" disabled={pending||!dirty}>{pending&&<LoaderCircle className="waiter-settings-spinner" size={16}/>}<span>{pending?"Saving…":"Save details"}</span></button></div></footer>
 </form>;
}
