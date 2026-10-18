import assert from "node:assert/strict";import test from "node:test";
import {businessTaxRates,paymentTaxQuote} from "../lib/tax.ts";import {calculateOrderPreview} from "../lib/order-calculation.ts";import {businessTaxSchema} from "../lib/validation/tax.ts";
const line={key:"item",name:"Burger",quantity:2,unitPrice:500,taxRate:20,isTaxInclusive:true};
const rates=businessTaxRates({saleTaxRate:16,paymentTaxRates:{CARD:5,BANK:0}});
test("method overrides inherit default while explicit zero stays tax-free",()=>{assert.deepEqual(rates,{CASH:16,CARD:5,BANK:0,OTHER:16});assert.equal(businessTaxRates({}),undefined)});
test("business invoice tax replaces product tax and applies once, excluding delivery",()=>{
 const cash=calculateOrderPreview([line],50,rates.CASH);assert.equal(cash.subtotal,1000);assert.equal(cash.taxAmount,160);assert.equal(cash.grandTotal,1210);assert.equal(cash.lines[0].isTaxInclusive,false);
 const card=calculateOrderPreview([line],50,rates.CARD);assert.equal(card.grandTotal,1100);assert.equal(calculateOrderPreview([line],50,0).grandTotal,1050);
});
const order={items:[{lineId:"item",nameSnapshot:"Burger",quantity:2,unitPrice:500,taxRate:16,isTaxInclusive:false}],subtotal:1000,taxAmount:160,grandTotal:1210,dueAmount:1210,paidAmount:0,deliveryChargeAmount:50,paymentTaxRatesSnapshot:rates,taxPaymentMethod:"CASH",taxRateSnapshot:16};
test("payment method quotes use invoice snapshots rather than later profile settings",()=>{
 const current=businessTaxRates({saleTaxRate:30,paymentTaxRates:{CARD:12}});assert.equal(current.CARD,12);const quote=paymentTaxQuote(order,"CARD");assert.equal(quote.taxRate,5);assert.equal(quote.taxAmount,50);assert.equal(quote.grandTotal,1100);assert.equal(quote.lines[0].lineTotal,1050);assert.equal(order.grandTotal,1210);
});
test("legacy invoices preserve saved totals and partial payments cannot change tax method",()=>{
 const legacy={...order,paymentTaxRatesSnapshot:undefined};assert.equal(paymentTaxQuote(legacy,"BANK").grandTotal,1210);
 assert.throws(()=>paymentTaxQuote({...order,paidAmount:100},"CARD"),/partially paid/);assert.equal(paymentTaxQuote({...order,paidAmount:100,dueAmount:1110},"CASH").dueAmount,1110);
});
test("taxes round to cents and percentages reject invalid values",()=>{
 const result=calculateOrderPreview([{...line,quantity:3,unitPrice:0.99}],0,5);assert.equal(result.taxAmount,0.15);assert.equal(result.grandTotal,3.12);
 const valid={rate:0,overrides:{CASH:null,CARD:5,BANK:0,OTHER:null}};assert.equal(businessTaxSchema.safeParse(valid).success,true);for(const rate of [-1,101,Infinity,NaN])assert.equal(businessTaxSchema.safeParse({...valid,rate}).success,false);
});
