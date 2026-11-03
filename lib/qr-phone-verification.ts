import "server-only";
import { createHmac,randomBytes,randomInt,timingSafeEqual } from "crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { allowAuthAttempt } from "@/lib/auth/two-factor";
import { env } from "@/lib/env";
import { normalizeSmsPhone } from "@/lib/order-stage-sms.mjs";
import { resolveQrTable } from "@/lib/qr-menu";
import { QrPhoneVerification } from "@/models/QrPhoneVerification";
import { SmsMessage } from "@/models/SmsMessage";

// Optional owner setting: before a phone's first QR order the guest types a code texted to their number,
// so a photo of the table code cannot be used with made-up numbers.
export const QR_VERIFY={codeMinutes:10,maxAttempts:5,passDays:30,codesPerPhoneWindow:3,codesPerIpWindow:5,codesPerBusinessWindow:60,checksPerIpWindow:20};
const hash=(value:string)=>createHmac("sha256",env().AUTH_SECRET).update(`qr-phone:${value}`).digest("hex");
const same=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const phoneSchema=z.string().trim().max(20).transform(value=>normalizeSmsPhone(value)).refine(value=>value!==null);

type SendResult={ok:true}|{ok:false;code:"INVALID"|"CLOSED"|"COUNTER_CLOSED"|"OFF"|"PHONE"|"BUSY"|"ERROR"};
export async function sendQrPhoneCode(token:string,raw:unknown,clientAddress:string):Promise<SendResult>{
 const context=await resolveQrTable(token);
 if(!context)return{ok:false,code:"INVALID"};
 if(!context.business.enabled)return{ok:false,code:"CLOSED"};
 if(!context.business.countersOpen)return{ok:false,code:"COUNTER_CLOSED"};
 if(!context.business.verifyPhone)return{ok:false,code:"OFF"};
 const parsed=phoneSchema.safeParse((raw as {phone?:unknown})?.phone);
 if(!parsed.success)return{ok:false,code:"PHONE"};
 const phone=parsed.data!,businessId=context.business.id;
 // Every code is a paid SMS, so the number, the network address and the whole restaurant are capped.
 if(!await allowAuthAttempt(`qr-code-phone:${businessId}:${phone}`,QR_VERIFY.codesPerPhoneWindow)||!await allowAuthAttempt(`qr-code-ip:${clientAddress}`,QR_VERIFY.codesPerIpWindow)||!await allowAuthAttempt(`qr-code-business:${businessId}`,QR_VERIFY.codesPerBusinessWindow))return{ok:false,code:"BUSY"};
 const code=String(randomInt(0,10000)).padStart(4,"0"),expires=new Date(Date.now()+QR_VERIFY.codeMinutes*60000);
 try{
  const id=new mongoose.Types.ObjectId();
  await QrPhoneVerification.create({_id:id,businessId,phone,codeHash:hash(`${id}:${code}`),codeExpiresAt:expires,purgeAt:expires});
  await SmsMessage.create({_id:`${businessId}:${id}:QR_VERIFICATION`,businessId,orderId:id,orderNumber:"QR code",messageType:"QR_VERIFICATION",to:phone,body:`${context.business.name}: ${code} is your table order code. It expires in ${QR_VERIFY.codeMinutes} minutes.`,includeOptOut:false,evidenceReference:"qr-phone-verification",status:"PENDING"});
  return{ok:true};
 }catch{return{ok:false,code:"ERROR"}}
}

type CheckResult={ok:true;pass:string}|{ok:false;code:"INVALID"|"OFF"|"PHONE"|"CODE"|"EXPIRED"|"BUSY"|"ERROR"};
export async function checkQrPhoneCode(token:string,raw:unknown,clientAddress:string):Promise<CheckResult>{
 const context=await resolveQrTable(token);
 if(!context)return{ok:false,code:"INVALID"};
 if(!context.business.verifyPhone)return{ok:false,code:"OFF"};
 const parsed=phoneSchema.safeParse((raw as {phone?:unknown})?.phone),code=String((raw as {code?:unknown})?.code??"").trim();
 if(!parsed.success)return{ok:false,code:"PHONE"};
 if(!/^\d{4}$/.test(code))return{ok:false,code:"CODE"};
 if(!await allowAuthAttempt(`qr-check-ip:${clientAddress}`,QR_VERIFY.checksPerIpWindow))return{ok:false,code:"BUSY"};
 // Only the newest code counts, and each wrong guess uses one of its few attempts.
 const row=await QrPhoneVerification.findOneAndUpdate({businessId:context.business.id,phone:parsed.data!,verifiedAt:{$exists:false},codeExpiresAt:{$gt:new Date()},attempts:{$lt:QR_VERIFY.maxAttempts}},{$inc:{attempts:1}},{sort:{createdAt:-1},returnDocument:"after"}).lean();
 if(!row)return{ok:false,code:"EXPIRED"};
 if(!same(String(row.codeHash),hash(`${row._id}:${code}`)))return{ok:false,code:row.attempts>=QR_VERIFY.maxAttempts?"EXPIRED":"CODE"};
 const pass=randomBytes(24).toString("base64url");
 const saved=await QrPhoneVerification.updateOne({_id:row._id,verifiedAt:{$exists:false}},{$set:{verifiedAt:new Date(),passHash:hash(pass),purgeAt:new Date(Date.now()+QR_VERIFY.passDays*86400000)}});
 return saved.modifiedCount?{ok:true,pass}:{ok:false,code:"EXPIRED"};
}

// True when the phone's saved pass belongs to this restaurant and this number and has not run out.
export async function hasQrPhonePass(businessId:string,phone:string,pass:unknown){
 if(typeof pass!=="string"||!/^[A-Za-z0-9_-]{32}$/.test(pass))return false;
 return!!await QrPhoneVerification.exists({passHash:hash(pass),businessId,phone,purgeAt:{$gt:new Date()}});
}
