import { decryptSmsToken } from "./sms-crypto.mjs";
import { readSmsApiStatus } from "./sms-api-response.mjs";

export function smsEndpoint(base){
 if(!base)throw new Error("SMS gateway is not configured.");
 const url=new URL(base);if(!["https:","http:"].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error("Invalid SMS gateway configuration.");
 url.pathname=url.pathname.replace(/\/+$/,"")+"/v1/messages";return url.toString();
}
// No automatic resend after an ambiguous network result: the gateway has no
// documented idempotency contract, so a timeout must not cause duplicate SMS.
export async function runSmsDeliveryTick(db,{fetcher=fetch,base=process.env.SMS_API,secret=process.env.AUTH_SECRET,now=new Date(),limit=20}={}){
 if(!base||!secret)return 0;
 let endpoint;try{endpoint=smsEndpoint(base)}catch{return 0}
 const messages=db.collection("smsmessages");
 await messages.updateMany({status:"SENDING",startedAt:{$lt:new Date(now.getTime()-120000)}},{$set:{status:"UNKNOWN",failureCode:"INTERRUPTED_DELIVERY",finishedAt:now,updatedAt:now}});
 let count=0;
 for(let index=0;index<limit;index++){
  const startedAt=new Date();
  const row=await messages.findOneAndUpdate({status:"PENDING"},{$set:{status:"SENDING",startedAt,updatedAt:startedAt}},{sort:{createdAt:1},returnDocument:"after",includeResultMetadata:false});
  if(!row)break;
  let includeOptOut=row.includeOptOut!==false;
  const finish=async(status,failureCode,httpStatus,apiResponse={})=>messages.updateOne({_id:row._id,status:"SENDING"},{$set:{status,includeOptOut,finishedAt:new Date(),updatedAt:new Date(),...(failureCode?{failureCode}:{}),...(httpStatus?{httpStatus}:{}),...apiResponse}});
  const business=await db.collection("businesses").findOne({_id:row.businessId,isActive:true});
  const messageType=row.messageType??"PAYMENT_RECEIPT",deliveryKey={DELIVERY_PLACED:"placed",DELIVERY_OUT_FOR_DELIVERY:"outForDelivery",DELIVERY_DELIVERED:"delivered"}[messageType];
  if(messageType!=="PAYMENT_RECEIPT"&&!deliveryKey){await finish("SKIPPED","UNSUPPORTED_MESSAGE_TYPE");continue}
  const config=deliveryKey?business?.smsDeliveryMessages?.[deliveryKey]:{enabled:business?.smsPaymentReceiptEnabled,includeOptOut:business?.smsIncludeOptOut};
  if(!business?.smsEnabled||!config?.enabled){await finish("SKIPPED","SMS_DISABLED");continue}
  if(deliveryKey&&!await db.collection("orders").findOne({_id:row.orderId,businessId:row.businessId,orderType:"DELIVERY",status:{$ne:"CANCELLED"}})){await finish("SKIPPED","ORDER_UNAVAILABLE");continue}
  includeOptOut=config.includeOptOut!==false;
  let token;try{token=decryptSmsToken(business.smsTokenEncrypted,secret,String(business._id));if(!token||/[\r\n]/.test(token))throw new Error()}catch{await finish("FAILED","TOKEN_UNAVAILABLE");continue}
  try{
   const response=await fetcher(endpoint,{method:"POST",redirect:"error",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({to:row.to,body:row.body,includeOptOut,evidenceReference:row.evidenceReference}),signal:AbortSignal.timeout(10000)});
   const apiResponse=await readSmsApiStatus(response,token);
   // A 5xx may occur after provider acceptance. Keep it uncertain rather than
   // automatically resending; never store provider bodies that could echo keys.
   await finish(response.ok?"ACCEPTED":response.status>=500?"UNKNOWN":"FAILED",response.ok?undefined:"GATEWAY_HTTP_ERROR",response.status,apiResponse);
   count++;
  }catch{await finish("UNKNOWN","DELIVERY_UNCERTAIN")}
 }
 return count;
}
