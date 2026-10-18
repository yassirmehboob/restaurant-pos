import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { advanceKitchenOrders } from "../lib/kitchen-timing.mjs";
test("optional kitchen timers advance only eligible business orders and preserve human progress",{skip:!process.env.MONGODB_URI},async t=>{
 const dbName="restaurant_pos_kitchen_test_"+randomUUID().replaceAll("-","");await mongoose.connect(process.env.MONGODB_URI,{dbName,serverSelectionTimeoutMS:5000});
 try{
 const db=mongoose.connection.db,businessId=new mongoose.Types.ObjectId(),ownerId=new mongoose.Types.ObjectId(),now=new Date("2026-10-17T15:00:00Z");
 const ago=seconds=>new Date(now.getTime()-seconds*1000),business={_id:businessId,isActive:true,kitchenTimingEnabled:true,kitchenPreparingDelaySeconds:60,kitchenReadyDelayMinutes:25,kitchenTimingUpdatedBy:ownerId};
 const row=(name,status,extra={})=>({_id:new mongoose.Types.ObjectId(),businessId,orderNumber:name,status,createdAt:ago(3600),updatedAt:ago(3600),...extra});
 const pending=row("pending","SENT_TO_KITCHEN",{kitchenSentAt:ago(59)}),due=row("due","SENT_TO_KITCHEN",{kitchenSentAt:ago(61)}),overdue=row("overdue","SENT_TO_KITCHEN",{kitchenSentAt:ago(1600)}),manual=row("manual","PREPARING",{preparingAt:ago(10)}),ready=row("ready","PREPARING",{preparingAt:ago(1500)}),served=row("served","SERVED"),cancelled=row("cancelled","CANCELLED"),foreign=row("foreign","SENT_TO_KITCHEN",{businessId:new mongoose.Types.ObjectId()});
 await db.collection("orders").insertMany([pending,due,overdue,manual,ready,served,cancelled,foreign]);
 await t.test("disabled timing keeps human-dependent behavior",async()=>{assert.equal(await advanceKitchenOrders(db,{...business,kitchenTimingEnabled:false},now),0);assert.equal(await db.collection("orders").countDocuments({kitchenStatusSource:"AUTOMATIC"}),0)});
 await t.test("concurrent workers use status comparisons and do not duplicate transitions",async()=>{
 const counts=await Promise.all([advanceKitchenOrders(db,business,now),advanceKitchenOrders(db,business,now)]);assert.equal(counts.reduce((a,b)=>a+b,0),4);
 assert.equal((await db.collection("orders").findOne({_id:pending._id})).status,"SENT_TO_KITCHEN");assert.equal((await db.collection("orders").findOne({_id:due._id})).status,"PREPARING");
 assert.equal((await db.collection("orders").findOne({_id:overdue._id})).status,"READY");assert.equal((await db.collection("orders").findOne({_id:ready._id})).status,"READY");assert.equal((await db.collection("orders").findOne({_id:manual._id})).status,"PREPARING");
 assert.equal((await db.collection("orders").findOne({_id:served._id})).status,"SERVED");assert.equal((await db.collection("orders").findOne({_id:cancelled._id})).status,"CANCELLED");assert.equal((await db.collection("orders").findOne({_id:foreign._id})).status,"SENT_TO_KITCHEN");
 assert.equal(await db.collection("auditlogs").countDocuments({businessId}),4);
 });
 await t.test("ready delay follows actual manual preparation start",async()=>{
 await advanceKitchenOrders(db,business,new Date(now.getTime()+1490*1000));assert.equal((await db.collection("orders").findOne({_id:manual._id})).status,"READY");
 });
 await t.test("legacy orders use creation time and invalid configuration cannot advance them",async()=>{
 const legacy=row("legacy","SENT_TO_KITCHEN");await db.collection("orders").insertOne(legacy);assert.equal(await advanceKitchenOrders(db,{...business,kitchenReadyDelayMinutes:0},now),0);await advanceKitchenOrders(db,business,now);assert.equal((await db.collection("orders").findOne({_id:legacy._id})).status,"READY");
 });
 }finally{assert.match(mongoose.connection.name,/^restaurant_pos_kitchen_test_[a-f0-9]+$/);await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
