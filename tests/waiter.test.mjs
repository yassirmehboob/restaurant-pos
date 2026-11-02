import assert from "node:assert/strict";
import test from "node:test";
import { waiterRequestSchema } from "../lib/validation/waiter.ts";
import { pushSubscriptionSchema } from "../lib/validation/waiter-push.ts";
import { isOpenWaiterOrder,waiterRequestView } from "../lib/waiter-view.ts";
import { can,permissionsFor,routePrivilege } from "../lib/permissions.ts";
import webpush from "web-push";
import { notifyWaiterOrder } from "../lib/waiter-push.mjs";

const id="0123456789abcdef01234567";
const input={orderType:"DINE_IN",tableId:id,paymentMethod:"CASH",deliveryCharge:0,deliveryAddress:"",deliveryArea:"",deliveryNotes:"",lines:[{kind:"PRODUCT",id,quantity:2,note:"No salt"}]};
test("waiter orders require a table and valid quantities, revisions and item IDs",()=>{
 assert.ok(waiterRequestSchema.safeParse({submissionKey:"12345678-1234-4234-8234-123456789abc",revision:0,input}).success);
 for(const change of [{orderType:"TAKEAWAY"},{tableId:""},{lines:[]},{lines:[{...input.lines[0],quantity:0}]},{lines:[{...input.lines[0],id:"invalid"}]}])assert.equal(waiterRequestSchema.safeParse({revision:0,input:{...input,...change}}).success,false);
 assert.equal(waiterRequestSchema.safeParse({submissionKey:"12345678-1234-4234-8234-123456789abc",revision:-1,input}).success,false);
});
test("waiter workspace access cannot be broadened to expose bills or bypass approval",()=>{
 const waiter={role:"WAITER",privileges:["pos","orders","edit_orders","printing","payments","reports","settings","kitchen"]};
 assert.deepEqual(permissionsFor(waiter),["waiter"]);
 assert.equal(can(waiter,"waiter"),true);assert.equal(can(waiter,"payments"),false);
 assert.equal(routePrivilege("/waiter"),"waiter");assert.equal(routePrivilege("/waiter-requests"),"pos");
});
test("hidden bill summaries are omitted from pending and confirmed waiter payloads",()=>{
 const request={_id:id,revision:3,waiterName:"Waiter",tableName:"Table 1",status:"PENDING",createdAt:new Date(),input,displayLines:[{name:"Soup",quantity:2,note:"No salt",unitCost:80,unitPrice:100}],summary:{subtotal:200,taxAmount:20,grandTotal:220},secret:"private"};
 const order={_id:id,status:"READY",orderNumber:"ORD-000001",subtotal:220,taxAmount:22,grandTotal:242};
 for(const o of [undefined,order]){
  const view=waiterRequestView(request,o,false);
  assert.equal("summary" in view,false);assert.equal("secret" in view,false);assert.equal("unitCost" in view.lines[0],false);assert.equal("unitPrice" in view.lines[0],false);
 }
 assert.equal(waiterRequestView(request,undefined,true).summary.grandTotal,220);
 assert.equal(waiterRequestView(request,order,true).summary.grandTotal,242);
 assert.equal(waiterRequestView(request,order,false).status,"READY");
 assert.equal(waiterRequestView(request,undefined,true).lines[0].unitPrice,100);
 assert.equal(waiterRequestView(request,{...order,items:[{unitPrice:110}]},true).lines[0].unitPrice,110);
 assert.equal(waiterRequestView({...request,displayLines:[{name:"Soup",quantity:2,note:""}]},undefined,true).lines[0].unitPrice,undefined);
});
test("cashier waiter list keeps only open sales",()=>{
 for(const status of ["SENT_TO_KITCHEN","PREPARING","READY","SERVED"])assert.equal(isOpenWaiterOrder(status),true);
 for(const status of ["COMPLETED","CANCELLED"])assert.equal(isOpenWaiterOrder(status),false);
});
test("push subscriptions reject private network destinations and malformed keys",()=>{
 const sub={endpoint:"https://web.push.apple.com/test",keys:{p256dh:"a".repeat(87),auth:"b".repeat(22)}};
 assert.ok(pushSubscriptionSchema.safeParse(sub).success);
 for(const endpoint of ["http://web.push.apple.com/test","https://127.0.0.1/test","https://localhost/test","https://web.push.apple.com.evil.test/test","https://web.push.apple.com:8443/test","https://user:pass@web.push.apple.com/test"])assert.equal(pushSubscriptionSchema.safeParse({...sub,endpoint}).success,false);
 assert.equal(pushSubscriptionSchema.safeParse({...sub,keys:{p256dh:"bad",auth:"bad"}}).success,false);
});

test("background push sends only a generic alert, respects revoked sessions and removes expired endpoints",async()=>{
 const oldSend=webpush.sendNotification,envKeys=["VAPID_PUBLIC_KEY","VAPID_PRIVATE_KEY","VAPID_SUBJECT"],oldEnv=envKeys.map(key=>process.env[key]);
 const sent=[],removed=[];let revoked=false;
 const row={_id:"endpoint",subscription:{endpoint:"https://web.push.apple.com/test"},sessionHash:"session"};
 const db={collection(name){return{
  async findOne(){if(name==="waiterrequests")return{userId:"waiter"};if(name==="users")return{authVersion:4};if(name==="revokedsessions")return revoked?{}:null;return null},
  find(filter){assert.equal(filter.authVersion,4);assert.ok(filter.expiresAt.$gt instanceof Date);return{limit(){return{async toArray(){return[row]}}}}},
  async deleteOne(filter){removed.push(filter)},
 }}};
 try{
  envKeys.forEach(key=>process.env[key]="test-config");
  webpush.sendNotification=async(subscription,payload)=>{sent.push(JSON.parse(payload))};
  const order={_id:"secret-order-id",businessId:"private-business",orderNumber:"ORD-SECRET",status:"READY"};
  await notifyWaiterOrder(db,order);
  assert.equal(sent.length,1);assert.match(sent[0].body,/An order has an update/);
  assert.equal(JSON.stringify(sent).includes("SECRET"),false);assert.equal(JSON.stringify(sent).includes("READY"),false);assert.equal(JSON.stringify(sent).includes("private-business"),false);
  revoked=true;await notifyWaiterOrder(db,order);assert.equal(sent.length,1);
  revoked=false;webpush.sendNotification=async()=>{throw{statusCode:410}};
  await notifyWaiterOrder(db,order);assert.deepEqual(removed,[{_id:"endpoint"}]);
 }finally{webpush.sendNotification=oldSend;envKeys.forEach((key,index)=>{if(oldEnv[index]===undefined)delete process.env[key];else process.env[key]=oldEnv[index]})}
});
