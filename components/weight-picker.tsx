"use client";
import { useState } from "react";
import { Scale,X } from "lucide-react";
import { formatWeight,MAX_WEIGHT_GRAMS,MIN_WEIGHT_GRAMS,QUICK_WEIGHTS,validWeight,weightPrice } from "@/lib/weight";

const currency=(amount:number)=>`Rs ${amount.toLocaleString("en-PK",{maximumFractionDigits:2})}`;

// Weight entry for items sold per KG: quick weights for the common portions, or a typed weight in KG or grams.
export function WeightPicker({name,pricePerKg,initialGrams,onSelect,onClose}:{name:string;pricePerKg?:number;initialGrams?:number;onSelect:(grams:number)=>void;onClose:()=>void}){
  const[unit,setUnit]=useState<"KG"|"G">(initialGrams&&initialGrams<1000?"G":"KG"),[value,setValue]=useState(initialGrams?String(initialGrams<1000?initialGrams:initialGrams/1000):"");
  const typed=Number(value),grams=value.trim()&&Number.isFinite(typed)?Math.round(unit==="KG"?typed*1000:typed):0,valid=validWeight(grams);
  const error=!value.trim()||valid?"":grams<MIN_WEIGHT_GRAMS?`The smallest weight is ${formatWeight(MIN_WEIGHT_GRAMS)}.`:grams>MAX_WEIGHT_GRAMS?`The largest weight is ${formatWeight(MAX_WEIGHT_GRAMS)}.`:"Enter a valid weight.";
  return <div className="variant-picker-overlay" role="dialog" aria-modal="true" aria-label={`Select weight for ${name}`}><section className="weight-picker">
    <header><div><span>Select weight{pricePerKg!==undefined&&` · ${currency(pricePerKg)} / KG`}</span><h2>{name}</h2></div><button type="button" onClick={onClose} aria-label="Close weight selector"><X size={20}/></button></header>
    <div className="weight-picker-quick">{QUICK_WEIGHTS.map(option=><button type="button" key={option} aria-pressed={option===initialGrams} onClick={()=>onSelect(option)}><span>{formatWeight(option)}</span>{pricePerKg!==undefined&&<strong>{currency(weightPrice(pricePerKg,option))}</strong>}</button>)}</div>
    <form className="weight-picker-custom" onSubmit={event=>{event.preventDefault();if(valid)onSelect(grams)}}>
      <label htmlFor="weight-picker-value">Other weight</label>
      <div><input id="weight-picker-value" value={value} onChange={event=>setValue(event.target.value)} inputMode="decimal" placeholder={unit==="KG"?"1.75":"350"}/><div className="weight-picker-units" role="group" aria-label="Weight unit">{(["KG","G"] as const).map(option=><button type="button" key={option} aria-pressed={unit===option} onClick={()=>setUnit(option)}>{option==="KG"?"KG":"g"}</button>)}</div></div>
      {error?<small className="weight-picker-error">{error}</small>:valid?<small><Scale size={14}/>{formatWeight(grams)}{pricePerKg!==undefined&&<> = <strong>{currency(weightPrice(pricePerKg,grams))}</strong></>}</small>:<small>Type the weight, e.g. 1.75 KG or 350 g.</small>}
      <button type="submit" disabled={!valid}>{initialGrams?"Update weight":"Add to order"}</button>
    </form>
  </section></div>;
}
