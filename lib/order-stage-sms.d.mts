import type { ClientSession,Connection } from "mongoose";
type Database=NonNullable<Connection["db"]>;
export const ORDER_SMS_KEYS:{ORDER_PLACED:"placed";ORDER_PREPARING:"preparing";ORDER_READY:"ready";ORDER_SERVED:"served";ORDER_COMPLETED:"completed"};
export function normalizeSmsPhone(phone:string):string|null;
export function queueOrderStageSms(db:Database,order:Record<string,unknown>,type:keyof typeof ORDER_SMS_KEYS,occurredAt?:Date,session?:ClientSession):Promise<void>;
