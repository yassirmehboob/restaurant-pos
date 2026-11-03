import "server-only";
import { randomBytes } from "crypto";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { allowAuthAttempt } from "@/lib/auth/two-factor";
import { orderSnapshots } from "@/lib/order-snapshots";
import { normalizeSmsPhone } from "@/lib/order-stage-sms.mjs";
import { hasQrPhonePass } from "@/lib/qr-phone-verification";
import { MAX_WEIGHT_GRAMS,MIN_WEIGHT_GRAMS } from "@/lib/weight";
import { QR_LANGUAGES } from "@/lib/qr-menu-i18n";
import { Business } from "@/models/Business";
import { Category } from "@/models/Category";
import { Deal } from "@/models/Deal";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { RestaurantTable } from "@/models/RestaurantTable";
import { SaleSession } from "@/models/SaleSession";
import { WaiterRequest } from "@/models/WaiterRequest";

// The QR code carries only this random token. It picks the business and the table, so editing the
// link can never move an order to another table or restaurant: a changed token simply matches nothing.
const TOKEN=/^[A-Za-z0-9_-]{24}$/;
export const newQrToken=()=>randomBytes(18).toString("base64url");
export const QR_LIMITS={pendingPerTable:5,pendingPerPhone:2,ordersPerIpWindow:6,ordersPerTableWindow:10};

export async function resolveQrTable(token:string){
 if(!TOKEN.test(token))return null;
 await connectToDatabase();
 const table=await RestaurantTable.findOne({qrToken:token,isActive:true}).select("businessId name number").lean();
 if(!table)return null;
 const business=await Business.findOne({_id:table.businessId,isActive:true}).select("name logoUrl phone currency qrOrderingEnabled qrShowBillSummary qrPhoneVerification smsEnabled").lean();
 if(!business)return null;
 // Nobody can approve or bill a QR order while every counter is closed, so the menu stops taking them.
 const countersOpen=business.qrOrderingEnabled===true&&!!await SaleSession.exists({businessId:business._id,status:"OPEN"});
 // Codes go out by SMS, so the check only applies while texting works; otherwise guests could never order.
 const verifyPhone=business.qrPhoneVerification===true&&business.smsEnabled===true&&!!process.env.SMS_API;
 return{table:{id:String(table._id),name:String(table.name),number:table.number==null?null:Number(table.number)},business:{id:String(business._id),name:String(business.name),phone:String(business.phone??""),currency:String(business.currency??"PKR"),logoUrl:business.logoUrl?publicImage(token,String(business.logoUrl)):undefined,enabled:business.qrOrderingEnabled===true,countersOpen,verifyPhone,showSummary:business.qrShowBillSummary!==false}};
}
export type QrTable=NonNullable<Awaited<ReturnType<typeof resolveQrTable>>>;

// Uploaded images are private to signed-in staff; guests read them through their table's token instead.
function publicImage(token:string,url?:string){const id=url?.match(/^\/api\/images\/([a-f\d]{24})$/i)?.[1];return id?`/api/menu/${token}/images/${id}`:undefined}

export async function guestMenu(token:string,context:QrTable){
 const businessId=context.business.id;
 const[products,deals,categories]=await Promise.all([
  Product.find({businessId,isActive:true,isAvailable:true}).sort({sortOrder:1,name:1}).lean(),
  Deal.find({businessId,isActive:true,isAvailable:true}).sort({sortOrder:1,name:1}).lean(),
  Category.find({businessId,isActive:true}).sort({sortOrder:1,name:1}).lean(),
 ]);
 const categoryMap=new Map(categories.map(c=>[String(c._id),String(c.name)]));
 const items=[...products.flatMap(p=>{const variants=p.variants?.length?p.variants:[{name:"",salePrice:p.salePrice}];return variants.map((v:{name:string;salePrice:number})=>({key:`PRODUCT:${p._id}:${v.name}`,id:String(p._id),kind:"PRODUCT" as const,variantName:v.name||undefined,byWeight:p.sellBy==="WEIGHT",name:v.name?`${p.name} (${v.name})`:String(p.name),description:String(p.description??""),imageUrl:publicImage(token,p.imageUrl),category:categoryMap.get(String(p.categoryId))??"Menu",price:Number(v.salePrice)}))}),
  ...deals.map(d=>({key:`DEAL:${d._id}:`,id:String(d._id),kind:"DEAL" as const,variantName:undefined,byWeight:false,name:String(d.name),description:String(d.description??""),imageUrl:publicImage(token,d.imageUrl),category:"Deals",price:Number(d.salePrice)}))];
 const used=new Set(items.map(item=>item.category));
 return{items,categories:[...(used.has("Deals")?["Deals"]:[]),...categories.map(c=>String(c.name)).filter(name=>used.has(name)&&name!=="Deals"),...(used.has("Menu")?["Menu"]:[])]};
}
export type GuestMenuItem=Awaited<ReturnType<typeof guestMenu>>["items"][number];

const id=z.string().regex(/^[a-f\d]{24}$/i);
export const guestOrderSchema=z.object({
 submissionKey:z.string().uuid(),
 language:z.enum(QR_LANGUAGES).default("en"),
 name:z.string().trim().min(2,"NAME").max(60,"NAME"),
 phone:z.string().trim().max(20).refine(value=>normalizeSmsPhone(value)!==null,"PHONE"),
 verification:z.string().max(64).optional(),
 lines:z.array(z.object({kind:z.enum(["PRODUCT","DEAL"]),id,variantName:z.string().trim().max(40).optional(),weightGrams:z.number().int().min(MIN_WEIGHT_GRAMS).max(MAX_WEIGHT_GRAMS).optional(),quantity:z.number().int().min(1).max(20),note:z.string().trim().max(150).default("")})).min(1,"EMPTY").max(30),
});

type GuestResult={ok:true;id:string;key:string}|{ok:false;code:"INVALID"|"CLOSED"|"COUNTER_CLOSED"|"VERIFY"|"BUSY"|"LIMIT"|"NAME"|"PHONE"|"EMPTY"|"UNAVAILABLE"|"ERROR"};
export async function submitGuestOrder(token:string,raw:unknown,clientAddress:string):Promise<GuestResult>{
 const context=await resolveQrTable(token);
 if(!context)return{ok:false,code:"INVALID"};
 if(!context.business.enabled)return{ok:false,code:"CLOSED"};
 if(!context.business.countersOpen)return{ok:false,code:"COUNTER_CLOSED"};
 const parsed=guestOrderSchema.safeParse(raw);
 if(!parsed.success){const code=parsed.error.issues[0]?.message;return{ok:false,code:code==="NAME"||code==="PHONE"||code==="EMPTY"?code:"INVALID"}}
 const businessId=context.business.id,phone=normalizeSmsPhone(parsed.data.phone)!;
 // A repeated tap or a retried request returns the order already saved.
 const existing=await WaiterRequest.findOne({businessId,source:"QR",tableId:context.table.id,submissionKey:parsed.data.submissionKey}).select("_id").lean();
 if(existing)return{ok:true,id:String(existing._id),key:parsed.data.submissionKey};
 const verified=context.business.verifyPhone&&await hasQrPhonePass(businessId,phone,parsed.data.verification);
 if(context.business.verifyPhone&&!verified)return{ok:false,code:"VERIFY"};
 // Anyone can scan a printed code, so each phone, table and network address is capped.
 if(!await allowAuthAttempt(`qr-order-ip:${clientAddress}`,QR_LIMITS.ordersPerIpWindow)||!await allowAuthAttempt(`qr-order-table:${context.table.id}`,QR_LIMITS.ordersPerTableWindow))return{ok:false,code:"BUSY"};
 const[tablePending,phonePending]=await Promise.all([
  WaiterRequest.countDocuments({businessId,source:"QR",tableId:context.table.id,status:"PENDING"}),
  WaiterRequest.countDocuments({businessId,source:"QR","guest.phone":phone,status:"PENDING"}),
 ]);
 if(tablePending>=QR_LIMITS.pendingPerTable||phonePending>=QR_LIMITS.pendingPerPhone)return{ok:false,code:"LIMIT"};
 const input={orderType:"DINE_IN" as const,tableId:context.table.id,waiterId:"",customerId:"",paymentMethod:"CASH" as const,deliveryAddress:"",deliveryArea:"",deliveryNotes:"",deliveryCharge:0,lines:parsed.data.lines.map(line=>({...line,note:line.note??""}))};
 let priced;
 try{priced=await orderSnapshots(businessId,input)}catch{return{ok:false,code:"UNAVAILABLE"}}
 try{
  const row=await WaiterRequest.findOneAndUpdate({businessId,source:"QR",tableId:context.table.id,submissionKey:parsed.data.submissionKey},{$setOnInsert:{businessId,source:"QR",waiterName:"QR Code",status:"PENDING",submissionKey:parsed.data.submissionKey,tableId:context.table.id,tableName:context.table.name,guest:{name:parsed.data.name,phone,language:parsed.data.language,verified},input,displayLines:priced.items.map(item=>({name:item.nameSnapshot,quantity:item.quantity,note:item.notes??"",unitPrice:item.unitPrice})),summary:{subtotal:priced.totals.subtotal,taxAmount:priced.totals.taxAmount,grandTotal:priced.totals.grandTotal}}},{upsert:true,returnDocument:"after",setDefaultsOnInsert:true});
  return{ok:true,id:String(row._id),key:parsed.data.submissionKey};
 }catch{return{ok:false,code:"ERROR"}}
}

// What the guest's phone shows after ordering. The submission key acts as the receipt: without it nobody can read the order.
export async function guestOrderStatus(token:string,requestId:string,key:string){
 const context=await resolveQrTable(token);
 if(!context||!id.safeParse(requestId).success||!z.string().uuid().safeParse(key).success)return null;
 const request=await WaiterRequest.findOne({_id:requestId,businessId:context.business.id,source:"QR",tableId:context.table.id,submissionKey:key}).lean();
 if(!request)return null;
 const order=request.orderId?await Order.findOne({_id:request.orderId,businessId:context.business.id}).select("status orderNumber subtotal taxAmount discountAmount grandTotal paymentStatus").lean():null;
 const show=context.business.showSummary;
 const stage=request.status==="CANCELLED"||order?.status==="CANCELLED"?"CANCELLED":!order?"WAITING":order.status==="COMPLETED"?"COMPLETED":order.status==="SERVED"?"SERVED":order.status==="READY"?"READY":order.status==="PREPARING"?"PREPARING":"CONFIRMED";
 return{
  stage,orderNumber:order?.orderNumber as string|undefined,paid:order?.paymentStatus==="PAID",createdAt:new Date(request.createdAt).toISOString(),guestName:String(request.guest?.name??""),
  lines:(request.displayLines as {name:string;quantity:number;note?:string;unitPrice?:number}[]).map(line=>({name:line.name,quantity:line.quantity,note:line.note??"",...(show&&line.unitPrice!==undefined?{unitPrice:line.unitPrice}:{})})),
  ...(show?{summary:{subtotal:order?.subtotal??request.summary?.subtotal??0,taxAmount:order?.taxAmount??request.summary?.taxAmount??0,discountAmount:order?.discountAmount??0,grandTotal:order?.grandTotal??request.summary?.grandTotal??0}}:{}),
 };
}
export type GuestOrderStatus=NonNullable<Awaited<ReturnType<typeof guestOrderStatus>>>;

// Bill summary while the guest reviews the cart; null when the owner hides it or the token is wrong.
export async function previewGuestOrder(token:string,raw:unknown,clientAddress:string){
 const context=await resolveQrTable(token);
 if(!context?.business.enabled||!context.business.countersOpen||!context.business.showSummary)return null;
 const parsed=guestOrderSchema.shape.lines.safeParse((raw as {lines?:unknown})?.lines);
 if(!parsed.success||!await allowAuthAttempt(`qr-preview-ip:${clientAddress}`,120))return{ok:false as const};
 try{
  const priced=await orderSnapshots(context.business.id,{orderType:"DINE_IN",tableId:context.table.id,waiterId:"",customerId:"",paymentMethod:"CASH",deliveryAddress:"",deliveryArea:"",deliveryNotes:"",deliveryCharge:0,lines:parsed.data.map(line=>({...line,note:line.note??""}))});
  return{ok:true as const,subtotal:priced.totals.subtotal,taxAmount:priced.totals.taxAmount,grandTotal:priced.totals.grandTotal};
 }catch{return{ok:false as const}}
}
