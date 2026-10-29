import type { OrderInput } from "./validation/order";
type Summary={subtotal:number;taxAmount:number;grandTotal:number};
type RequestRecord={_id:unknown;revision:number;waiterName:string;tableName:string;status:string;createdAt:Date;input:OrderInput;displayLines:{name:string;quantity:number;note:string}[];summary?:Summary};
type OrderRecord=Summary&{_id:unknown;status:string;orderNumber:string};
export function waiterRequestView(r:RequestRecord,o:OrderRecord|undefined,showSummary:boolean){
 return{id:String(r._id),revision:r.revision,waiterName:r.waiterName,tableName:r.tableName,status:o?.status??r.status,orderNumber:o?.orderNumber,orderId:o?String(o._id):undefined,createdAt:new Date(r.createdAt).toISOString(),input:r.input,lines:r.displayLines.map(line=>({name:line.name,quantity:line.quantity,note:line.note})),...(showSummary?{summary:{subtotal:o?.subtotal??r.summary?.subtotal??0,taxAmount:o?.taxAmount??r.summary?.taxAmount??0,grandTotal:o?.grandTotal??r.summary?.grandTotal??0}}:{})};
}
