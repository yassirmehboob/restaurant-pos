import { notifyWaiterOrder } from "./waiter-push.mjs";
import { queueOrderStageSms } from "./order-stage-sms.mjs";
// Shared by the web catch-up check and the independent kitchen worker.
export async function advanceKitchenOrders(db,business,now=new Date()){
 if(!business?.isActive||business.kitchenTimingEnabled!==true)return 0;
 const seconds=business.kitchenPreparingDelaySeconds??60,minutes=business.kitchenReadyDelayMinutes??25;
 if(!Number.isInteger(seconds)||seconds<1||seconds>3600||!Number.isInteger(minutes)||minutes<1||minutes>1440)return 0;
 const actor=business.kitchenTimingUpdatedBy??(await db.collection("users").findOne({businessId:business._id,role:"OWNER"},{projection:{_id:1}}))?._id;
 if(!actor)return 0;
 let changed=0;
 for(const stage of [{from:"SENT_TO_KITCHEN",to:"PREPARING",field:"kitchenSentAt",delay:seconds*1000,target:"preparingAt"},{from:"PREPARING",to:"READY",field:"preparingAt",delay:minutes*60000,target:"readyAt"}]){
  const cutoff=new Date(now.getTime()-stage.delay);
  const query={businessId:business._id,status:stage.from,$expr:{$lte:[{$ifNull:["$"+stage.field,{$ifNull:["$kitchenSentAt","$createdAt"]}]},cutoff]}};
  const orders=await db.collection("orders").find(query).limit(1000).toArray();
  for(const order of orders){
   const anchor=order[stage.field]??order.kitchenSentAt??order.createdAt;if(!anchor)continue;
   const due=new Date(new Date(anchor).getTime()+stage.delay);if(!Number.isFinite(due.getTime()))continue;
   const updated=await db.collection("orders").findOneAndUpdate({...query,_id:order._id,...(order.updatedAt?{updatedAt:order.updatedAt}:{updatedAt:{$exists:false}})},{$set:{status:stage.to,[stage.target]:due,kitchenStatusSource:"AUTOMATIC",updatedAt:now}},{returnDocument:"after",includeResultMetadata:false});
   if(!updated)continue;
   changed++;
   await notifyWaiterOrder(db,updated);
   await queueOrderStageSms(db,updated,stage.to==="READY"?"ORDER_READY":"ORDER_PREPARING",due).catch(()=>{});
   await db.collection("auditlogs").insertOne({businessId:business._id,userId:actor,userNameSnapshot:"Kitchen timer (automatic)",action:"AUTO_ORDER_"+stage.to,entityType:"Order",entityId:order._id,description:"Automatically moved "+order.orderNumber+" from "+stage.from+" to "+stage.to,metadata:{automatic:true,scheduledAt:due},createdAt:now});
  }
 }
 return changed;
}
export async function runKitchenTimingTick(db,now=new Date()){
 let count=0;const businesses=await db.collection("businesses").find({isActive:true,kitchenTimingEnabled:true}).toArray();
 for(const business of businesses)count+=await advanceKitchenOrders(db,business,now);
 return count;
}
