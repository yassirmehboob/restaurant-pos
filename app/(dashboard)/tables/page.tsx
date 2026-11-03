import { requirePagePermission } from "@/data/auth";
import { createTable,toggleActive,updateTable } from "@/app/(dashboard)/master-actions";
import { EntityModal } from "@/components/entity-modal";
import { EmptyState,MasterForm,ToggleButton } from "@/components/master-data";
import { MasterHeader } from "@/components/master-shell";
import { TableCatalog } from "@/components/table-catalog";
import { TableQrActions } from "@/components/table-qr-actions";
import { QrCode } from "lucide-react";
import { connectToDatabase } from "@/lib/db";
import { RestaurantTable } from "@/models/RestaurantTable";

export default async function TablesPage(){
  const user=await requirePagePermission("tables");await connectToDatabase();
  const qrAdmin=["OWNER","ADMIN"].includes(user.role);
  const rows=await RestaurantTable.find({businessId:user.businessId}).sort({isActive:-1,sortOrder:1,name:1}).lean();
  const fields=[{name:"name",label:"Table name",placeholder:"Table 1",required:true},{name:"number",label:"Table number",type:"number" as const,min:1,placeholder:"1"},{name:"area",label:"Area",placeholder:"Main Hall"},{name:"capacity",label:"Capacity",type:"number" as const,min:1,placeholder:"4"},{name:"sortOrder",label:"Display order",type:"number" as const,min:0,required:true,value:0}];
  const tables=rows.map(row=>{const id=String(row._id),name=String(row.name),number=row.number==null?"":String(row.number),area=String(row.area??""),capacity=Number(row.capacity??0);const editFields=fields.map(field=>({...field,value:field.name==="name"?name:field.name==="number"?number:field.name==="area"?area:field.name==="capacity"?(row.capacity??""):row.sortOrder}));const card=<article className={`restaurant-table-card ${!row.isActive?"inactive":""}`}><span className="restaurant-table-number">{number||"—"}</span><div className="restaurant-table-copy"><strong>{name}</strong><small>{area||"No area"}</small><p>{capacity?`${capacity} seat${capacity===1?"":"s"}`:"Capacity not set"} · Display order {row.sortOrder}</p></div><span className={`state ${row.isActive?"on":"off"}`}>{row.isActive?"Active":"Inactive"}</span><div className="restaurant-table-actions">{row.isActive&&qrAdmin&&<TableQrActions id={id} name={name}/>}{row.isActive&&<EntityModal title={`Update ${name}`} mode="edit"><MasterForm title="Update Table" description="Edit table name, area, capacity, or order." action={updateTable.bind(null,id)} fields={editFields}/></EntityModal>}<ToggleButton action={toggleActive.bind(null,"RestaurantTable",id)} label={row.isActive?"Deactivate":"Activate"} tone={row.isActive?"danger":"normal"} confirmText={row.isActive?`Deactivate ${name}? This table will no longer appear in active dine-in selections.`:undefined}/></div></article>;return{id,name,number,area,capacity,isActive:Boolean(row.isActive),card}});
  return <main className="master-page tables-page"><MasterHeader eyebrow="Dining room" title="Restaurant Tables" description="View your floor setup and add or update tables in a popup." actions={<>{qrAdmin&&rows.some(row=>row.isActive)&&<a className="table-qr-print-all" href="/print/table-qr/all" target="_blank" rel="noopener"><QrCode size={17}/>Print all QR cards</a>}<EntityModal title="Add Table" label="Add Table"><MasterForm title="New Table" description="Create a table for dine-in assignment." action={createTable} fields={fields}/></EntityModal></>}/><section className="master-list full-page-list table-catalog-shell"><div className="list-heading"><h2>All tables</h2><span>{rows.length} total</span></div>{!rows.length?<EmptyState title="No tables yet" copy="Add your dining room tables for dine-in orders."/>:<TableCatalog tables={tables}/>}</section></main>;
}
