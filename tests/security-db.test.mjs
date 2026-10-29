import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../models/User.ts";
import { Business } from "../models/Business.ts";
import { Order } from "../models/Order.ts";
import { Payment } from "../models/Payment.ts";
import { SaleSession } from "../models/SaleSession.ts";
import { Product } from "../models/Product.ts";
import { Category } from "../models/Category.ts";
import { RestaurantTable } from "../models/RestaurantTable.ts";
import { WaiterRequest } from "../models/WaiterRequest.ts";
import { Customer } from "../models/Customer.ts";
import { SmsMessage } from "../models/SmsMessage.ts";

const jar = new Map();
globalThis.__securityTestCookies = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) };
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__securityTestCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("security: authorization, tenant isolation, sessions and payment integrity", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async t => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "pos_security_test_" + randomUUID().replaceAll("-", ""), serverSelectionTimeoutMS: 5000 });
  globalThis.mongooseConnection = Promise.resolve(mongoose);
  try {
    const { createSession, deleteSession } = await import("../lib/auth/session.ts");
    const { getCurrentUser } = await import("../data/auth.ts");
    const { saveUserAccount, saveOwnerProfile } = await import("../app/(dashboard)/users/actions.ts");
    const { saveOrder, cancelOrder, changeOrderStatus,saveWaiterRequest,confirmWaiterRequest,completeTakeawayPayment,changeDeliveryStatus } = await import("../app/(dashboard)/orders/actions.ts");
    const { saveSmsSettings,saveDeliverySmsSettings } = await import("../app/(dashboard)/settings/business/sms-actions.ts");
    const { waiterWorkspace } = await import("../data/waiter.ts");
    const { saveWaiterVisibility } = await import("../app/(dashboard)/settings/business/waiter-actions.ts");
    const { completeOrderPayment,completeDeliveryPayment, previewPaymentTax } = await import("../app/(dashboard)/payments/actions.ts");
    const { GET: imageGET } = await import("../app/api/images/[id]/route.ts");
    const { GET: csvGET } = await import("../app/api/reports/sales.csv/route.ts");
    const { createProduct } = await import("../app/(dashboard)/master-actions.ts");
    const { uploadImage } = await import("../lib/uploads.ts");
    await Promise.all([User.init(), Order.init(), Payment.init(), SaleSession.init()]);
    const a = await Business.create({ name: "Restaurant A", saleTaxRate: 0 }), b = await Business.create({ name: "Restaurant B", saleTaxRate: 0 });
    const password = "SecurityTest123", passwordHash = await bcrypt.hash(password, 12);
    const account = (business, username, role) => User.create({ businessId: business._id, fullName: username, phone: "03001234567", username, role, passwordHash });
    const owner = await account(a, "owner.a", "OWNER"), otherOwner = await account(b, "owner.b", "OWNER"), cashier = await account(a, "cashier.a", "CASHIER"), waiter = await account(a, "waiter.a", "WAITER");
    const signIn = async user => { const current = await User.findById(user._id); await createSession({ userId: String(current._id), businessId: String(current.businessId), role: current.role, authVersion: current.authVersion ?? 0 }); return jar.get("restaurant_pos_session"); };
    const useCookie = value => { jar.clear(); if (value) jar.set("restaurant_pos_session", value); };
    const saleDate = "2026-10-28";
    for (const user of [owner, otherOwner, cashier]) await SaleSession.create({ businessId: user.businessId, userId: user._id, userNameSnapshot: user.fullName, counterName: user.username, counterKey: user.username, saleDate, openingBalance: 0 });
    const categoryA = await Category.create({ businessId: a._id, name: "A category" }), categoryB = await Category.create({ businessId: b._id, name: "B category" });
    const product = await Product.create({ businessId: a._id, categoryId: categoryA._id, name: "Test burger", salePrice: 100, costPrice: 40 });
    const input = { paymentMethod: "CASH", orderType: "DINE_IN", deliveryAddress: "", deliveryArea: "", deliveryNotes: "", deliveryCharge: 0, lines: [{ kind: "PRODUCT", id: String(product._id), quantity: 1, note: "", salePrice: 1 }] };
    const foreign = await Order.create({ businessId: b._id, orderNumber: "FOREIGN-ORDER", orderType: "DINE_IN", status: "SENT_TO_KITCHEN", items: [], subtotal: 999, taxAmount: 0, grandTotal: 999, paidAmount: 0, dueAmount: 999, createdByUserId: otherOwner._id });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/bcAAAAASUVORK5CYII=", "base64");
    const foreignImage = await uploadImage(new File([png], "foreign.png", { type: "image/png" }), `business-${b._id}/products`);
    const query = { params: Promise.resolve({ id: foreignImage.split("/").at(-1) }) };
    const reportURL = "http://localhost/api/reports/sales.csv?range=CUSTOM&from=2026-10-28&to=2026-10-28";

    await t.test("anonymous requests cannot read reports, images or mutate orders", async () => {
      jar.clear();
      assert.equal((await imageGET(new Request("http://localhost"), query)).status, 401);
      assert.equal((await csvGET(new Request(reportURL))).status, 401);
      assert.equal((await saveOrder(input)).ok, false);
      assert.equal(await Order.countDocuments({ businessId: a._id }), 0);
    });
    await t.test("staff cannot bypass owner-only or payment permissions", async () => {
      await signIn(waiter);
      await assert.rejects(saveUserAccount(undefined, {}), /Only the restaurant owner/);
      await assert.rejects(previewPaymentTax(String(foreign._id), "CASH"), /permission/);
      assert.equal((await csvGET(new Request(reportURL))).status, 403);
    });
    await t.test("authorized owner cannot modify another restaurant's records", async () => {
      await signIn(owner);
      assert.equal((await saveOrder(input, String(foreign._id))).ok, false);
      assert.equal((await cancelOrder(String(foreign._id), "Cross tenant attempt")).ok, false);
      assert.equal((await changeOrderStatus(String(foreign._id), "PREPARING")).ok, false);
      assert.equal((await previewPaymentTax(String(foreign._id), "CASH")).ok, false);
      const form = new FormData();
      for (const [key, value] of Object.entries({ categoryId: String(categoryB._id), name: "Illegal category", description: "", salePrice: "10", costPrice: "5", taxRate: "0" })) form.set(key, value);
      assert.match((await createProduct(undefined, form)).message, /active category/);
      assert.equal((await imageGET(new Request("http://localhost"), query)).status, 404);
      const ownImage = await uploadImage(new File([png], "own.png", { type: "image/png" }), `business-${a._id}/products`);
      const response = await imageGET(new Request("http://localhost"), { params: Promise.resolve({ id: ownImage.split("/").at(-1) }) });
      assert.equal(response.status, 200); assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.equal((await Order.findById(foreign._id)).status, "SENT_TO_KITCHEN");
    });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    await t.test("prices are server-calculated and concurrent payment attempts collect once", { skip: !hello.setName && hello.msg !== "isdbgrid" }, async () => {
      await signIn(owner);
      const saved = await saveOrder(input); assert.equal(saved.ok, true); assert.equal(saved.grandTotal, 100);
      const orderId = saved.orderId, request = { orderId, idempotencyKey: randomUUID(), method: "CASH", expectedGrandTotal: 100, tenderedAmount: 100, reference: "", notes: "" };
      assert.equal((await changeOrderStatus(orderId, "__proto__")).ok, false);
      assert.equal((await cancelOrder(orderId, "x".repeat(501))).ok, false);
      assert.equal((await completeOrderPayment({ ...request, expectedGrandTotal: 1 })).ok, false);
      assert.equal((await completeOrderPayment({ ...request, tenderedAmount: 1 })).ok, false);
      assert.equal((await completeOrderPayment({ ...request, orderId: String(foreign._id) })).ok, false);
      assert.equal(await Payment.countDocuments({ orderId }), 0);
      // Completion is a financial terminal state and cannot bypass payment.
      await Order.updateOne({ _id: orderId }, { $set: { status: "SERVED" } });
      assert.equal((await changeOrderStatus(orderId, "COMPLETED")).ok, false);
      const outcomes = await Promise.all([completeOrderPayment(request), completeOrderPayment({ ...request, idempotencyKey: randomUUID() })]);
      assert.equal(outcomes.filter(result => result.ok).length, 1);
      assert.equal(await Payment.countDocuments({ orderId }), 1);
      const paid = await Order.findById(orderId); assert.equal(paid.paidAmount, 100); assert.equal(paid.status, "COMPLETED");
      assert.equal((await cancelOrder(orderId, "Cannot cancel paid order")).ok, false);
      await Order.updateOne({ _id: orderId }, { $set: { "customerSnapshot.name": "=1+1" } });
      const response = await csvGET(new Request(reportURL)); assert.equal(response.status, 200);
      const body = await response.text(); assert.ok(!body.includes("FOREIGN-ORDER")); assert.ok(body.includes('"\'=1+1"'));
    });
    await t.test("waiter flow hides bills, isolates requests, enforces approval and uses the cashier sale", {skip:!hello.setName&&hello.msg!=="isdbgrid"},async()=>{
      await WaiterRequest.init();
      const table=await RestaurantTable.create({businessId:a._id,name:"Table 1"});
      const submission={submissionKey:randomUUID(),revision:0,input:{...input,tableId:String(table._id)}};
      await signIn(waiter);
      const sent=await saveWaiterRequest(submission);assert.equal(sent.ok,true,JSON.stringify(sent));
      const retried=await saveWaiterRequest(submission);assert.equal(retried.id,sent.id);
      assert.equal(await WaiterRequest.countDocuments({userId:waiter._id}),1);
      let view=await waiterWorkspace();assert.equal(view.showSummary,false);assert.equal("summary" in view.requests[0],false);assert.equal("price" in view.catalog[0],false);
      assert.equal((await confirmWaiterRequest(sent.id,0)).ok,false);
      const otherWaiter=await account(a,"waiter.other","WAITER");await signIn(otherWaiter);
      assert.equal((await saveWaiterRequest({...submission,id:sent.id})).ok,false);
      assert.equal((await waiterWorkspace()).requests.length,0);
      await signIn(otherOwner);assert.equal((await confirmWaiterRequest(sent.id,0)).ok,false);
      await signIn(cashier);await assert.rejects(saveWaiterVisibility(true),/Only the restaurant owner/);
      await signIn(owner);await saveWaiterVisibility(true);
      await signIn(waiter);view=await waiterWorkspace();assert.equal(view.requests[0].summary.grandTotal,100);assert.equal(view.catalog[0].price,100);
      const edited=await saveWaiterRequest({...submission,id:sent.id,input:{...submission.input,lines:[{...submission.input.lines[0],quantity:2}]}});assert.equal(edited.ok,true);
      await signIn(cashier);assert.equal((await confirmWaiterRequest(sent.id,0)).ok,false);
      const before=await Order.countDocuments({businessId:a._id});
      const outcomes=await Promise.all([confirmWaiterRequest(sent.id,1),confirmWaiterRequest(sent.id,1)]);assert.equal(outcomes.filter(o=>o.ok).length,1,JSON.stringify(outcomes));
      assert.equal(await Order.countDocuments({businessId:a._id}),before+1);
      const request=await WaiterRequest.findById(sent.id),order=await Order.findById(request.orderId),sale=await SaleSession.findById(order.saleSessionId);
      assert.equal(String(sale.userId),String(cashier._id));assert.equal(order.grandTotal,200);assert.equal(order.status,"SENT_TO_KITCHEN");assert.equal(order.waiterNameSnapshot,waiter.fullName);
      await signIn(waiter);assert.equal((await saveWaiterRequest({...submission,id:sent.id,revision:1})).ok,false);
      assert.equal((await waiterWorkspace()).requests[0].status,"SENT_TO_KITCHEN");
      await signIn(owner);assert.equal((await changeOrderStatus(String(order._id),"PREPARING")).ok,true);
      await saveWaiterVisibility(false);await signIn(waiter);view=await waiterWorkspace();assert.equal(view.requests[0].status,"PREPARING");assert.equal("summary" in view.requests[0],false);
    });
    await t.test("SMS settings are owner-only and both paid-order flows enqueue one customer receipt",{skip:!hello.setName&&hello.msg!=="isdbgrid"},async()=>{
      await SmsMessage.init();
      const oldEndpoint=process.env.SMS_API;process.env.SMS_API="https://sms.example.test/";
      const settings={enabled:true,paymentReceiptEnabled:true,includeOptOut:false,token:"fixture-subscription-token",removeToken:false,template:"Thank you {{customer_name}}. {{order_number}} paid {{currency}} {{amount_paid}}.",evidenceReference:"customer-acknowledgement"};
      try{
        await signIn(cashier);await assert.rejects(saveSmsSettings(settings),/Only the restaurant owner/);
        await signIn(waiter);await assert.rejects(saveSmsSettings(settings),/Only the restaurant owner/);
        await signIn(owner);const configured=await saveSmsSettings(settings);assert.equal(configured.ok,true,JSON.stringify(configured));assert.equal(configured.hasToken,true);
        assert.equal((await Business.findById(a._id)).smsIncludeOptOut,false);
        assert.equal((await Business.findById(a._id)).smsTokenEncrypted,undefined);
        const encrypted=(await Business.findById(a._id).select("+smsTokenEncrypted")).smsTokenEncrypted;assert.ok(encrypted&&!encrypted.includes(settings.token));
        assert.equal((await saveSmsSettings({...settings,token:""})).ok,true);assert.equal((await Business.findById(a._id).select("+smsTokenEncrypted")).smsTokenEncrypted,encrypted);
        assert.notEqual((await Business.findById(b._id)).smsEnabled,true);
        const customer=await Customer.create({businessId:a._id,name:"SMS customer",phone:"03133551379"});
        const saved=await saveOrder({...input,customerId:String(customer._id)});assert.equal(saved.ok,true,JSON.stringify(saved));
        const pay={orderId:saved.orderId,idempotencyKey:randomUUID(),method:"CASH",expectedGrandTotal:100,tenderedAmount:100,reference:"",notes:""};
        const payments=await Promise.all([completeOrderPayment(pay),completeOrderPayment({...pay,idempotencyKey:randomUUID()})]);assert.equal(payments.filter(row=>row.ok).length,1);
        assert.equal(await SmsMessage.countDocuments({businessId:a._id,orderId:saved.orderId}),1);
        const takeaway=await completeTakeawayPayment({...input,orderType:"TAKEAWAY",customerId:String(customer._id)},{...pay,idempotencyKey:randomUUID()});assert.equal(takeaway.ok,true,JSON.stringify(takeaway));
        const messages=await SmsMessage.find({businessId:a._id}).lean();assert.equal(messages.length,2);assert.ok(messages.every(row=>row.status==="PENDING"&&row.includeOptOut===false&&row.to==="+923133551379"&&row.body.includes("100.00")));assert.equal(await SmsMessage.countDocuments({businessId:b._id}),0);
        assert.equal((await saveSmsSettings({...settings,enabled:false,paymentReceiptEnabled:false,removeToken:true,token:""})).ok,true);
        assert.equal((await Business.findById(a._id).select("+smsTokenEncrypted")).smsTokenEncrypted,undefined);
      }finally{if(oldEndpoint===undefined)delete process.env.SMS_API;else process.env.SMS_API=oldEndpoint}
    });
    await t.test("delivery completion collects payment atomically, sends only Delivered, and requires confirmation for already-paid orders",{skip:!hello.setName&&hello.msg!=="isdbgrid"},async()=>{
      const configs={placed:{enabled:true,includeOptOut:false,template:"Placed {{order_number}} for {{customer_name}} at {{delivery_address}}. {{currency}} {{order_total}}"},outForDelivery:{enabled:true,includeOptOut:true,template:"On the way: {{order_number}} to {{delivery_area}}."},delivered:{enabled:true,includeOptOut:false,template:"Delivered {{order_number}}. Thank you {{customer_name}}!"}};
      await signIn(cashier);await assert.rejects(saveDeliverySmsSettings(configs),/Only the restaurant owner/);
      await signIn(owner);assert.equal((await saveDeliverySmsSettings(configs)).ok,true);
      assert.equal((await Business.findById(a._id)).smsDeliveryMessages.outForDelivery.includeOptOut,true);
      await Business.updateOne({_id:a._id},{$set:{smsEnabled:true,smsPaymentReceiptEnabled:true}});
      const customer=await Customer.create({businessId:a._id,name:"Delivery customer",phone:"03133551379"});
      const delivery={...input,orderType:"DELIVERY",customerId:String(customer._id),deliveryAddress:"12 Main Street",deliveryArea:"City Centre",deliveryCharge:50};
      await signIn(cashier);const saved=await saveOrder(delivery);assert.equal(saved.ok,true,JSON.stringify(saved));
      const orderId=saved.orderId;assert.equal((await Order.findById(orderId)).deliveryStatus,"PLACED");
      const paymentInput={orderId,idempotencyKey:randomUUID(),method:"CASH",expectedGrandTotal:150,tenderedAmount:150,reference:"",notes:""};
      assert.equal((await completeOrderPayment(paymentInput)).ok,false);
      assert.equal((await completeDeliveryPayment(paymentInput)).ok,false);
      assert.equal(await Payment.countDocuments({orderId}),0);
      let messages=await SmsMessage.find({orderId}).lean();assert.equal(messages.length,1);assert.equal(messages[0].messageType,"DELIVERY_PLACED");assert.match(messages[0].body,/12 Main Street/);assert.match(messages[0].body,/150.00/);assert.equal(messages[0].includeOptOut,false);
      assert.equal((await saveOrder({...delivery,deliveryNotes:"Ring bell"},orderId)).ok,true);assert.equal(await SmsMessage.countDocuments({orderId}),1);
      assert.equal((await changeDeliveryStatus(orderId,"OUT_FOR_DELIVERY")).ok,false);assert.equal((await changeDeliveryStatus(orderId,"DELIVERED")).ok,false);
      await signIn(owner);assert.equal((await changeOrderStatus(orderId,"PREPARING")).ok,true);assert.equal((await changeOrderStatus(orderId,"READY")).ok,true);assert.equal((await changeOrderStatus(orderId,"SERVED")).ok,false);
      await signIn(otherOwner);assert.equal((await changeDeliveryStatus(orderId,"OUT_FOR_DELIVERY")).ok,false);
      await signIn(waiter);assert.equal((await changeDeliveryStatus(orderId,"OUT_FOR_DELIVERY")).ok,false);
      await signIn(cashier);const dispatches=await Promise.all([changeDeliveryStatus(orderId,"OUT_FOR_DELIVERY"),changeDeliveryStatus(orderId,"OUT_FOR_DELIVERY")]);assert.equal(dispatches.filter(row=>row.ok).length,1,JSON.stringify(dispatches));
      assert.equal((await saveOrder(delivery,orderId)).ok,false);
      assert.equal((await changeDeliveryStatus(orderId,"DELIVERED")).ok,false);assert.equal((await changeDeliveryStatus(orderId,"DELIVERED",true)).ok,false);
      assert.equal((await completeDeliveryPayment({...paymentInput,tenderedAmount:1})).ok,false);
      assert.equal((await completeDeliveryPayment({...paymentInput,expectedGrandTotal:1})).ok,false);
      let order=await Order.findById(orderId);assert.equal(order.deliveryStatus,"OUT_FOR_DELIVERY");assert.equal(order.paymentStatus,"UNPAID");assert.equal(await SmsMessage.countDocuments({orderId}),2);assert.equal(await Payment.countDocuments({orderId}),0);
      const limited=await account(a,"limited.delivery.collector","CASHIER");await User.updateOne({_id:limited._id},{$set:{privileges:["orders","payments"]}});await signIn(limited);assert.equal((await completeDeliveryPayment(paymentInput)).ok,false);assert.equal(await Payment.countDocuments({orderId}),0);
      await signIn(otherOwner);assert.equal((await completeDeliveryPayment(paymentInput)).ok,false);await signIn(cashier);
      const receipts=await Promise.all([completeDeliveryPayment(paymentInput),completeDeliveryPayment({...paymentInput,idempotencyKey:randomUUID()})]);assert.equal(receipts.filter(row=>row.ok).length,1,JSON.stringify(receipts));
      order=await Order.findById(orderId);assert.equal(order.deliveryStatus,"DELIVERED");assert.equal(order.paymentStatus,"PAID");assert.equal(order.status,"COMPLETED");assert.equal(order.dueAmount,0);assert.ok(order.deliveredAt&&order.outForDeliveryAt);assert.equal(await Payment.countDocuments({orderId}),1);
      assert.equal((await completeDeliveryPayment(paymentInput)).ok,false);assert.equal((await changeDeliveryStatus(orderId,"DELIVERED",true)).ok,false);
      messages=await SmsMessage.find({orderId}).sort({createdAt:1}).lean();assert.deepEqual(messages.map(row=>row.messageType),["DELIVERY_PLACED","DELIVERY_OUT_FOR_DELIVERY","DELIVERY_DELIVERED"]);assert.deepEqual(messages.map(row=>row.includeOptOut),[false,true,false]);
      assert.equal(await SmsMessage.countDocuments({orderId,messageType:"PAYMENT_RECEIPT"}),0);
      const prepaid=await saveOrder(delivery);assert.equal(prepaid.ok,true);
      assert.equal((await completeOrderPayment({...paymentInput,orderId:prepaid.orderId,idempotencyKey:randomUUID()})).ok,false);
      // Existing paid records still need explicit delivery confirmation and must
      // never receive another charge. New delivery prepayment is not allowed.
      await Order.updateOne({_id:prepaid.orderId},{$set:{paymentStatus:"PAID",paidAmount:150,dueAmount:0}});
      await Payment.create({businessId:a._id,orderId:prepaid.orderId,idempotencyKey:randomUUID(),amount:150,tenderedAmount:150,method:"CASH",receivedByUserId:cashier._id});
      assert.equal((await Order.findById(prepaid.orderId)).status,"SENT_TO_KITCHEN");
      await signIn(owner);assert.equal((await changeOrderStatus(prepaid.orderId,"READY")).ok,true);
      await signIn(cashier);assert.equal((await changeDeliveryStatus(prepaid.orderId,"OUT_FOR_DELIVERY")).ok,true);assert.equal((await changeDeliveryStatus(prepaid.orderId,"DELIVERED")).ok,false);assert.equal((await Order.findById(prepaid.orderId)).deliveryStatus,"OUT_FOR_DELIVERY");
      assert.equal((await changeDeliveryStatus(prepaid.orderId,"DELIVERED",true)).ok,true);assert.equal((await Order.findById(prepaid.orderId)).status,"COMPLETED");assert.equal(await Payment.countDocuments({orderId:prepaid.orderId}),1);
      assert.equal(await SmsMessage.countDocuments({orderId:prepaid.orderId}),3);
      await Business.updateOne({_id:a._id},{$set:{smsEnabled:false}});
    });
    await t.test("owner credential changes require reauthentication and revoke older sessions", async () => {
      const old = await signIn(owner), update = { fullName: owner.fullName, phone: "03001234567", username: owner.username, password: "ChangedPassword123" };
      assert.equal((await saveOwnerProfile(update)).ok, false);
      assert.equal((await saveOwnerProfile({ ...update, currentPassword: password })).ok, true);
      const renewed = jar.get("restaurant_pos_session"); assert.notEqual(old, renewed);
      useCookie(old); assert.equal(await getCurrentUser(), null);
      useCookie(renewed); assert.equal((await getCurrentUser()).id, String(owner._id));
      // Staff password resets invalidate active tokens without disabling 2FA.
      const staffCookie = await signIn(cashier); useCookie(renewed);
      assert.equal((await saveUserAccount(String(cashier._id), { fullName: cashier.fullName, phone: "03001234567", username: cashier.username, password: "ResetPassword123", role: "CASHIER", isActive: true, privileges: ["pos", "orders", "payments", "sale_sessions"] })).ok, true);
      useCookie(staffCookie); assert.equal(await getCurrentUser(), null);
    });
    await t.test("logout revokes the token even if a copied cookie is replayed", async () => {
      const token = await signIn(owner); await deleteSession(); assert.equal(jar.size, 0);
      useCookie(token); assert.equal(await getCurrentUser(), null);
      const fresh = await signIn(owner); assert.notEqual(fresh, token); assert.ok(await getCurrentUser());
    });
  } finally {
    jar.clear(); delete globalThis.mongooseConnection;
    assert.match(mongoose.connection.name, /^pos_security_test_[a-f0-9]+$/);
    try { await mongoose.connection.dropDatabase(); } finally { await mongoose.disconnect(); }
  }
});
