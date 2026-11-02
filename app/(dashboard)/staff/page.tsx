import Image from "next/image";
import { requirePagePermission } from "@/data/auth";
import { createStaff,toggleActive,updateStaff } from "@/app/(dashboard)/master-actions";
import { EntityModal } from "@/components/entity-modal";
import { EmptyState,MasterForm,ToggleButton } from "@/components/master-data";
import { MasterHeader } from "@/components/master-shell";
import { StaffCatalog } from "@/components/staff-catalog";
import { connectToDatabase } from "@/lib/db";
import { Staff } from "@/models/Staff";
import { STAFF_ROLE_LABELS,STAFF_ROLES } from "@/lib/roles";

const roleLabels:Record<string,string>=STAFF_ROLE_LABELS;

export default async function StaffPage(){
  const user=await requirePagePermission("staff");await connectToDatabase();
  const rows=await Staff.find({businessId:user.businessId}).sort({isActive:-1,fullName:1}).lean();
  const fields=[{name:"fullName",label:"Full name",placeholder:"Ali Khan",required:true},{name:"role",label:"Role",type:"select" as const,required:true,options:STAFF_ROLES.map(value=>({value,label:STAFF_ROLE_LABELS[value]}))},{name:"phone",label:"Phone",placeholder:"Optional"},{name:"cnic",label:"CNIC No.",placeholder:"12345-1234567-1 (optional)"},{name:"address",label:"Address",placeholder:"Optional"},{name:"remarks",label:"Remarks",type:"textarea" as const,placeholder:"Optional"},{name:"photo",label:"Photo (optional)",type:"file" as const}];
  const staff=rows.map(row=>{const id=String(row._id),name=String(row.fullName),role=String(row.role),phone=String(row.phone??""),cnic=String(row.cnic??""),address=String(row.address??""),remarks=String(row.remarks??"");const values:Record<string,string>={fullName:name,role,phone,cnic,address,remarks};const photo=row.photoPath?`/api/staff-photos/${id}?v=${new Date(row.updatedAt??0).getTime()}`:"";const editFields=fields.map(field=>field.type==="file"?{...field,label:photo?"Replace photo (optional)":field.label,value:photo||undefined}:{...field,value:values[field.name]});const card=<article className={`staff-card ${!row.isActive?"inactive":""}`}><span className="staff-avatar">{photo?<Image src={photo} alt={name} fill sizes="104px" unoptimized/>:name.charAt(0).toUpperCase()}</span><div className="staff-card-copy"><strong>{name}</strong><small>{roleLabels[role]??role}</small><dl className="staff-card-info">{([["Phone",phone],["CNIC",cnic],["Address",address],["Remarks",remarks]] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd className={value?"":"empty"} title={value||undefined}>{value||"—"}</dd></div>)}</dl></div><span className={`state ${row.isActive?"on":"off"}`}>{row.isActive?"Active":"Inactive"}</span><div className="staff-card-actions">{row.isActive&&<EntityModal title={`Update ${name}`} mode="edit"><MasterForm title="Update Staff Member" description="Edit staff details and role." action={updateStaff.bind(null,id)} fields={editFields}/></EntityModal>}<ToggleButton action={toggleActive.bind(null,"Staff",id)} label={row.isActive?"Deactivate":"Activate"} tone={row.isActive?"danger":"normal"} confirmText={row.isActive?`Deactivate ${name}? This staff member will no longer appear in active selections.`:undefined}/></div></article>;return{id,name,phone,cnic,role,isActive:Boolean(row.isActive),card}});
  return <main className="master-page staff-page"><MasterHeader eyebrow="Restaurant team" title="Staff & Waiters" description="View your team and add or update staff in a popup." actions={<EntityModal title="Add Staff Member" label="Add Staff"><MasterForm title="New Staff Member" description="Add operational staff without creating a login." action={createStaff} fields={fields}/></EntityModal>}/><section className="master-list full-page-list staff-catalog-shell"><div className="list-heading"><h2>All staff</h2><span>{rows.length} total</span></div>{!rows.length?<EmptyState title="No staff yet" copy="Add waiters and operational staff for order assignment."/>:<StaffCatalog staff={staff}/>}</section></main>;
}
