import { WaiterSettings } from "@/components/waiter-settings";
import { QrOrderingSettings } from "@/components/qr-ordering-settings";
import { PaymentSettings } from "@/components/payment-settings";
import { BusinessTaxSettings } from "@/components/business-tax-settings";
import { requirePagePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { Business } from "@/models/Business";
import { BusinessProfileForm } from "@/components/business-profile-form";
import { MasterHeader } from "@/components/master-shell";

export default async function BusinessSettingsPage(){
 const user=await requirePagePermission("settings");
 await connectToDatabase();
 const business=await Business.findOne({_id:user.businessId,isActive:true}).lean();
 if(!business)return null;
 return <main className="master-page business-profile-page">
  <MasterHeader eyebrow="Business settings" title="Business Profile" description="Manage your restaurant details and team preferences."/>
  <BusinessProfileForm logoUrl={business.logoUrl} initial={{name:business.name,legalName:business.legalName??"",phone:business.phone??"",email:business.email??"",address:business.address??"",city:business.city??"",country:business.country??"Pakistan",taxNumber:business.taxNumber??"",currency:business.currency,timezone:business.timezone}}/>
  {user.role==="OWNER"&&<><WaiterSettings show={business.waiterShowBillSummary===true}/><QrOrderingSettings initial={{enabled:business.qrOrderingEnabled===true,showSummary:business.qrShowBillSummary!==false,verifyPhone:business.qrPhoneVerification===true,baseUrl:business.qrMenuBaseUrl??""}} smsReady={business.smsEnabled===true&&!!process.env.SMS_API}/><PaymentSettings prefill={business.paymentPrefillDueAmount!==false}/><BusinessTaxSettings rate={business.saleTaxRate??0} overrides={{CASH:business.paymentTaxRates?.CASH??null,CARD:business.paymentTaxRates?.CARD??null,BANK:business.paymentTaxRates?.BANK??null,OTHER:business.paymentTaxRates?.OTHER??null}}/></>}
 </main>;
}
