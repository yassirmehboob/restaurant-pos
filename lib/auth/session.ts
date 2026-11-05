import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env, secureCookies } from "@/lib/env";
import type { UserRole } from "@/lib/roles";
import { USER_ROLES } from "@/lib/roles";
import { createHash, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { RevokedSession } from "@/models/RevokedSession";
import { connectToDatabase } from "@/lib/db";
const COOKIE_NAME="restaurant_pos_session", SESSION_DURATION_SECONDS=60*60*12;
export type SessionPayload={userId:string;businessId:string;role:UserRole;authVersion?:number};
type ActiveSession=SessionPayload&{exp:number;jti?:string};
const secretKey=()=>new TextEncoder().encode(env().AUTH_SECRET);
const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");
// The JWT ID survives renewal, so one key covers every token issued for a login.
const sessionKey=(token:string,jti:unknown)=>sha256(typeof jti==="string"?jti:token);
async function writeSessionCookie(payload:SessionPayload,jti:string){
  const expiresAt=new Date(Date.now()+SESSION_DURATION_SECONDS*1000);
  const token=await new SignJWT(payload).setProtectedHeader({alg:"HS256"}).setJti(jti).setIssuedAt().setExpirationTime(expiresAt).sign(secretKey());
  (await cookies()).set(COOKIE_NAME,token,{httpOnly:true,secure: secureCookies(),sameSite:"lax",path:"/",expires:expiresAt});
}
export async function createSession(payload:SessionPayload){await writeSessionCookie(payload,randomUUID());}
export async function readSession():Promise<ActiveSession|null>{
  const token=(await cookies()).get(COOKIE_NAME)?.value;if(!token)return null;
  try{const {payload}=await jwtVerify(token,secretKey(),{algorithms:["HS256"]});
    if(typeof payload.userId!=="string"||!/^[a-f\d]{24}$/i.test(payload.userId)||typeof payload.businessId!=="string"||!/^[a-f\d]{24}$/i.test(payload.businessId)||!USER_ROLES.includes(payload.role as UserRole)||typeof payload.exp!=="number")return null;
    if(payload.authVersion!==undefined&&(!Number.isSafeInteger(payload.authVersion)||(payload.authVersion as number)<0))return null;
    await connectToDatabase();
    // Logouts recorded before renewal existed are stored under the token's own hash.
    if(await RevokedSession.exists({_id:{$in:[sessionKey(token,payload.jti),sha256(token)]}}))return null;
    return payload as ActiveSession;}catch{return null;}
}
/** Seconds until the current session lapses, without extending it. */
export async function sessionSecondsLeft(){
  const session=await readSession();
  return session?Math.max(0,session.exp-Math.floor(Date.now()/1000)):null;
}
/** Restarts the idle window. Call only after confirming the account is still allowed in. */
export async function renewSession(){
  const session=await readSession();if(!session?.jti)return null;
  const token=(await cookies()).get(COOKIE_NAME)!.value,key=sessionKey(token,session.jti);
  // Waiter notifications stop at the expiry saved when the device subscribed, so it has to move too.
  if(session.role==="WAITER")await mongoose.connection.db!.collection("waiterpushsubscriptions").updateMany({userId:new mongoose.Types.ObjectId(session.userId),sessionHash:{$in:[key,sha256(token)]}},{$set:{sessionHash:key,expiresAt:new Date(Date.now()+SESSION_DURATION_SECONDS*1000)}});
  await writeSessionCookie({userId:session.userId,businessId:session.businessId,role:session.role,authVersion:session.authVersion},session.jti);
  return SESSION_DURATION_SECONDS;
}
export async function deleteSession(){
  const jar=await cookies(),token=jar.get(COOKIE_NAME)?.value;
  if(token){
    let valid=false,jti:unknown;
    try{const {payload}=await jwtVerify(token,secretKey(),{algorithms:["HS256"]});valid=true;jti=payload.jti}catch{/* Invalid cookies need no revocation record. */}
    if(valid){
      await connectToDatabase();
      // Earlier renewals of this login may still be unexpired, and none outlives a full session from now.
      const expiresAt=new Date(Date.now()+SESSION_DURATION_SECONDS*1000);
      await Promise.all([sessionKey(token,jti),sha256(token)].map(_id=>RevokedSession.updateOne({_id},{$set:{expiresAt}},{upsert:true})));
    }
  }
  jar.delete(COOKIE_NAME);
}

export async function notificationSessionIdentity(){
 const token=(await cookies()).get(COOKIE_NAME)?.value;
 if(!token)throw new Error("Sign in to enable notifications.");
 const {payload}=await jwtVerify(token,secretKey(),{algorithms:["HS256"]});
 if(typeof payload.exp!=="number")throw new Error("Invalid notification session.");
 return{sessionHash:sessionKey(token,payload.jti),expiresAt:new Date(payload.exp*1000),authVersion:Number(payload.authVersion??0)};
}
