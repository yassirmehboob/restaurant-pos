import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { Business } from "../models/Business.ts";
import { User } from "../models/User.ts";
import { Order } from "../models/Order.ts";
import { SaleSession } from "../models/SaleSession.ts";
import { Category } from "../models/Category.ts";
import { Product } from "../models/Product.ts";
import { changeCartQuantity, removeCartRow } from "../lib/pos-cart.ts";
import { renderReceipt } from "../lib/receipt-layout.ts";

const jar=new Map();
globalThis.__posCartCookies={get:name=>jar.has(name)?{value:jar.get(name)}:undefined,set:(name,value)=>jar.set(name,value),delete:name=>jar.delete(name)};
registerHooks({resolve(specifier,context,next){
  const mocks={"next/headers":"export async function cookies(){return globalThis.__posCartCookies;} export async function headers(){return new Headers();}","next/navigation":"export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}","next/cache":"export function revalidatePath(){}"};
  return mocks[specifier]?{url:"data:text/javascript,"+encodeURIComponent(mocks[specifier]),shortCircuit:true}:next(specifier,context);
}});

test("business cart settings and split rows survive save, reopen, reduction and invoice printing",{skip:!process.env.MONGODB_URI||!process.env.AUTH_SECRET},async t=>{
  await mongoose.connect(process.env.MONGODB_URI,{dbName:`pos_cart_test_${randomUUID().replaceAll("-","")}`,serverSelectionTimeoutMS:5000});
  globalThis.mongooseConnection=Promise.resolve(mongoose);
  try{
    const {createSession}=await import("../lib/auth/session.ts");
    const {saveCartSettings}=await import("../app/(dashboard)/settings/business/cart-actions.ts");
    const {updatePrintingSettings}=await import("../app/(dashboard)/settings/printing/actions.ts");
    const setReprint=async value=>{
      const form=new FormData();
      for(const [key,entry] of Object.entries({receiptPaperWidth:"80",showOrderReadyTime:"NO",showLogoOnCustomerReceipt:"YES",showPricesOnKitchenReceipt:"NO",printerMode:"QZ",onePrinterMode:"YES",customerPrinterConnection:"USB",customerPrinterPort:"9100",kitchenPrinterConnection:"USB",kitchenPrinterPort:"9100",customerPrintingEnabled:"YES",kitchenPrintingEnabled:"YES",autoPrintCustomerOnPayment:"NO",autoPrintUnpaidDineIn:"NO",unpaidDineInReceiptCopies:"1",customerReceiptCopies:"1",kitchenReceiptCopies:"1",customerReceiptFont:"STANDARD",customerReceiptSize:"NORMAL",kitchenReceiptFont:"STANDARD",kitchenReceiptSize:"NORMAL",customerReceiptFamily:"PRINTER",kitchenReceiptFamily:"PRINTER"}))form.set(key,entry);
      if(value!==undefined)form.set("promptCustomerInvoiceOnUpdate",value);
      return updatePrintingSettings(undefined,form);
    };
    const {saveOrder}=await import("../app/(dashboard)/orders/actions.ts");
    await Promise.all([User.init(),Order.init(),SaleSession.init()]);
    const business=await Business.create({name:"Cart test",saleTaxRate:0});
    const other=await Business.create({name:"Other restaurant"});
    const owner=await User.create({businessId:business._id,fullName:"Owner",username:"cart.owner",role:"OWNER",passwordHash:"x"});
    const cashier=await User.create({businessId:business._id,fullName:"Cashier",username:"cart.cashier",role:"CASHIER",passwordHash:"x"});
    const login=async user=>createSession({userId:String(user._id),businessId:String(business._id),role:user.role,authVersion:0});
    await login(owner);
    await SaleSession.create({businessId:business._id,userId:owner._id,userNameSnapshot:owner.fullName,counterName:"Main",counterKey:"main",saleDate:"2026-11-16",openingBalance:0});
    const category=await Category.create({businessId:business._id,name:"Food"});
    const product=await Product.create({businessId:business._id,categoryId:category._id,name:"Burger",salePrice:100,costPrice:40});
    const input=lines=>({orderType:"DINE_IN",paymentMethod:"CASH",tableId:"",waiterId:"",customerId:"",deliveryAddress:"",deliveryArea:"",deliveryNotes:"",deliveryCharge:0,lines});
    const placed={kind:"PRODUCT",id:String(product._id),lineId:randomUUID(),quantity:2,note:""};
    let orderId;
    await t.test("setting defaults to same row and updates only the authenticated business",async()=>{
      assert.equal(business.cartIncreaseMode,"SAME_LINE");
      assert.equal(business.promptCustomerInvoiceOnUpdate,false);
      await saveCartSettings("NEW_LINE");
      assert.equal((await setReprint("YES")).ok,true);
      assert.equal((await Business.findById(business._id)).cartIncreaseMode,"NEW_LINE");
      assert.equal((await Business.findById(business._id)).promptCustomerInvoiceOnUpdate,true);
      assert.equal((await Business.findById(other._id)).cartIncreaseMode,"SAME_LINE");
      assert.equal((await Business.findById(other._id)).promptCustomerInvoiceOnUpdate,false);
      await assert.rejects(saveCartSettings("INVALID"));
      assert.ok((await setReprint("invalid")).errors?.promptCustomerInvoiceOnUpdate);
      await saveCartSettings("SAME_LINE");
      assert.equal((await Business.findById(business._id)).promptCustomerInvoiceOnUpdate,true,"cart preferences preserve printing preferences");
      await saveCartSettings("NEW_LINE");
      assert.equal((await setReprint(undefined)).ok,true);
      assert.equal((await Business.findById(business._id)).promptCustomerInvoiceOnUpdate,true,"older printing forms preserve the preference");
      await login(cashier);await assert.rejects(saveCartSettings("SAME_LINE"),/permission/);await login(owner);
    });
    await t.test("save separate added quantity as a second invoice row",async()=>{
      await Business.updateOne({_id:business._id},{$set:{printerMode:"QZ"}});
      const first=await saveOrder(input([placed]));assert.equal(first.ok,true,first.message);orderId=first.orderId;
      assert.equal(first.promptCustomerInvoice,false);
      const lines=changeCartQuantity([placed],placed.lineId,1,"NEW_LINE",new Set([placed.lineId]),randomUUID());
      const edited=await saveOrder(input(lines),orderId);assert.equal(edited.ok,true,edited.message);
      assert.equal(edited.promptCustomerInvoice,true);
      assert.equal(edited.printerMode,"QZ");
      assert.equal(edited.printBill,false);
      assert.equal(edited.printKitchen,false);
      const order=await Order.findById(orderId).lean();
      assert.deepEqual(order.items.map(line=>line.quantity),[2,1]);
      assert.equal(new Set(order.items.map(line=>line.lineId)).size,2);
      assert.equal(order.grandTotal,300);
      const output=renderReceipt("customer",{name:"Cart test",receiptPaperWidth:"80"},order);
      const printed=output.filter(part=>part.type==="command").map(part=>Buffer.from(part.base64,"base64").toString("latin1")).join("");
      assert.equal((printed.match(/Burger/g)??[]).length,2);
    });
    await t.test("after reopening, an existing row can be reduced and removed independently",async()=>{
      const order=await Order.findById(orderId).lean();
      const lines=order.items.map(line=>({kind:line.itemType,id:String(line.productId),lineId:line.lineId,quantity:line.quantity,note:line.notes??""}));
      const saved=new Set(lines.map(line=>line.lineId));
      const decreased=changeCartQuantity(lines,lines[0].lineId,-1,"NEW_LINE",saved,randomUUID());
      const result=await saveOrder(input(decreased),orderId);assert.equal(result.ok,true,result.message);
      assert.deepEqual((await Order.findById(orderId)).items.map(line=>line.quantity),[1,1]);
      const remaining=removeCartRow(decreased,lines[0].lineId);
      const removed=await saveOrder(input(remaining),orderId);assert.equal(removed.ok,true,removed.message);
      const updated=await Order.findById(orderId);assert.equal(updated.items.length,1);assert.equal(updated.items[0].lineId,lines[1].lineId);assert.equal(updated.grandTotal,100);
    });
    await t.test("reprint prompts respect customer printing, staff permissions and the saved preference",async()=>{
      const order=await Order.findById(orderId).lean();
      const lines=order.items.map(line=>({kind:line.itemType,id:String(line.productId),lineId:line.lineId,quantity:line.quantity,note:line.notes??""}));
      await Business.updateOne({_id:business._id},{$set:{customerPrintingEnabled:false}});
      assert.equal((await saveOrder(input(lines),orderId)).promptCustomerInvoice,false);
      await Business.updateOne({_id:business._id},{$set:{customerPrintingEnabled:true}});
      await User.updateOne({_id:owner._id},{$set:{role:"ADMIN",privileges:["pos","edit_orders"]}});
      const unprivileged=await saveOrder(input(lines),orderId);assert.equal(unprivileged.ok,true,unprivileged.message);assert.equal(unprivileged.promptCustomerInvoice,false);
      await User.updateOne({_id:owner._id},{$set:{role:"OWNER"},$unset:{privileges:1}});
      assert.equal((await setReprint("NO")).ok,true);
      assert.equal((await saveOrder(input(lines),orderId)).promptCustomerInvoice,false);
    });
  }finally{
    assert.match(mongoose.connection.name,/^pos_cart_test_[a-f0-9]+$/);await mongoose.connection.dropDatabase();await mongoose.disconnect();globalThis.mongooseConnection=undefined;
  }
});
