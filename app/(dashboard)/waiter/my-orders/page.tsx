import { requireUser } from "@/data/auth";
import { redirect } from "next/navigation";
import { waiterWorkspace } from "@/data/waiter";
import { WaiterScreen } from "@/components/waiter-screen";

export default async function WaiterMyOrdersPage(){
 const user=await requireUser();
 if(user.role!=="WAITER")redirect("/waiter-requests");
 return <WaiterScreen initial={await waiterWorkspace()} ordersOnly/>;
}
