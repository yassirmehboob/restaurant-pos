import { requireUser } from "@/data/auth";
import { redirect } from "next/navigation";
import { waiterWorkspace } from "@/data/waiter";
import { WaiterScreen } from "@/components/waiter-screen";
export default async function WaiterPage({searchParams}:{searchParams:Promise<{edit?:string}>}){
 const user=await requireUser();if(user.role!=="WAITER")redirect("/waiter-requests");
 const {edit}=await searchParams;
 return <WaiterScreen key={edit??"new"} initial={await waiterWorkspace()} initialEditId={typeof edit==="string"?edit:undefined}/>;
}
