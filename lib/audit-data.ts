import { isISODate } from "@/lib/dates";
export type AuditQuery={q?:string;from?:string;to?:string;user?:string;action?:string;entity?:string;page?:string};
const secretKey=/(password|passphrase|^pin$|pinhash|secret|token|authorization|credential|connectionstring|mongodburi|cookie|apikey|privatekey)/i;
const moneyKey=/(cost|profit)/i;
export function safeAuditMetadata(value:unknown,showCosts=true,depth=0):unknown{
 if(depth>6)return "[truncated]";
 if(value===null||typeof value==="boolean"||typeof value==="number")return value;
 if(typeof value==="string")return value.slice(0,4000);
 if(value instanceof Date)return value.toISOString();
 if(Array.isArray(value))return value.slice(0,100).map(item=>safeAuditMetadata(item,showCosts,depth+1));
 if(value&&typeof value==="object"){
  if("toHexString" in value&&typeof value.toHexString==="function")return value.toHexString();
  const result:Record<string,unknown>={};
  for(const[key,item]of Object.entries(value).slice(0,100)){
   if(item===undefined)continue;
   if(secretKey.test(key.replace(/[^a-z0-9]/gi,""))&&!(key.endsWith("Changed")&&typeof item==="boolean")){result[key]="[redacted]";continue}
   if(!showCosts&&moneyKey.test(key)){result[key]="[restricted]";continue}
   result[key]=safeAuditMetadata(item,showCosts,depth+1);
  }
  return result;
 }
 return String(value??"");
}
export function auditFilter(businessId:string,query:AuditQuery){
 const filter:Record<string,unknown>={businessId},from=isISODate(query.from??"")?query.from:undefined,to=isISODate(query.to??"")?query.to:undefined;
 if(from||to)filter.createdAt={...(from?{$gte:new Date(from+"T00:00:00+05:00")}:{}),...(to?{$lte:new Date(to+"T23:59:59.999+05:00")}:{} )};
 for(const[key,field]of [["user","userId"],["action","action"],["entity","entityType"]] as const){const value=query[key]?.slice(0,100);if(value&&value!=="ALL")filter[field]=key==="user"?(/^[a-f\d]{24}$/i.test(value)?value:null):value}
 const text=query.q?.trim().slice(0,100);if(text){const escaped=Array.from(text,char=>".*+?^${}()|[]\\".includes(char)?"\\"+char:char).join("");const regex={$regex:escaped,$options:"i"};filter.$or=[{description:regex},{action:regex},{userNameSnapshot:regex},{entityType:regex}];if(/^[a-f\d]{24}$/i.test(text))filter.$or=[...(filter.$or as unknown[]),{entityId:text}]}
 return filter;
}
