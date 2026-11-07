import assert from "node:assert/strict";
import test from "node:test";
import { kitchenLanguage,localLanguageOf,localName,nameViewOf,namesToTranslate } from "../lib/kitchen-language.ts";
import { EscPos,columnsFor } from "../lib/escpos.ts";
import { decodeEscPos } from "../lib/receipt-raster.ts";
import { receiptItemRows } from "../lib/receipt-lines.ts";
import { renderReceipt } from "../lib/receipt-layout.ts";
import { cleanTranslation } from "../lib/translation/clean.mjs";

const urdu={"Chicken Burger":"چکن برگر","Mutton Karahi":"مٹن کڑاہی","Pizza (Small)":"پیزا (چھوٹا)","Deal 1":"ڈیل 1"};
const money=value=>value.toFixed(2);

test("the five kitchen languages map to what each ticket prints", () => {
  assert.deepEqual(["EN","SD","UR","EN_SD","EN_UR"].map(value=>[localLanguageOf(value),nameViewOf(value)]),[[null,"EN"],["sd","LOCAL"],["ur","LOCAL"],["sd","BOTH"],["ur","BOTH"]]);
  assert.equal(kitchenLanguage("FRENCH"),"EN");
  assert.equal(kitchenLanguage(undefined),"EN");
});

test("names are found exactly, and weighed items keep their weight", () => {
  assert.equal(localName("Chicken Burger",urdu),"چکن برگر");
  assert.equal(localName("Pizza (Small)",urdu),"پیزا (چھوٹا)","a size translated as a whole wins");
  assert.equal(localName("Mutton Karahi (500 g)",urdu),"مٹن کڑاہی (500 g)");
  assert.equal(localName("Beef Burger",urdu),undefined);
  assert.deepEqual(namesToTranslate(["Mutton Karahi (500 g)","Chicken Burger"," ","Chicken Burger"]),["Mutton Karahi (500 g)","Mutton Karahi","Chicken Burger"]);
});

test("Sindhi and Urdu travel inside the print job and come back out unchanged", () => {
  const p=new EscPos(42).text("Before").local("  ڪڪڙ جو برگر  ").text("After");
  assert.equal(p.localText,true);
  const rows=decodeEscPos(p.toBase64()).filter(row=>row.kind==="text");
  assert.deepEqual(rows.map(row=>[row.text,Boolean(row.rtl)]),[["Before",false],["ڪڪڙ جو برگر",true],["After",false]]);
  assert.equal(new EscPos(42).text("English only").localText,false);
});

test("item rows: English, translation only, or both; missing translations stay English", () => {
  const items=[{name:"Chicken Burger",unitPrice:400,quantity:2,local:"چکن برگر"},{name:"Beef Burger",unitPrice:550,quantity:1},{name:"Deal 1",unitPrice:900,quantity:1,local:"ڈیل 1",components:["Chicken Burger - Qty 1"],localComponents:["چکن برگر × 1"]}];
  const view=names=>receiptItemRows(items,42,money,{prices:false,names}).filter(row=>row.kind!=="head").map(row=>row.rtl?`RTL:${row.text}`:row.text.trim());
  assert.ok(!view("EN").some(row=>row.startsWith("RTL:")));
  const local=view("LOCAL");
  assert.deepEqual(local.map(row=>row.replace(/\s+/g," ")),["RTL:چکن برگر","1 2","Beef Burger","2 1","RTL:ڈیل 1","3 1","RTL:چکن برگر × 1"]);
  assert.ok(local.includes("Beef Burger"),"no translation: English");
  assert.ok(!local.some(row=>row.includes("> Chicken Burger")),"a translated component is not repeated in English");
  const both=view("BOTH");
  assert.ok(both.some(row=>row.includes("Chicken Burger"))&&both.includes("RTL:چکن برگر"));
  assert.ok(both.indexOf("RTL:چکن برگر")>both.findIndex(row=>row.includes("Chicken Burger")),"the translation sits under the English name");
  assert.ok(both.includes("> Chicken Burger - Qty 1")&&both.includes("RTL:چکن برگر × 1"));
  // Every quantity is still printed in each view.
  for(const rows of [view("EN"),local,both])assert.ok(rows.some(row=>/\b2$/.test(row)),rows.join("\n"));
});

test("a kitchen ticket carries the translations only when its language asks for them", () => {
  const order={orderNumber:"ORD-1",createdAt:"2026-11-07T10:00:00Z",orderType:"DINE_IN",paymentStatus:"UNPAID",items:[{quantity:2,nameSnapshot:"Chicken Burger",unitPrice:400},{quantity:1,nameSnapshot:"Mutton Karahi (500 g)",unitPrice:2400}],subtotal:3200,taxAmount:0,grandTotal:3200,paidAmount:0,dueAmount:3200};
  const ticket=language=>renderReceipt("kitchen",{name:"Cafe",kitchenReceiptLanguage:language},order,{translations:urdu}).flatMap(part=>part.type==="command"?decodeEscPos(part.base64):[]).filter(row=>row.kind==="text");
  const rtl=rows=>rows.filter(row=>row.rtl).map(row=>row.text);
  assert.deepEqual(rtl(ticket("EN")),[]);
  assert.deepEqual(rtl(ticket("UR")),["چکن برگر","مٹن کڑاہی (500 g)"]);
  assert.ok(!ticket("UR").some(row=>row.text.includes("Chicken Burger")));
  assert.deepEqual(rtl(ticket("EN_UR")),["چکن برگر","مٹن کڑاہی (500 g)"]);
  assert.ok(ticket("EN_UR").some(row=>row.text.includes("Chicken Burger")));
  // Customer receipts are never translated.
  const customer=renderReceipt("customer",{name:"Cafe",kitchenReceiptLanguage:"UR"},order,{translations:urdu}).flatMap(part=>part.type==="command"?decodeEscPos(part.base64):[]);
  assert.ok(!customer.some(row=>row.rtl));
  assert.equal(columnsFor("80"),42);
});

test("NLLB output is trimmed to the Arabic-script translation", () => {
  assert.equal(cleanTranslation("زنجر برگر Ζιντζερ Ζιντζερ"),"زنجر برگر");
  assert.equal(cleanTranslation("  چکن   برگر  "),"چکن برگر");
  assert.equal(cleanTranslation("Veggie Pizza - - -"),"","no Arabic letters: not a translation");
  assert.equal(cleanTranslation(undefined),"");
});
