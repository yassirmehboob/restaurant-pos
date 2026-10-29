"use server";
import { requireUser } from "@/data/auth";
import mongoose from "mongoose";
import { pushSubscriptionSchema } from "@/lib/validation/waiter-push";
import { notificationSessionIdentity } from "@/lib/auth/session";
export async function getWaiterPushKey(){
 const user=await requireUser();if(user.role!=="WAITER")throw new Error("Use a waiter account for push notifications.");
 return process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT?process.env.VAPID_PUBLIC_KEY??null:null;
}
export async function subscribeWaiterPush(raw:unknown){
 const user=await requireUser();if(user.role!=="WAITER")throw new Error("Use a waiter account for push notifications.");
 const subscription=pushSubscriptionSchema.parse(raw);const db=mongoose.connection.db!;
 const identity=await notificationSessionIdentity();
 // Reusing a device transfers its endpoint to the signed-in waiter.
 await db.collection<{_id:string;businessId:mongoose.Types.ObjectId;userId:mongoose.Types.ObjectId;subscription:typeof subscription;updatedAt:Date;sessionHash:string;expiresAt:Date;authVersion:number}>("waiterpushsubscriptions").updateOne({_id:subscription.endpoint},{$set:{businessId:new mongoose.Types.ObjectId(user.businessId),userId:new mongoose.Types.ObjectId(user.id),subscription,updatedAt:new Date(),...identity}},{upsert:true});
}
