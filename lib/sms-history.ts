import "server-only";
import { SmsMessage } from "@/models/SmsMessage";

export const SMS_QUEUE_STATUSES=["PENDING","SENDING","ACCEPTED","FAILED","UNKNOWN","SKIPPED"] as const;
export const SMS_MESSAGE_TYPES=["PAYMENT_RECEIPT","DELIVERY_PLACED","DELIVERY_OUT_FOR_DELIVERY","DELIVERY_DELIVERED","DISCOUNT_ALERT"] as const;
export const SMS_QUEUE_LABELS:Record<string,string>={PENDING:"Queued",SENDING:"Sending",ACCEPTED:"Submitted",FAILED:"Failed",UNKNOWN:"Uncertain",SKIPPED:"Skipped"};
export const SMS_TYPE_LABELS:Record<string,string>={PAYMENT_RECEIPT:"Payment receipt",DELIVERY_PLACED:"Order placed",DELIVERY_OUT_FOR_DELIVERY:"Out for delivery",DELIVERY_DELIVERED:"Delivered",DISCOUNT_ALERT:"Discount alert",...Object.fromEntries([1,2,3,4,5].map(slot=>[`DISCOUNT_ALERT_${slot}`,"Discount alert"]))};
const failureReasons:Record<string,string>={ORDER_UNAVAILABLE:"Delivery was cancelled or is no longer available.",UNSUPPORTED_MESSAGE_TYPE:"Unsupported message type.",NO_VALID_CUSTOMER_PHONE:"No valid customer phone on the order.",INVALID_MESSAGE_TEMPLATE:"The completed message is invalid or too long.",SMS_DISABLED:"Sending was disabled before submission.",TOKEN_UNAVAILABLE:"Check the business subscription token.",GATEWAY_HTTP_ERROR:"The gateway returned an HTTP error.",DELIVERY_UNCERTAIN:"No definitive response. Not resent to avoid duplicates.",INTERRUPTED_DELIVERY:"The sender was interrupted. Not resent to avoid duplicates."};
const readNotes:Record<string,string>={EMPTY_RESPONSE:"The API returned an empty response.",NOT_JSON:"The API response was not JSON.",NO_STATUS_FIELD:"The API response did not contain a status field.",INVALID_STATUS_VALUE:"The API status was not a text, number, or boolean value.",RESPONSE_TOO_LARGE:"The response exceeded the capture limit.",STATUS_TOO_LONG:"The API status exceeded the capture limit.",STATUS_READ_FAILED:"The API response could not be read."};
export type SmsHistoryQuery={q?:unknown;status?:unknown;type?:unknown;page?:unknown};
const queryText=(value:unknown)=>typeof value==="string"?value.trim():"";
export function smsHistoryFilter(businessId:string,query:SmsHistoryQuery){
 const q=queryText(query.q).slice(0,100),status=queryText(query.status),type=queryText(query.type);
 const filter:Record<string,unknown>={businessId};
 if(SMS_QUEUE_STATUSES.some(value=>value===status))filter.status=status;
 if(SMS_MESSAGE_TYPES.some(value=>value===type))filter.messageType=type==="PAYMENT_RECEIPT"?{$in:[type,null]}:type==="DISCOUNT_ALERT"?{$regex:"^DISCOUNT_ALERT_"}:type;
 if(q){const literal=q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");filter.$or=["orderNumber","to","apiStatus"].map(field=>({[field]:{$regex:literal,$options:"i"}}))}
 return{filter,q,status:typeof filter.status==="string"?filter.status:"",type:filter.messageType?type:"",page:/^[1-9]\d{0,5}$/.test(queryText(query.page))?Number(queryText(query.page)):1};
}
export async function loadSmsHistory(businessId:string,query:SmsHistoryQuery){
 const parsed=smsHistoryFilter(businessId,query),pageSize=25,total=await SmsMessage.countDocuments(parsed.filter);
 const pages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(parsed.page,pages);
 const rows=await SmsMessage.find(parsed.filter).select("orderId orderNumber messageType to status httpStatus apiStatus apiStatusReadNote failureCode createdAt finishedAt").sort({createdAt:-1,_id:-1}).skip((page-1)*pageSize).limit(pageSize).lean();
 return{q:parsed.q,status:parsed.status,type:parsed.type,page,pages,pageSize,total,rows:rows.map(row=>({id:String(row._id),orderId:String(row.orderId),orderNumber:row.orderNumber||"Order",messageType:row.messageType??"PAYMENT_RECEIPT",recipient:row.to?`•••• ${row.to.slice(-4)}`:"No valid phone",status:row.status as string,httpStatus:typeof row.httpStatus==="number"?row.httpStatus:null,apiStatus:typeof row.apiStatus==="string"?row.apiStatus:null,apiNote:readNotes[row.apiStatusReadNote??""]??(row.httpStatus?"API status was not recorded by the earlier sender.":"No API response yet."),failure:failureReasons[row.failureCode??""]??"",createdAt:new Date(row.createdAt).toISOString(),finishedAt:row.finishedAt?new Date(row.finishedAt).toISOString():null}))};
}
