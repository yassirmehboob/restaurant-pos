"use client";

import { useMemo,useState } from "react";
import { Search,SlidersHorizontal } from "lucide-react";

type StaffEntry={id:string;name:string;phone:string;code:string;role:string;isActive:boolean;card:React.ReactNode};

export function StaffCatalog({staff}:{staff:StaffEntry[]}){
  const[query,setQuery]=useState(""),[role,setRole]=useState("ALL"),[status,setStatus]=useState("ALL");
  const filtered=useMemo(()=>{const normalized=query.trim().toLowerCase();return staff.filter(member=>{
    const matchesQuery=!normalized||[member.name,member.phone,member.code,member.role].some(value=>value.toLowerCase().includes(normalized));
    return matchesQuery&&(role==="ALL"||member.role===role)&&(status==="ALL"||(status==="ACTIVE"?member.isActive:!member.isActive));
  })},[staff,query,role,status]);
  return <><div className="staff-filter-bar"><label className="item-search"><Search size={18}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search name, phone, or staff code..." aria-label="Search staff"/></label><label><span>Role</span><select value={role} onChange={event=>setRole(event.target.value)}><option value="ALL">All roles</option><option value="WAITER">Waiter</option><option value="CASHIER">Cashier</option><option value="KITCHEN">Kitchen</option><option value="OTHER">Other</option></select></label><label><span>Status</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="DEACTIVATED">Deactivated</option></select></label><div className="filter-count"><SlidersHorizontal size={16}/>{filtered.length} of {staff.length}</div></div>{filtered.length?<div className="staff-card-grid">{filtered.map(member=><div key={member.id}>{member.card}</div>)}</div>:<div className="filtered-empty"><Search size={24}/><strong>No matching staff</strong><p>Try changing the search, role, or status filter.</p></div>}</>;
}
