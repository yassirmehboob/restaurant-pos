import type { Connection } from "mongoose";
type Database=NonNullable<Connection["db"]>;
export function advanceKitchenOrders(db:Database,business:Record<string,unknown>,now?:Date):Promise<number>;
export function runKitchenTimingTick(db:Database,now?:Date):Promise<number>;
