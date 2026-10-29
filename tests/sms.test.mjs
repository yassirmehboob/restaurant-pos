import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PAYMENT_SMS,DELIVERY_SMS_STAGES,normalizeSmsPhone,renderPaymentSms,smsTemplateError } from "../lib/sms-template.ts";
import { smsSettingsSchema,deliverySmsSettingsSchema } from "../lib/validation/sms.ts";
import { encryptSmsToken,decryptSmsToken } from "../lib/sms-crypto.mjs";
import { smsEndpoint } from "../lib/sms-delivery.mjs";
import { readSmsApiStatus } from "../lib/sms-api-response.mjs";
import { smsHistoryFilter } from "../lib/sms-history.ts";
import { routePrivilege } from "../lib/permissions.ts";

test("payment templates replace supported fields literally and reject invalid placeholders",()=>{
 const fields={customer_name:"Ali $&",business_name:"Cafe",order_number:"ORD-1",currency:"PKR",amount_paid:"100.00",order_total:"100.00",payment_method:"CASH",paid_at:"28/10/2026",customer_phone:"+923133551379",table_name:"Table 1"};
 assert.match(renderPaymentSms(DEFAULT_PAYMENT_SMS,fields),/Ali \$&/);
 assert.equal(renderPaymentSms("{{customer_name}} / {{customer_name}}",fields),"Ali $& / Ali $&");
 for(const template of ["","{{password}}","{customer_name}","{{customer_name}","{{customer_name}}"+"x".repeat(1000)])assert.ok(smsTemplateError(template));
 assert.throws(()=>renderPaymentSms("{{customer_name}}",{...fields,customer_name:"a".repeat(1601)}));
 assert.equal(smsTemplateError("Thank you! شکریہ"),null);
});
test("SMS numbers accept international format and normalize Pakistani mobiles",()=>{
 for(const phone of ["+923133551379","0313 3551379","923133551379","00923133551379","+92 (313) 355-1379"])assert.equal(normalizeSmsPhone(phone),"+923133551379");
 for(const phone of ["","123","+00123456789","0313abc1379","+923133551379 ext 1","+"+"1".repeat(16)])assert.equal(normalizeSmsPhone(phone),null);
 assert.equal(normalizeSmsPhone("+14155552671"),"+14155552671");
});
test("business subscription tokens are encrypted and authenticated per business",()=>{
 const key="sms-test-secret-".repeat(4),token="business-private-token";
 const encrypted=encryptSmsToken(token,key,"business-a");
 assert.ok(!encrypted.includes(token));assert.equal(decryptSmsToken(encrypted,key,"business-a"),token);
 assert.notEqual(encryptSmsToken(token,key,"business-a"),encrypted);
 assert.throws(()=>decryptSmsToken(encrypted,key,"business-b"));assert.throws(()=>decryptSmsToken(encrypted,key+"changed","business-a"));
 assert.throws(()=>decryptSmsToken("bad",key,"business-a"));
});
test("SMS settings reject unsafe tokens and invalid messages",()=>{
 const settings={enabled:false,paymentReceiptEnabled:true,token:"",removeToken:false,template:DEFAULT_PAYMENT_SMS,evidenceReference:"customer-acknowledgement"};
 assert.ok(smsSettingsSchema.safeParse(settings).success);
 assert.equal(smsSettingsSchema.parse(settings).includeOptOut,true);
 assert.equal(smsSettingsSchema.parse({...settings,includeOptOut:false}).includeOptOut,false);
 assert.equal(smsSettingsSchema.safeParse({...settings,includeOptOut:"false"}).success,false);
 for(const change of [{token:"Bearer abc"},{token:"abc\r\ninjected"},{token:"x",removeToken:true},{enabled:true,removeToken:true},{template:"{{unknown}}"},{evidenceReference:""}])assert.equal(smsSettingsSchema.safeParse({...settings,...change}).success,false);
});
test("SMS endpoint preserves the configured base path and appends v1/messages",()=>{
 assert.equal(smsEndpoint("https://gateway.example/"),"https://gateway.example/v1/messages");
 assert.equal(smsEndpoint("https://gateway.example/api"),"https://gateway.example/api/v1/messages");
 for(const value of ["","file:///tmp/test","https://user:secret@gateway.example","https://gateway.example/?token=secret"])assert.throws(()=>smsEndpoint(value));
});
test("all delivery stages have independent valid templates and message preferences",()=>{
 const values=Object.fromEntries(DELIVERY_SMS_STAGES.map(stage=>[stage.key,{enabled:true,includeOptOut:false,template:stage.template}]));
 assert.ok(deliverySmsSettingsSchema.safeParse(values).success);
 assert.equal(deliverySmsSettingsSchema.safeParse({...values,placed:{...values.placed,template:"{{unknown}}"}}).success,false);
 const rendered=renderPaymentSms("{{delivery_status}}: {{delivery_address}}, {{delivery_area}} ({{delivery_charge}}), {{event_at}}",{delivery_status:"Out for delivery",delivery_address:"12 Main Street",delivery_area:"Centre",delivery_charge:"150.00",event_at:"28/10/2026"});assert.equal(rendered,"Out for delivery: 12 Main Street, Centre (150.00), 28/10/2026");
});
test("SMS response capture keeps only the actual status and redacts subscription tokens",async()=>{
 for(const status of ["queued","delivered",0,500,false,true,""]){
  assert.deepEqual(await readSmsApiStatus(new Response(JSON.stringify({status,token:"secret",body:"private"}))),{apiStatus:String(status),apiStatusReadNote:"CAPTURED"});
 }
 assert.equal((await readSmsApiStatus(new Response(JSON.stringify({status:"Rejected secret-token"})),"secret-token")).apiStatus,"Rejected [redacted]");
 for(const [body,note]of [["","EMPTY_RESPONSE"],["Not JSON","NOT_JSON"],["{}","NO_STATUS_FIELD"],["[]","NO_STATUS_FIELD"],['{"status":null}',"INVALID_STATUS_VALUE"],['{"status":{"secret":"private"}}',"INVALID_STATUS_VALUE"],[JSON.stringify({status:"x".repeat(1001)}),"STATUS_TOO_LONG"],["x".repeat(65537),"RESPONSE_TOO_LARGE"]]){
  const result=await readSmsApiStatus(new Response(body));assert.equal(result.apiStatusReadNote,note);assert.equal("apiStatus" in result,false);
 }
});
test("SMS history filters scope the business and escape search expressions",()=>{
 const {filter}=smsHistoryFilter("business-a",{q:".*[test]",status:"FAILED",type:"DELIVERY_PLACED"});
 assert.equal(filter.businessId,"business-a");assert.equal(filter.status,"FAILED");assert.equal(filter.messageType,"DELIVERY_PLACED");
 const regex=new RegExp(filter.$or[0].orderNumber.$regex);assert.equal(regex.test("plain text"),false);assert.equal(regex.test("order .*[test]"),true);
 const invalid=smsHistoryFilter("business-a",{q:{$ne:""},status:"invalid",type:"unknown",page:"-1"});assert.deepEqual(invalid.filter,{businessId:"business-a"});assert.equal(invalid.page,1);
 assert.equal(routePrivilege("/settings/sms"),"owner");
});
