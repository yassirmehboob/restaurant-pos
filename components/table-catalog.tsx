"use client";

import { useMemo,useState } from "react";
import { Search,SlidersHorizontal } from "lucide-react";

type TableEntry={id:string;name:string;number:string;area:string;capacity:number;isActive:boolean;card:React.ReactNode};

export function TableCatalog({tables}:{tables:TableEntry[]}){
  const[query,setQuery]=useState(""),[area,setArea]=useState("ALL"),[status,setStatus]=useState("ALL");
  const areas=useMemo(()=>[...new Set(tables.map(table=>table.area).filter(Boolean))].sort(),[tables]);
  const filtered=useMemo(()=>{const normalized=query.trim().toLowerCase();return tables.filter(table=>{
    const matchesQuery=!normalized||[table.name,table.number,table.area,String(table.capacity||"")].some(value=>value.toLowerCase().includes(normalized));
    return matchesQuery&&(area==="ALL"||table.area===area)&&(status==="ALL"||(status==="ACTIVE"?table.isActive:!table.isActive));
  })},[tables,query,area,status]);
  return <><div className="table-filter-bar"><label className="item-search"><Search size={18}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search table name, number, area, or capacity..." aria-label="Search tables"/></label><label><span>Area</span><select value={area} onChange={event=>setArea(event.target.value)}><option value="ALL">All areas</option>{areas.map(option=><option value={option} key={option}>{option}</option>)}</select></label><label><span>Status</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="DEACTIVATED">Deactivated</option></select></label><div className="filter-count"><SlidersHorizontal size={16}/>{filtered.length} of {tables.length}</div></div>{filtered.length?<div className="restaurant-table-card-grid">{filtered.map(table=><div key={table.id}>{table.card}</div>)}</div>:<div className="filtered-empty"><Search size={24}/><strong>No matching tables</strong><p>Try changing the search, area, or status filter.</p></div>}</>;
}
