import type { ClientSession,Connection } from "mongoose";
type Database=NonNullable<Connection["db"]>;
export const ORDER_SMS_KEYS:{ORDER_PLACED:"placed";ORDER_READY:"ready"};
export function normalizeSmsPhone(phone:string):string|null;
export function queueOrderStageSms(db:Database,order:Record<string,unknown>,type:keyof typeof ORDER_SMS_KEYS,occurredAt?:Date,session?:ClientSession):Promise<void>;
