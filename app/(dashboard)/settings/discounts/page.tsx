import { redirect } from "next/navigation";
import { requireUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { User } from "@/models/User";
import { MasterHeader } from "@/components/master-shell";
import { DiscountSettings } from "@/components/discount-settings";
import { businessDiscountTypes } from "@/lib/invoice-discount";

export default async function DiscountSettingsPage(){
 const user=await requireUser();if(user.role!=="OWNER")redirect("/access-denied");
 await connectToDatabase();
 const[business,account]=await Promise.all([Business.findOne({_id:user.businessId,isActive:true}).select("invoiceDiscountEnabled couponOnPayment discountTypes discountSmsNumbers smsEnabled").lean(),User.findById(user.id).select("twoFactorEnabled").lean()]);
 if(!business)return null;
 return <main className="master-page business-profile-page">
  <MasterHeader eyebrow="Business settings" title="Discounts" description="Choose which discounts cashiers can give when receiving payment, and who is told about them."/>
  <DiscountSettings initial={{enabled:business.invoiceDiscountEnabled===true,couponOnPayment:business.couponOnPayment!==false,types:businessDiscountTypes({...business,invoiceDiscountEnabled:true}),smsNumbers:business.discountSmsNumbers??[]}} twoFactorEnabled={account?.twoFactorEnabled===true} smsEnabled={business.smsEnabled===true}/>
 </main>;
}
