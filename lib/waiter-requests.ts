import "server-only";
import type { ClientSession } from "mongoose";
import { WaiterRequest } from "@/models/WaiterRequest";

export async function reviseWaiterRequest(identity:{id:string;businessId:string;userId:string;revision:number},values:Record<string,unknown>){
 return WaiterRequest.findOneAndUpdate({_id:identity.id,businessId:identity.businessId,userId:identity.userId,status:"PENDING",revision:identity.revision},{$set:values,$inc:{revision:1}},{returnDocument:"after"});
}
export async function claimWaiterRequest(identity:{id:string;businessId:string;revision:number},confirmedByUserId:string,session:ClientSession){
 return WaiterRequest.findOneAndUpdate({_id:identity.id,businessId:identity.businessId,status:"PENDING",revision:identity.revision},{$set:{status:"CONFIRMED",confirmedByUserId}},{session,returnDocument:"after"});
}
