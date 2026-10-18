import { redirect } from "next/navigation";
import { requireUser } from "@/data/auth";
import { Business } from "@/models/Business";
import { MasterHeader } from "@/components/master-shell";
import { KitchenTimingSettings } from "@/components/kitchen-timing-settings";
export default async function KitchenTimingPage(){const user=await requireUser();if(user.role!=="OWNER")redirect("/access-denied");const business=await Business.findOne({_id:user.businessId,isActive:true}).lean();if(!business)return null;return <main className="master-page"><MasterHeader eyebrow="Owner setup" title="Kitchen Timing" description="Choose manual kitchen progress or automatic preparation and ready timings."/><KitchenTimingSettings enabled={business.kitchenTimingEnabled===true} preparingSeconds={business.kitchenPreparingDelaySeconds??60} readyMinutes={business.kitchenReadyDelayMinutes??25}/></main>}
