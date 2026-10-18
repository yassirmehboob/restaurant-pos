"use client";
import { createContext,useContext,useState } from "react";
import { Eye,EyeOff } from "lucide-react";
const Context=createContext({visible:false,toggle:()=>{}});
export function DashboardPrivacy({children}:{children:React.ReactNode}){const[visible,setVisible]=useState(false);return <Context.Provider value={{visible,toggle:()=>setVisible(value=>!value)}}>{children}</Context.Provider>}
export function DashboardAmount({value}:{value:string}){const{visible}=useContext(Context);return <span className="dashboard-amount">{visible?value:"Rs *****"}</span>}
export function DashboardAmountToggle(){const{visible,toggle}=useContext(Context);return <button className="dashboard-amount-toggle" type="button" aria-label={visible?"Hide dashboard amounts":"Show dashboard amounts"} aria-pressed={visible} onClick={toggle}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}<span>{visible?"Hide amounts":"Show amounts"}</span></button>}
