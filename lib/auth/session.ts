import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";
import type { UserRole } from "@/lib/roles";
const COOKIE_NAME="restaurant_pos_session", SESSION_DURATION_SECONDS=60*60*12;
export type SessionPayload={userId:string;businessId:string;role:UserRole};
const secretKey=()=>new TextEncoder().encode(env().AUTH_SECRET);
export async function createSession(payload:SessionPayload){
  const expiresAt=new Date(Date.now()+SESSION_DURATION_SECONDS*1000);
  const token=await new SignJWT(payload).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime(expiresAt).sign(secretKey());
  (await cookies()).set(COOKIE_NAME,token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",expires:expiresAt});
}
export async function readSession():Promise<SessionPayload|null>{
  const token=(await cookies()).get(COOKIE_NAME)?.value;if(!token)return null;
  try{const {payload}=await jwtVerify(token,secretKey(),{algorithms:["HS256"]});
    if(typeof payload.userId!=="string"||typeof payload.businessId!=="string"||typeof payload.role!=="string")return null;
    return payload as SessionPayload;}catch{return null;}
}
export async function deleteSession(){(await cookies()).delete(COOKIE_NAME);}
