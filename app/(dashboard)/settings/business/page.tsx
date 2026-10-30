import { WaiterSettings } from "@/components/waiter-settings";
import { PaymentSettings } from "@/components/payment-settings";
import { BusinessTaxSettings } from "@/components/business-tax-settings";
import { requirePagePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { BusinessProfileForm } from "@/components/business-profile-form";
import { MasterHeader } from "@/components/master-shell";
import { SmsSettings } from "@/components/sms-settings";
import { DeliverySmsSettingsCard } from "@/components/delivery-sms-settings";
import { DEFAULT_PAYMENT_SMS,DELIVERY_SMS_STAGES,type DeliverySmsSettings } from "@/lib/sms-template";

export default async function BusinessSettingsPage(){
 const user=await requirePagePermission("settings");
 await connectToDatabase();
 const business=await Business.findOne({_id:user.businessId,isActive:true}).lean();
 if(!business)return null;
 const hasSmsToken=user.role==="OWNER"?await Business.exists({_id:user.businessId,smsTokenEncrypted:{$type:"string",$ne:""}}):null;
 const deliverySms=Object.fromEntries(DELIVERY_SMS_STAGES.map(stage=>{const config=business.smsDeliveryMessages?.[stage.key];return[stage.key,{enabled:config?.enabled===true,includeOptOut:config?.includeOptOut!==false,template:config?.template||stage.template}]})) as DeliverySmsSettings;
 return <main className="master-page business-profile-page">
  <MasterHeader eyebrow="Business settings" title="Business Profile" description="Manage your restaurant details and team preferences."/>
  <BusinessProfileForm logoUrl={business.logoUrl} initial={{name:business.name,legalName:business.legalName??"",phone:business.phone??"",email:business.email??"",address:business.address??"",city:business.city??"",country:business.country??"Pakistan",taxNumber:business.taxNumber??"",currency:business.currency,timezone:business.timezone}}/>
  {user.role==="OWNER"&&<><WaiterSettings show={business.waiterShowBillSummary===true}/><PaymentSettings prefill={business.paymentPrefillDueAmount!==false}/><BusinessTaxSettings rate={business.saleTaxRate??0} overrides={{CASH:business.paymentTaxRates?.CASH??null,CARD:business.paymentTaxRates?.CARD??null,BANK:business.paymentTaxRates?.BANK??null,OTHER:business.paymentTaxRates?.OTHER??null}}/></>}
  {user.role==="OWNER"&&<SmsSettings initial={{enabled:business.smsEnabled===true,paymentReceiptEnabled:business.smsPaymentReceiptEnabled===true,includeOptOut:business.smsIncludeOptOut!==false,template:business.smsPaymentTemplate||DEFAULT_PAYMENT_SMS,evidenceReference:business.smsEvidenceReference||"customer-acknowledgement"}} hasSavedToken={!!hasSmsToken} gatewayConfigured={!!process.env.SMS_API} businessName={business.name} currency={business.currency}/>}
  {user.role==="OWNER"&&<DeliverySmsSettingsCard initial={deliverySms} smsEnabled={business.smsEnabled===true} hasToken={!!hasSmsToken} businessName={business.name} currency={business.currency}/>}
 </main>;
}
