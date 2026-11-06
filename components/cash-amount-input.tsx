"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { amountInWords, caretAfterFormatting, groupAmount, normalizeAmount } from "@/lib/amount-format";

// Shows the amount with commas and reads it back in words so the zeros are easy to check.
// The form receives the plain number through the hidden input.
export function CashAmountInput({id,name,label,max,required}:{id:string;name:string;label:string;max:number;required?:boolean}){
  const [amount,setAmount]=useState(""),input=useRef<HTMLInputElement>(null),caret=useRef<number|null>(null);
  const shown=groupAmount(amount);
  useLayoutEffect(()=>{
    if(caret.current===null||!input.current)return;
    const position=caretAfterFormatting(shown,caret.current);
    input.current.setSelectionRange(position,position);
    caret.current=null;
  },[shown]);
  return <div className="cash-amount-field">
    <label htmlFor={id}>{label}</label>
    <div className="cash-amount-control"><span aria-hidden="true">Rs</span><input ref={input} id={id} type="text" inputMode="decimal" autoComplete="off" placeholder="0" required={required} aria-describedby={`${id}-words`} value={shown} onChange={event=>{
      const typed=event.target.value,next=normalizeAmount(typed);
      if(Number(next)>max)return;
      caret.current=normalizeAmount(typed.slice(0,event.target.selectionStart??typed.length)).length;
      setAmount(next);
    }}/></div>
    <input type="hidden" name={name} value={amount}/>
    <p id={`${id}-words`} className={amount?"cash-amount-words has-amount":"cash-amount-words"} aria-live="polite">{amount?amountInWords(amount):"Count the cash in the drawer before you start."}</p>
  </div>;
}
