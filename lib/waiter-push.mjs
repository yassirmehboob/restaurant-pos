import webpush from "web-push";

// Only a generic alert crosses the push service. Order details remain in the
// authenticated app. Keys are supplied by deployment configuration, never DB.
export async function notifyWaiterOrder(db, order) {
 if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_SUBJECT)return;
 try {
  const request=await db.collection("waiterrequests").findOne({businessId:order.businessId,orderId:order._id});
  if(!request)return;
  const user=await db.collection("users").findOne({_id:request.userId,businessId:order.businessId,isActive:true,role:"WAITER"});
  if(!user)return;
  const subscriptions=await db.collection("waiterpushsubscriptions").find({businessId:order.businessId,userId:request.userId,authVersion:user.authVersion??0,expiresAt:{$gt:new Date()}}).limit(20).toArray();
  await Promise.all(subscriptions.map(async row=>{
   try {
    if(await db.collection("revokedsessions").findOne({_id:row.sessionHash}))return;
    await webpush.sendNotification(row.subscription,JSON.stringify({title:"Restaurant POS",body:"An order has an update. Open your waiter screen to view it."}),{TTL:300,timeout:5000,vapidDetails:{subject:process.env.VAPID_SUBJECT,publicKey:process.env.VAPID_PUBLIC_KEY,privateKey:process.env.VAPID_PRIVATE_KEY}});
   }catch(error){if(error.statusCode===404||error.statusCode===410)await db.collection("waiterpushsubscriptions").deleteOne({_id:row._id});else console.error("Waiter push delivery failed; on-screen status remains available.")}
  }));
 }catch{console.error("Waiter push delivery failed; on-screen status remains available.")}
}
