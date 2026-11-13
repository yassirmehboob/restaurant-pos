"use client";
import { useMemo,useState } from "react";
import { Coffee,Minus,Plus,Sparkles,TriangleAlert,UtensilsCrossed } from "lucide-react";
import type { MasterState } from "@/app/(dashboard)/master-actions";
import { EntityModal } from "@/components/entity-modal";
import { DealItems,MasterForm,type FormField } from "@/components/master-data";
import { DEAL_PROFIT_KEPT,type DealPricingProduct } from "@/lib/deal-pricing";
import { SALES_WINDOW_DAYS,rankProducts,suggestDeals,type ExistingDeal,type MenuProduct,type SuggestedDeal } from "@/lib/deal-suggestions";

type ItemOption={value:string;label:string}&DealPricingProduct;
const QUICK_PERSONS=[1,2,3,4,6,8];
const rupees=(amount:number)=>`Rs ${Math.round(amount).toLocaleString()}`;

// "Suggested Deals": deal ideas from the best sellers for a chosen number of persons, each opening the normal deal form pre-filled.
export function SuggestedDeals({menu,existing,products,fields,createDeal}:{menu:MenuProduct[];existing:ExistingDeal[];products:ItemOption[];fields:FormField[];createDeal:(state:MasterState,data:FormData)=>Promise<MasterState>}){
  const[persons,setPersons]=useState(2);
  const result=useMemo(()=>suggestDeals(menu,persons,{existing}),[menu,persons,existing]);
  const best=useMemo(()=>rankProducts(menu).filter(item=>item.sold>0).slice(0,8),[menu]);
  const setPeople=(value:number)=>setPersons(Math.min(20,Math.max(1,Math.round(value)||1)));
  const card=(deal:SuggestedDeal)=>{
    const saving=deal.total-deal.price,percent=deal.total?Math.round(saving/deal.total*100):0,margin=deal.price?Math.round((deal.price-deal.cost)/deal.price*100):0;
    const filled=fields.map(field=>({...field,value:field.name==="name"?deal.name:field.name==="salePrice"?deal.price:field.name==="description"?deal.description:field.value}));
    return <article className="suggested-deal" key={deal.key}>
      <header><strong>{deal.name}</strong><span>Serves {deal.persons}</span></header>
      <p className="suggested-deal-reason"><Sparkles size={14}/>{deal.reason}</p>
      <ul>{deal.items.map(item=><li key={`${item.productId}:${item.variantName??""}`}><b>{item.quantity}×</b>{item.name}</li>)}</ul>
      {deal.similarTo&&<p className="suggested-deal-similar"><TriangleAlert size={14}/>You already have a deal with these items: {deal.similarTo}</p>}
      <div className="suggested-deal-prices"><div><span>Items total</span><s>{rupees(deal.total)}</s></div><div><span>Suggested price</span><strong>{rupees(deal.price)}</strong></div><div><span>Customer saves</span><em>{rupees(saving)} ({percent}%)</em></div><div><span>Your margin</span><em>{margin}%</em></div></div>
      <EntityModal title="Add Deal" label="Create this deal" className="suggested-deal-create"><MasterForm layout="deal" title="New Deal" description="Change anything you want before saving." action={createDeal} fields={filled}><DealItems products={products} initialItems={deal.items.map(item=>({productId:item.productId,quantity:item.quantity,weightGrams:item.weightGrams,variantName:item.variantName}))}/></MasterForm></EntityModal>
    </article>;
  };
  return <EntityModal title="Suggested Deals" label="Suggested Deals" eyebrow="Deal ideas" fullscreen icon={<Sparkles size={17}/>} className="suggested-deals-trigger">
    <div className="suggested-deals">
      <section className="suggested-deals-toolbar">
        <div><strong>How many persons?</strong><span>Portions, sizes and drinks adjust to the group.</span></div>
        <div className="persons-picker">
          <div className="persons-quick" role="group" aria-label="Persons">{QUICK_PERSONS.map(count=><button type="button" key={count} aria-pressed={persons===count} onClick={()=>setPeople(count)}>{count}</button>)}</div>
          <div className="persons-stepper"><button type="button" onClick={()=>setPeople(persons-1)} aria-label="Fewer persons"><Minus size={16}/></button><input type="number" min="1" max="20" value={persons} onChange={event=>setPeople(Number(event.target.value))} aria-label="Persons"/><button type="button" onClick={()=>setPeople(persons+1)} aria-label="More persons"><Plus size={16}/></button></div>
        </div>
      </section>
      <p className="suggested-deals-basis">{result.anySales?<>Built from what sold most in the last {SALES_WINDOW_DAYS} days, highest first. Top sellers: {best.map(item=>`${item.name} (${item.sold})`).join(", ")}.</>:<>No paid sales in the last {SALES_WINDOW_DAYS} days yet, so ideas follow your menu order.</>} Prices keep {DEAL_PROFIT_KEPT*100}% of the normal profit; you can change everything before saving.</p>
      <section className="suggested-deals-group"><h3><UtensilsCrossed size={18}/>Lunch &amp; dinner deals</h3>{result.regular.length?<div className="suggested-deals-grid">{result.regular.map(card)}</div>:<p className="suggested-deals-empty">Add active main items to get deal ideas.</p>}</section>
      <section className="suggested-deals-group"><h3><Coffee size={18}/>Breakfast deals</h3>{result.breakfast.length?<div className="suggested-deals-grid">{result.breakfast.map(card)}</div>:<p className="suggested-deals-empty">{result.hasBreakfast?"Add more breakfast items to get breakfast deal ideas.":"No breakfast category yet. Name a category \"Breakfast\" (or \"Nashta\") and its items get their own deals, kept apart from lunch and dinner."}</p>}</section>
    </div>
  </EntityModal>;
}
