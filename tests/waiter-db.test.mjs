import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { WaiterRequest } from "../models/WaiterRequest.ts";
import { reviseWaiterRequest,claimWaiterRequest } from "../lib/waiter-requests.ts";

test("waiter edits are isolated; only one cashier can confirm; rollback leaves an editable request",{skip:!process.env.MONGODB_URI},async()=>{
 const dbName="pos_waiter_test_"+randomUUID().replaceAll("-","");
 await mongoose.connect(process.env.MONGODB_URI,{dbName,serverSelectionTimeoutMS:5000});
 try{
  const id=()=>String(new mongoose.Types.ObjectId()),businessId=id(),userId=id(),cashier=id();
  const request=await WaiterRequest.create({businessId,userId,waiterName:"Waiter",input:{},displayLines:[]});
  const identity={id:String(request._id),businessId,userId,revision:0};
  assert.equal(await reviseWaiterRequest({...identity,userId:id()},{tableName:"Wrong waiter"}),null);
  assert.equal(await reviseWaiterRequest({...identity,businessId:id()},{tableName:"Wrong business"}),null);
  const edits=await Promise.all([reviseWaiterRequest(identity,{tableName:"First"}),reviseWaiterRequest(identity,{tableName:"Second"})]);
  assert.equal(edits.filter(Boolean).length,1);
  await assert.rejects(mongoose.connection.transaction(async session=>{assert.ok(await claimWaiterRequest({...identity,revision:1},cashier,session));throw new Error("Order creation failed")}));
  assert.equal((await WaiterRequest.findById(request._id)).status,"PENDING");
  assert.equal(await mongoose.connection.transaction(session=>claimWaiterRequest({...identity,revision:0},cashier,session)),null);
  const confirmations=await Promise.all([1,2].map(()=>mongoose.connection.transaction(session=>claimWaiterRequest({...identity,revision:1},cashier,session))));
  assert.equal(confirmations.filter(Boolean).length,1);
  assert.equal(await reviseWaiterRequest({...identity,revision:1},{tableName:"Too late"}),null);
 }finally{
  assert.match(mongoose.connection.name,/^pos_waiter_test_[a-f0-9]+$/);
  try{await mongoose.connection.dropDatabase()}finally{await mongoose.disconnect()}
 }
});
