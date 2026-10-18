"use client";
import { createContext,useContext } from "react";
import type { Privilege } from "@/lib/permissions";
const Context=createContext<readonly Privilege[]>([]);
export function PermissionProvider({privileges,children}:{privileges:Privilege[];children:React.ReactNode}){return <Context.Provider value={privileges}>{children}</Context.Provider>}
export function useCan(){const privileges=useContext(Context);return (permission:Privilege)=>privileges.includes(permission)}
