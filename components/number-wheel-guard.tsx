"use client";
import { useEffect } from "react";

// Browsers change a focused number input when the mouse wheel scrolls over it. Blurring it first
// lets the wheel scroll the page instead, so prices and amounts are never changed by accident.
export function NumberWheelGuard(){
 useEffect(()=>{
  const onWheel=(event:WheelEvent)=>{const target=event.target;if(target instanceof HTMLInputElement&&target.type==="number"&&target===document.activeElement)target.blur()};
  document.addEventListener("wheel",onWheel,{capture:true,passive:true});
  return()=>document.removeEventListener("wheel",onWheel,{capture:true});
 },[]);
 return null;
}
