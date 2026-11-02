"use client";
import type { InputHTMLAttributes } from "react";

// Keeps digits and a single decimal point, so "12." can be typed on the way to "12.5".
export const cleanDecimal=(value:string)=>{const [whole,...rest]=value.replace(/[^\d.]/g,"").split(".");return rest.length?`${whole}.${rest.join("")}`:whole};

// Amount/percentage box. A type="number" input changes its value when the mouse wheel scrolls over it,
// so this is a text input that brings up the numeric keypad on touch screens.
export function DecimalInput({value,onValue,...props}:{value:string;onValue:(value:string)=>void}&Omit<InputHTMLAttributes<HTMLInputElement>,"value"|"onChange"|"type">){
 return <input {...props} type="text" inputMode="decimal" autoComplete="off" value={value} onChange={event=>onValue(cleanDecimal(event.target.value))}/>;
}
