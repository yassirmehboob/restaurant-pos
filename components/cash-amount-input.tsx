"use client";
import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { amountInWords, caretAfterFormatting, groupAmount, normalizeAmount } from "@/lib/amount-format";

type AmountBoxProps={value:string;onValue:(amount:string)=>void;max:number}&Omit<InputHTMLAttributes<HTMLInputElement>,"value"|"onChange"|"type"|"max">;

// "Rs" box that shows the amount with commas while typing and keeps the caret in place.
// value/onValue carry the plain amount ("125000.5"), never the commas.
export function AmountBox({value,onValue,max,...props}:AmountBoxProps){
  const input=useRef<HTMLInputElement>(null),caret=useRef<number|null>(null);
  const shown=groupAmount(value);
  useLayoutEffect(()=>{
    if(caret.current===null||!input.current)return;
    const position=caretAfterFormatting(shown,caret.current);
    input.current.setSelectionRange(position,position);
    caret.current=null;
  },[shown]);
  return <div className="cash-amount-control"><span aria-hidden="true">Rs</span><input {...props} ref={input} type="text" inputMode="decimal" autoComplete="off" value={shown} onChange={event=>{
    const typed=event.target.value,next=normalizeAmount(typed);
    if(Number(next)>max)return;
    caret.current=normalizeAmount(typed.slice(0,event.target.selectionStart??typed.length)).length;
    onValue(next);
  }}/></div>;
}

// The amount read back in words, so the zeros are easy to check.
export function AmountWords({id,amount,hint}:{id:string;amount:string;hint:string}){
  return <p id={id} className={amount?"cash-amount-words has-amount":"cash-amount-words"} aria-live="polite">{amount?amountInWords(amount):hint}</p>;
}

// Form field version: the form receives the plain number through the hidden input.
export function CashAmountInput({id,name,label,max,required}:{id:string;name:string;label:string;max:number;required?:boolean}){
  const [amount,setAmount]=useState("");
  return <div className="cash-amount-field">
    <label htmlFor={id}>{label}</label>
    <AmountBox id={id} value={amount} onValue={setAmount} max={max} placeholder="0" required={required} aria-describedby={`${id}-words`}/>
    <input type="hidden" name={name} value={amount}/>
    <AmountWords id={`${id}-words`} amount={amount} hint="Count the cash in the drawer before you start."/>
  </div>;
}
