import { requirePagePermission } from "@/data/auth";
import { createStaff,toggleActive,updateStaff } from "@/app/(dashboard)/master-actions";
import { EntityModal } from "@/components/entity-modal";
import { EmptyState,MasterForm,ToggleButton } from "@/components/master-data";
import { MasterHeader } from "@/components/master-shell";
import { StaffCatalog } from "@/components/staff-catalog";
import { connectToDatabase } from "@/lib/db";
import { Staff } from "@/models/Staff";

const roleLabels:Record<string,string>={WAITER:"Waiter",CASHIER:"Cashier",KITCHEN:"Kitchen",OTHER:"Other"};

export default async function StaffPage(){
  const user=await requirePagePermission("staff");await connectToDatabase();
  const rows=await Staff.find({businessId:user.businessId}).sort({isActive:-1,fullName:1}).lean();
  const fields=[{name:"fullName",label:"Full name",placeholder:"Ali Khan",required:true},{name:"role",label:"Role",type:"select" as const,required:true,options:[{value:"WAITER",label:"Waiter"},{value:"CASHIER",label:"Cashier"},{value:"KITCHEN",label:"Kitchen"},{value:"OTHER",label:"Other"}]},{name:"phone",label:"Phone",placeholder:"Optional"},{name:"code",label:"Staff code",placeholder:"W-01"}];
  const staff=rows.map(row=>{const id=String(row._id),name=String(row.fullName),role=String(row.role),phone=String(row.phone??""),code=String(row.code??"");const editFields=fields.map(field=>({...field,value:field.name==="fullName"?name:field.name==="role"?role:field.name==="phone"?phone:code}));const card=<article className={`staff-card ${!row.isActive?"inactive":""}`}><span className="staff-avatar">{name.charAt(0).toUpperCase()}</span><div className="staff-card-copy"><strong>{name}</strong><small>{roleLabels[role]??role}{code?` · ${code}`:""}</small><p>{phone||"No phone number"}</p></div><span className={`state ${row.isActive?"on":"off"}`}>{row.isActive?"Active":"Inactive"}</span><div className="staff-card-actions">{row.isActive&&<EntityModal title={`Update ${name}`} mode="edit"><MasterForm title="Update Staff Member" description="Edit staff details and role." action={updateStaff.bind(null,id)} fields={editFields}/></EntityModal>}<ToggleButton action={toggleActive.bind(null,"Staff",id)} label={row.isActive?"Deactivate":"Activate"} tone={row.isActive?"danger":"normal"} confirmText={row.isActive?`Deactivate ${name}? This staff member will no longer appear in active selections.`:undefined}/></div></article>;return{id,name,phone,code,role,isActive:Boolean(row.isActive),card}});
  return <main className="master-page staff-page"><MasterHeader eyebrow="Restaurant team" title="Staff & Waiters" description="View your team and add or update staff in a popup." actions={<EntityModal title="Add Staff Member" label="Add Staff"><MasterForm title="New Staff Member" description="Add operational staff without creating a login." action={createStaff} fields={fields}/></EntityModal>}/><section className="master-list full-page-list staff-catalog-shell"><div className="list-heading"><h2>All staff</h2><span>{rows.length} total</span></div>{!rows.length?<EmptyState title="No staff yet" copy="Add waiters and operational staff for order assignment."/>:<StaffCatalog staff={staff}/>}</section></main>;
}
