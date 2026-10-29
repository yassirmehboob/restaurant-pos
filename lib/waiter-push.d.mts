import type { Db, Document } from "mongodb";
export function notifyWaiterOrder(db:Db,order:Document):Promise<void>;
