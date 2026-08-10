"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";

type CustomerEntry = { id:string; name:string; phone:string; email:string; area:string; isActive:boolean; card:React.ReactNode };

export function CustomerCatalog({customers}:{customers:CustomerEntry[]}) {
  const [query,setQuery]=useState("");
  const [area,setArea]=useState("ALL");
  const [status,setStatus]=useState("ALL");
  const areas=useMemo(()=>[...new Set(customers.map(customer=>customer.area).filter(Boolean))].sort(),[customers]);
  const filtered=useMemo(()=>{const normalized=query.trim().toLowerCase();return customers.filter(customer=>{
    const matchesQuery=!normalized||[customer.name,customer.phone,customer.email,customer.area].some(value=>value.toLowerCase().includes(normalized));
    return matchesQuery&&(area==="ALL"||customer.area===area)&&(status==="ALL"||(status==="ACTIVE"?customer.isActive:!customer.isActive));
  })},[customers,query,area,status]);
  return <><div className="customer-filter-bar"><label className="item-search"><Search size={18}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search name, phone, email, or area..." aria-label="Search customers"/></label><label><span>Area</span><select value={area} onChange={event=>setArea(event.target.value)}><option value="ALL">All areas</option>{areas.map(option=><option value={option} key={option}>{option}</option>)}</select></label><label><span>Status</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="DEACTIVATED">Deactivated</option></select></label><div className="filter-count"><SlidersHorizontal size={16}/>{filtered.length} of {customers.length}</div></div>{filtered.length?<div className="customer-card-grid">{filtered.map(customer=><div key={customer.id}>{customer.card}</div>)}</div>:<div className="filtered-empty"><Search size={24}/><strong>No matching customers</strong><p>Try changing the search, area, or status filter.</p></div>}</>;
}
