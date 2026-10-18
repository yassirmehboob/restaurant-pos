"use client";
import { useEffect,useRef,useState,useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Pencil,Plus,X } from "lucide-react";

const subscribe=()=>()=>{};
export function EntityModal({title,children,mode="add",label}:{title:string;children:React.ReactNode;mode?:"add"|"edit"|"icon";label?:string}){
  const ref=useRef<HTMLDialogElement>(null),mounted=useSyncExternalStore(subscribe,()=>true,()=>false),[isOpen,setIsOpen]=useState(false),[fullscreen,setFullscreen]=useState(false);
  useEffect(()=>{if(isOpen&&ref.current&&!ref.current.open)ref.current.showModal()},[isOpen]);
  const close=()=>{if(ref.current?.open)ref.current.close();else setIsOpen(false)};
  const dialog=isOpen?<dialog className={`entity-dialog ${fullscreen?"fullscreen":""}`} ref={ref} onClose={event=>{event.stopPropagation();if(event.target===event.currentTarget)setIsOpen(false)}} onCancel={event=>{event.stopPropagation();if(event.target===event.currentTarget){event.preventDefault();close()}}} onClick={event=>{if(event.target===ref.current)close()}}><div className="dialog-surface"><header><div><p className="eyebrow">Master data</p><h2>{title}</h2></div><button type="button" onClick={close} aria-label="Close"><X size={21}/></button></header><div className="dialog-body">{children}</div></div></dialog>:null;
  return <><button className={`modal-trigger ${mode}`} type="button" onClick={event=>{setFullscreen(title==="Add Item"||title==="Add Deal"||Boolean(event.currentTarget.closest(".item-card,.deal-card")));setIsOpen(true)}} aria-label={label??title}>{mode==="edit"?<Pencil size={15}/>:<Plus size={mode==="icon"?19:17}/>} {mode!=="icon"&&(label??(mode==="edit"?"Edit":"Add New"))}</button>{mounted&&dialog&&createPortal(dialog,document.body)}</>;
}
