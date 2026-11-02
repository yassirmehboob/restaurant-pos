import { redirect } from "next/navigation";
import { requireUser } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { MasterHeader } from "@/components/master-shell";
import { SmsSettings } from "@/components/sms-settings";
import { DeliverySmsSettingsCard } from "@/components/delivery-sms-settings";
import { DEFAULT_PAYMENT_SMS,DELIVERY_SMS_STAGES,type DeliverySmsSettings } from "@/lib/sms-template";

export default async function SmsMessagingPage(){
 const user=await requireUser();if(user.role!=="OWNER")redirect("/access-denied");
 await connectToDatabase();
 const business=await Business.findOne({_id:user.businessId,isActive:true}).lean();
 if(!business)return null;
 const hasSmsToken=await Business.exists({_id:user.businessId,smsTokenEncrypted:{$type:"string",$ne:""}});
 const deliverySms=Object.fromEntries(DELIVERY_SMS_STAGES.map(stage=>{const config=business.smsDeliveryMessages?.[stage.key];return[stage.key,{enabled:config?.enabled===true,includeOptOut:config?.includeOptOut!==false,template:config?.template||stage.template}]})) as DeliverySmsSettings;
 return <main className="master-page business-profile-page">
  <MasterHeader eyebrow="Business settings" title="SMS Messaging" description="Manage your SMS subscription, payment receipts and delivery updates."/>
  <SmsSettings initial={{enabled:business.smsEnabled===true,paymentReceiptEnabled:business.smsPaymentReceiptEnabled===true,includeOptOut:business.smsIncludeOptOut!==false,template:business.smsPaymentTemplate||DEFAULT_PAYMENT_SMS,evidenceReference:business.smsEvidenceReference||"customer-acknowledgement"}} hasSavedToken={!!hasSmsToken} gatewayConfigured={!!process.env.SMS_API} businessName={business.name} currency={business.currency}/>
  <DeliverySmsSettingsCard initial={deliverySms} smsEnabled={business.smsEnabled===true} hasToken={!!hasSmsToken} businessName={business.name} currency={business.currency}/>
 </main>;
}
