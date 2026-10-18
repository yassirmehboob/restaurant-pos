import assert from "node:assert/strict";import test from "node:test";import {randomUUID} from "node:crypto";import mongoose from "mongoose";import {AuditLog} from "../models/AuditLog.ts";import {auditFilter} from "../lib/audit-data.ts";
test("audit queries isolate businesses, paginate and filter by actual event dates",{skip:!process.env.MONGODB_URI},async()=>{
 const dbName="restaurant_pos_audit_test_"+randomUUID().replaceAll("-","");await mongoose.connect(process.env.MONGODB_URI,{dbName,serverSelectionTimeoutMS:5000});
 try{const businessId=new mongoose.Types.ObjectId(),actor=new mongoose.Types.ObjectId(),foreign=new mongoose.Types.ObjectId(),date=new Date("2026-10-18T01:00:00+05:00");
 await AuditLog.create(Array.from({length:55},(_,i)=>({businessId,userId:actor,userNameSnapshot:"Owner",action:i%2?"UPDATE_PRODUCT":"LOGIN",entityType:i%2?"Product":"User",description:"Event "+i,createdAt:new Date(date.getTime()+i*1000)})));
 await AuditLog.create({businessId:foreign,userId:actor,action:"LOGIN",entityType:"User",description:"Foreign event",createdAt:date});
 const filter=auditFilter(String(businessId),{from:"2026-10-18",to:"2026-10-18"});assert.equal(await AuditLog.countDocuments(filter),55);assert.equal(await AuditLog.countDocuments(auditFilter(String(businessId),{from:"2026-10-17",to:"2026-10-17"})),0);
 const first=await AuditLog.find(filter).sort({createdAt:-1,_id:-1}).limit(50).lean(),next=await AuditLog.find(filter).sort({createdAt:-1,_id:-1}).skip(50).limit(50).lean();assert.equal(first.length,50);assert.equal(next.length,5);assert.equal(new Set([...first,...next].map(row=>String(row._id))).size,55);
 assert.equal(await AuditLog.countDocuments(auditFilter(String(businessId),{action:"UPDATE_PRODUCT",user:String(actor)})),27);
 assert.equal(await AuditLog.countDocuments(auditFilter(String(foreign),{})),1);
 }finally{assert.match(mongoose.connection.name,/^restaurant_pos_audit_test_[a-f0-9]+$/);await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
