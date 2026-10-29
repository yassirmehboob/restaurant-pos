import { waiterWorkspace } from "@/data/waiter";
import { WaiterScreen } from "@/components/waiter-screen";
export default async function WaiterRequestsPage(){return <WaiterScreen initial={await waiterWorkspace()}/>}
