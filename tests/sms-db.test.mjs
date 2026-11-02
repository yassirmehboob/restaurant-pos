import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { Business } from "../models/Business.ts";
import { SmsMessage } from "../models/SmsMessage.ts";
import { queuePaymentSms } from "../lib/payment-sms.ts";
import { encryptSmsToken } from "../lib/sms-crypto.mjs";
import { runSmsDeliveryTick } from "../lib/sms-delivery.mjs";
import { queueDeliverySms } from "../lib/delivery-sms.ts";
import { ensureSmsMessageIndexes } from "../lib/sms-indexes.mjs";
import { loadSmsHistory } from "../lib/sms-history.ts";

test("SMS outbox is transactional, isolated and sends at most once even with concurrent workers",{skip:!process.env.MONGODB_URI},async t=>{
 await mongoose.connect(process.env.MONGODB_URI,{dbName:"pos_sms_test_"+randomUUID().replaceAll("-",""),serverSelectionTimeoutMS:5000});
 try{
  await Promise.all([Business.init(),SmsMessage.init()]);
  const secret="test-sms-auth-secret-".repeat(3),now=new Date(),calls=[];
  const a=await Business.create({name:"Cafe A"}),b=await Business.create({name:"Cafe B",smsEnabled:true,smsPaymentReceiptEnabled:true});
  await Business.updateOne({_id:a._id},{$set:{smsTokenEncrypted:encryptSmsToken("token-a",secret,String(a._id))}});
  await Business.updateOne({_id:b._id},{$set:{smsTokenEncrypted:encryptSmsToken("token-b",secret,String(b._id))}});
  const order=(business=a,extra={})=>({_id:new mongoose.Types.ObjectId(),businessId:business._id,orderNumber:"ORD-"+randomUUID(),paymentStatus:"PAID",grandTotal:250,paidAmount:250,taxPaymentMethod:"CASH",customerSnapshot:{name:"Ali",phone:"03133551379"},...extra});
  const queue=row=>mongoose.connection.transaction(session=>queuePaymentSms(row,now,session));
  const fetcher=async(url,options)=>{calls.push({url,...options});return new Response("{}",{status:202})};
  const tick=options=>runSmsDeliveryTick(mongoose.connection.db,{secret,base:"https://sms.example.test/",fetcher,...options});
  await t.test("master and receipt switches suppress queueing; token is never selected by default",async()=>{
   await queue(order());assert.equal(await SmsMessage.countDocuments(),0);
   await Business.updateOne({_id:a._id},{$set:{smsEnabled:true,smsPaymentReceiptEnabled:false}});await queue(order());assert.equal(await SmsMessage.countDocuments(),0);
   assert.equal((await Business.findById(a._id).lean()).smsTokenEncrypted,undefined);
   await Business.updateOne({_id:a._id},{$set:{smsPaymentReceiptEnabled:true}});
   await queue(order(a,{paymentStatus:"UNPAID"}));assert.equal(await SmsMessage.countDocuments(),0);
  });
  await t.test("rollback queues nothing; duplicate payment callbacks create one receipt",async()=>{
   const rollback=order();await assert.rejects(mongoose.connection.transaction(async session=>{await queuePaymentSms(rollback,now,session);throw new Error("Rollback")}));assert.equal(await SmsMessage.countDocuments(),0);
   const paid=order();await queue(paid);await queue(paid);assert.equal(await SmsMessage.countDocuments(),1);
  });
  await t.test("concurrent workers use each tenant token and the required single-recipient payload",async()=>{
   await queue(order(b));await Promise.all([tick(),tick()]);assert.equal(calls.length,2);
   assert.deepEqual(calls.map(c=>c.headers.Authorization).sort(),["Bearer token-a","Bearer token-b"]);
   for(const call of calls){assert.equal(call.url,"https://sms.example.test/v1/messages");assert.equal(call.method,"POST");assert.equal(call.redirect,"error");const payload=JSON.parse(call.body);assert.equal(payload.to,"+923133551379");assert.equal(payload.includeOptOut,true);assert.equal(payload.evidenceReference,"customer-acknowledgement");assert.match(payload.body,/250.00/);assert.deepEqual(Object.keys(payload).sort(),["body","evidenceReference","includeOptOut","to"])}
   await tick();assert.equal(calls.length,2);assert.equal(await SmsMessage.countDocuments({status:"ACCEPTED"}),2);
  });
  await t.test("disabled sending, missing phones, invalid templates and bad tokens do not send",async()=>{
   await queue(order(a,{customerSnapshot:{name:"No phone"}}));assert.equal(await SmsMessage.countDocuments({status:"SKIPPED",failureCode:"NO_VALID_CUSTOMER_PHONE"}),1);
   await Business.updateOne({_id:a._id},{$set:{smsPaymentTemplate:"{{bad}}"}});await queue(order());assert.equal(await SmsMessage.countDocuments({failureCode:"INVALID_MESSAGE_TEMPLATE"}),1);
   await Business.updateOne({_id:a._id},{$unset:{smsPaymentTemplate:1}});await queue(order());await Business.updateOne({_id:a._id},{$set:{smsEnabled:false}});await tick();assert.equal(calls.length,2);
   await Business.updateOne({_id:a._id},{$set:{smsEnabled:true,smsTokenEncrypted:encryptSmsToken("token-b",secret,String(b._id))}});await queue(order());await tick();assert.equal(await SmsMessage.countDocuments({failureCode:"TOKEN_UNAVAILABLE"}),1);assert.equal(calls.length,2);
   await Business.updateOne({_id:a._id},{$set:{smsTokenEncrypted:encryptSmsToken("token-a",secret,String(a._id))}});
  });
  await t.test("ambiguous results and interrupted work are not automatically retried",async()=>{
   let attempts=0;await queue(order());await tick({fetcher:async()=>{attempts++;throw new Error("Timeout with secret details")}});await tick();assert.equal(attempts,1);assert.equal(calls.length,2);assert.equal(await SmsMessage.countDocuments({status:"UNKNOWN",failureCode:"DELIVERY_UNCERTAIN"}),1);
   const pending=order();await queue(pending);await SmsMessage.updateOne({orderId:pending._id},{$set:{status:"SENDING",startedAt:new Date(now.getTime()-180000)}});await tick();assert.equal(await SmsMessage.countDocuments({failureCode:"INTERRUPTED_DELIVERY"}),1);
   await queue(order());await tick({fetcher:async()=>new Response("Do not persist echoed secrets",{status:503})});assert.equal(await SmsMessage.countDocuments({status:"UNKNOWN",httpStatus:503}),1);
   await queue(order());await tick({fetcher:async()=>new Response("Do not persist echoed secrets",{status:401})});assert.equal(await SmsMessage.countDocuments({status:"FAILED",httpStatus:401}),1);
   const stored=await SmsMessage.find().lean();assert.ok(!JSON.stringify(stored).includes("Do not persist"));
  });
  await t.test("opt-out instructions can be off while payment SMS still sends",async()=>{
   for(const includeOptOut of [false,true]){
    await Business.updateOne({_id:a._id},{$set:{smsEnabled:true,smsPaymentReceiptEnabled:true,smsIncludeOptOut:includeOptOut}});
    const paid=order();await queue(paid);
    assert.equal((await SmsMessage.findOne({orderId:paid._id})).includeOptOut,includeOptOut);
    const before=calls.length;await tick();assert.equal(calls.length,before+1);
    assert.equal(JSON.parse(calls.at(-1).body).includeOptOut,includeOptOut);
    assert.equal((await SmsMessage.findOne({orderId:paid._id})).status,"ACCEPTED");
   }
   const paid=order();await queue(paid);
   await Business.updateOne({_id:a._id},{$set:{smsIncludeOptOut:false}});
   await tick();assert.equal(JSON.parse(calls.at(-1).body).includeOptOut,false);
   assert.equal((await SmsMessage.findOne({orderId:paid._id})).includeOptOut,false);
   for(const includeOptOut of [false,true]){
    await Business.updateOne({_id:a._id},{$set:{smsPaymentReceiptEnabled:false,smsIncludeOptOut:includeOptOut}});
    const count=await SmsMessage.countDocuments(),before=calls.length;
    await queue(order());await tick();assert.equal(await SmsMessage.countDocuments(),count);assert.equal(calls.length,before);
   }
  });
  await t.test("legacy receipt uniqueness migrates without losing messages",async()=>{
   const collection=mongoose.connection.db.collection("smsmessages"),before=await collection.countDocuments();
   await collection.dropIndex("businessId_1_orderId_1_messageType_1");await collection.createIndex({businessId:1,orderId:1},{unique:true});
   await Promise.all([ensureSmsMessageIndexes(mongoose.connection.db),ensureSmsMessageIndexes(mongoose.connection.db)]);
   assert.equal(await collection.countDocuments(),before);
   const indexes=await collection.indexes();assert.ok(indexes.some(row=>row.key.messageType===1&&row.unique));assert.ok(!indexes.some(row=>row.unique&&Object.keys(row.key).length===2&&row.key.businessId===1&&row.key.orderId===1));
  });
  await t.test("delivery messages send independently of payment receipts and honor per-stage toggles",async()=>{
   const configs={placed:{enabled:true,includeOptOut:false,template:"Placed {{order_number}} to {{delivery_address}}"},outForDelivery:{enabled:true,includeOptOut:true,template:"Dispatch {{order_number}} to {{delivery_area}}"},delivered:{enabled:true,includeOptOut:false,template:"Delivered {{order_number}} at {{event_at}}"}};
   await Business.updateOne({_id:a._id},{$set:{smsEnabled:true,smsPaymentReceiptEnabled:false,smsDeliveryMessages:configs}});
   const delivery={...order(),orderType:"DELIVERY",status:"SENT_TO_KITCHEN",deliveryStatus:"PLACED",customerSnapshot:{name:"Ali",phone:"03133551379",address:"12 Main Street",area:"City Centre"}};
   await mongoose.connection.db.collection("orders").insertOne({...delivery});
   const types=["DELIVERY_PLACED","DELIVERY_OUT_FOR_DELIVERY","DELIVERY_DELIVERED"];
   for(const type of types){await mongoose.connection.transaction(session=>queueDeliverySms(delivery,type,now,session));await mongoose.connection.transaction(session=>queueDeliverySms(delivery,type,now,session))}
   const queued=await SmsMessage.find({orderId:delivery._id}).sort({createdAt:1}).lean();assert.equal(queued.length,3);assert.deepEqual(queued.map(row=>row.includeOptOut),[false,true,false]);
   const before=calls.length;await tick();const sent=calls.slice(before).map(row=>JSON.parse(row.body));assert.equal(sent.length,3);assert.deepEqual(sent.map(row=>row.includeOptOut),[false,true,false]);assert.match(sent[0].body,/12 Main Street/);assert.match(sent[1].body,/City Centre/);
   const second={...delivery,_id:new mongoose.Types.ObjectId()};await mongoose.connection.db.collection("orders").insertOne({...second});
   await mongoose.connection.transaction(session=>queueDeliverySms(second,"DELIVERY_OUT_FOR_DELIVERY",now,session));
   await Business.updateOne({_id:a._id},{$set:{"smsDeliveryMessages.outForDelivery.enabled":false}});const count=calls.length;await tick();assert.equal(calls.length,count);assert.equal((await SmsMessage.findOne({orderId:second._id})).status,"SKIPPED");
   const cancelled={...delivery,_id:new mongoose.Types.ObjectId()};await mongoose.connection.db.collection("orders").insertOne({...cancelled});await mongoose.connection.transaction(session=>queueDeliverySms(cancelled,"DELIVERY_PLACED",now,session));await mongoose.connection.db.collection("orders").updateOne({_id:cancelled._id},{$set:{status:"CANCELLED"}});await tick();assert.equal(calls.length,count);assert.equal((await SmsMessage.findOne({orderId:cancelled._id})).failureCode,"ORDER_UNAVAILABLE");
  });
  await t.test("discount alerts go to each owner number without opt-out text, only while SMS is on",async()=>{
   const { queueDiscountSms }=await import("../lib/discount-sms.ts");
   await Business.updateOne({_id:b._id},{$set:{smsEnabled:true,smsPaymentReceiptEnabled:false,discountSmsNumbers:["03001112223","+923004445556"]}});
   const discounted=order(b),values={amountBefore:2300,amountAfter:2070,cashier:"Cashier Ali",discount:{typeId:"x",name:"Discount",mode:"OPEN",percent:10,capAmount:null,amount:200,remarks:"Regular guest"}};
   await mongoose.connection.transaction(session=>queueDiscountSms(discounted,values,session));
   await mongoose.connection.transaction(session=>queueDiscountSms(discounted,values,session));
   assert.equal(await SmsMessage.countDocuments({orderId:discounted._id}),2,"a repeat queue must not duplicate alerts");
   const before=calls.length;await tick();const sent=calls.slice(before).map(row=>({auth:row.headers.Authorization,...JSON.parse(row.body)}));
   assert.deepEqual(sent.map(row=>[row.to,row.includeOptOut,row.auth]).sort(),[["+923001112223",false,"Bearer token-b"],["+923004445556",false,"Bearer token-b"]]);
   assert.match(sent[0].body,/Discount \(10%\) PKR 200\.00/);assert.match(sent[0].body,/Remarks: Regular guest/);
   await Business.updateOne({_id:b._id},{$set:{smsEnabled:false}});
   const off=order(b);await mongoose.connection.transaction(session=>queueDiscountSms(off,values,session));
   assert.equal(await SmsMessage.countDocuments({orderId:off._id}),0);
   await Business.updateOne({_id:b._id},{$set:{smsEnabled:true,smsPaymentReceiptEnabled:true,discountSmsNumbers:[]}});
  });
  await t.test("actual API statuses are retained for success and failure responses without raw response secrets",async()=>{
   await Business.updateOne({_id:a._id},{$set:{smsEnabled:true,smsPaymentReceiptEnabled:true}});
   for(const [status,httpStatus,queueStatus]of [["queued",202,"ACCEPTED"],["invalid_subscription",401,"FAILED"],["provider_unavailable",503,"UNKNOWN"],[0,200,"ACCEPTED"],[false,200,"ACCEPTED"]]){
    const paid=order();await queue(paid);
    await tick({fetcher:async()=>new Response(JSON.stringify({status,token:"token-a",private:"Do not persist this response"}),{status:httpStatus})});
    const stored=await SmsMessage.findOne({orderId:paid._id}).lean();assert.equal(stored.apiStatus,String(status));assert.equal(stored.httpStatus,httpStatus);assert.equal(stored.status,queueStatus);assert.equal(stored.apiStatusReadNote,"CAPTURED");assert.ok(!JSON.stringify(stored).includes("Do not persist this response"));
   }
   const missing=order();await queue(missing);await tick({fetcher:async()=>new Response("{}",{status:202})});const stored=await SmsMessage.findOne({orderId:missing._id});assert.equal(stored.apiStatus,undefined);assert.equal(stored.apiStatusReadNote,"NO_STATUS_FIELD");assert.equal(stored.status,"ACCEPTED");
  });
  await t.test("SMS history paginates, filters and isolates business records without exposing message bodies",async()=>{
   const ownerBusiness=await Business.create({name:"History owner"}),otherBusiness=await Business.create({name:"Other history"});
   const message=(business,index)=>({_id:`history-${business._id}-${index}`,businessId:business._id,orderId:new mongoose.Types.ObjectId(),orderNumber:index===0?"ORD-[test]":`ORD-HISTORY-${index}`,messageType:index%2?"DELIVERY_PLACED":"PAYMENT_RECEIPT",to:"+923133551379",body:"private message contents",status:index%2?"FAILED":"ACCEPTED",apiStatus:index%2?"invalid_subscription":"queued",apiStatusReadNote:"CAPTURED",httpStatus:index%2?401:202,createdAt:new Date(Date.now()-index*1000)});
   await SmsMessage.create([...Array.from({length:27},(_,index)=>message(ownerBusiness,index)),message(otherBusiness,100)]);
   const first=await loadSmsHistory(String(ownerBusiness._id),{}),second=await loadSmsHistory(String(ownerBusiness._id),{page:"2"});assert.equal(first.total,27);assert.equal(first.rows.length,25);assert.equal(second.rows.length,2);assert.equal(first.pages,2);assert.ok(!JSON.stringify(first).includes("private message contents"));assert.ok(!JSON.stringify(first).includes("+923133551379"));
   const failed=await loadSmsHistory(String(ownerBusiness._id),{status:"FAILED",type:"DELIVERY_PLACED"});assert.equal(failed.total,13);assert.ok(failed.rows.every(row=>row.apiStatus==="invalid_subscription"&&row.httpStatus===401));
   const search=await loadSmsHistory(String(ownerBusiness._id),{q:"[test]"});assert.equal(search.total,1);assert.equal(search.rows[0].orderNumber,"ORD-[test]");assert.equal(search.rows[0].apiStatus,"queued");
   const apiSearch=await loadSmsHistory(String(ownerBusiness._id),{q:"invalid_subscription"});assert.equal(apiSearch.total,13);
   const bounded=await loadSmsHistory(String(ownerBusiness._id),{page:"999999"});assert.equal(bounded.page,2);
  });
 }finally{assert.match(mongoose.connection.name,/^pos_sms_test_[a-f0-9]+$/);try{await mongoose.connection.dropDatabase()}finally{await mongoose.disconnect()}}
});
