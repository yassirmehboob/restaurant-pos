import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env, secureCookies } from "@/lib/env";
import type { UserRole } from "@/lib/roles";
import { USER_ROLES } from "@/lib/roles";
import { createHash, randomUUID } from "node:crypto";
import { RevokedSession } from "@/models/RevokedSession";
import { connectToDatabase } from "@/lib/db";
const COOKIE_NAME="restaurant_pos_session", SESSION_DURATION_SECONDS=60*60*12;
export type SessionPayload={userId:string;businessId:string;role:UserRole;authVersion?:number};
const secretKey=()=>new TextEncoder().encode(env().AUTH_SECRET);
export async function createSession(payload:SessionPayload){
  const expiresAt=new Date(Date.now()+SESSION_DURATION_SECONDS*1000);
  const token=await new SignJWT(payload).setProtectedHeader({alg:"HS256"}).setJti(randomUUID()).setIssuedAt().setExpirationTime(expiresAt).sign(secretKey());
  (await cookies()).set(COOKIE_NAME,token,{httpOnly:true,secure: secureCookies(),sameSite:"lax",path:"/",expires:expiresAt});
}
export async function readSession():Promise<SessionPayload|null>{
  const token=(await cookies()).get(COOKIE_NAME)?.value;if(!token)return null;
  try{const {payload}=await jwtVerify(token,secretKey(),{algorithms:["HS256"]});
    if(typeof payload.userId!=="string"||!/^[a-f\d]{24}$/i.test(payload.userId)||typeof payload.businessId!=="string"||!/^[a-f\d]{24}$/i.test(payload.businessId)||!USER_ROLES.includes(payload.role as UserRole)||typeof payload.exp!=="number")return null;
    if(payload.authVersion!==undefined&&(!Number.isSafeInteger(payload.authVersion)||(payload.authVersion as number)<0))return null;
    await connectToDatabase();
    if(await RevokedSession.exists({_id:createHash("sha256").update(token).digest("hex")}))return null;
    return payload as SessionPayload;}catch{return null;}
}
export async function deleteSession(){
  const jar=await cookies(),token=jar.get(COOKIE_NAME)?.value;
  if(token){
    let expiry:number|undefined;
    try{const {payload}=await jwtVerify(token,secretKey(),{algorithms:["HS256"]});expiry=payload.exp}catch{/* Invalid cookies need no revocation record. */}
    if(typeof expiry==="number"){
      await connectToDatabase();
      await RevokedSession.updateOne({_id:createHash("sha256").update(token).digest("hex")},{$set:{expiresAt:new Date(expiry*1000)}},{upsert:true});
    }
  }
  jar.delete(COOKIE_NAME);
}

export async function notificationSessionIdentity(){
 const token=(await cookies()).get(COOKIE_NAME)?.value;
 if(!token)throw new Error("Sign in to enable notifications.");
 const {payload}=await jwtVerify(token,secretKey(),{algorithms:["HS256"]});
 if(typeof payload.exp!=="number")throw new Error("Invalid notification session.");
 return{sessionHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(payload.exp*1000),authVersion:Number(payload.authVersion??0)};
}
