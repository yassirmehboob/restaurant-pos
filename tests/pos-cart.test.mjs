import test from "node:test";
import assert from "node:assert/strict";
import { addCartRow, cartIncreaseMode, changeCartQuantity, changeCartWeight, removeCartRow } from "../lib/pos-cart.ts";
import { receiptItemRows } from "../lib/receipt-lines.ts";

const placed = {kind:"PRODUCT",id:"burger",lineId:"placed",quantity:2,note:"",price:100};
const saved = new Set([placed.lineId]);

test("existing businesses keep same-row increases",()=>{
  assert.equal(cartIncreaseMode(undefined),"SAME_LINE");
  assert.equal(cartIncreaseMode("invalid"),"SAME_LINE");
  const rows=changeCartQuantity([placed],"placed",1,"SAME_LINE",saved,"new");
  assert.deepEqual(rows.map(row=>[row.lineId,row.quantity]),[["placed",3]]);
  assert.equal(addCartRow([placed],{...placed,lineId:"new",quantity:1},"SAME_LINE",saved)[0].quantity,3);
});

test("new-row increases preserve placed quantity and accumulate unsaved additions",()=>{
  let rows=changeCartQuantity([placed],"placed",1,"NEW_LINE",saved,"new");
  rows=changeCartQuantity(rows,"placed",1,"NEW_LINE",saved,"another");
  assert.deepEqual(rows.map(row=>[row.lineId,row.quantity]),[["placed",2],["new",2]]);
  rows=changeCartQuantity(rows,"new",1,"NEW_LINE",saved,"unused");
  assert.deepEqual(rows.map(row=>[row.lineId,row.quantity]),[["placed",2],["new",3]]);
  assert.equal(placed.quantity,2);
});

test("catalog additions also split from placed items while fresh orders use one row",()=>{
  const added={...placed,lineId:"added",quantity:1};
  assert.deepEqual(addCartRow([placed],added,"NEW_LINE",saved).map(row=>row.quantity),[2,1]);
  assert.deepEqual(addCartRow([placed],added,"NEW_LINE",new Set()).map(row=>row.quantity),[3]);
});

test("decrease and remove affect only the selected row in both modes",()=>{
  const repeated={...placed,lineId:"second",quantity:3};
  for(const mode of ["SAME_LINE","NEW_LINE"]){
    const rows=changeCartQuantity([placed,repeated],"placed",-1,mode,saved,"unused");
    assert.deepEqual(rows.map(row=>row.quantity),[1,3]);
    assert.deepEqual(removeCartRow(rows,"placed"),[repeated]);
    assert.equal(changeCartQuantity(rows,"placed",-1,mode,saved,"unused")[0].quantity,1);
  }
});

test("variants, weights, notes, and row quantity limits remain distinct",()=>{
  const added={...placed,lineId:"added",quantity:1};
  for(const distinct of [{variantName:"Large"},{weightGrams:500},{note:"No sauce"}]){
    assert.equal(addCartRow([placed],{...added,...distinct},"NEW_LINE",new Set()).length,2);
  }
  const max={...placed,quantity:99};
  assert.equal(addCartRow([max],added,"NEW_LINE",new Set()).length,2);
  assert.equal(changeCartQuantity([max],"placed",1,"SAME_LINE",saved,"unused")[0].quantity,99);
  assert.deepEqual(addCartRow([max],added,"SAME_LINE",saved).map(row=>row.quantity),[99]);
});

test("weight changes do not collapse placed rows in new-row mode",()=>{
  const rows=[{...placed,weightGrams:500},{...placed,lineId:"new",quantity:1,weightGrams:750}];
  const changed=changeCartWeight(rows,"new",500,100,"NEW_LINE",saved);
  assert.deepEqual(changed.map(row=>[row.lineId,row.quantity,row.weightGrams]),[["placed",2,500],["new",1,500]]);
});

test("reopened saved rows get a separate addition and remain separate in invoice output",()=>{
  const rows=[placed,{...placed,lineId:"second",quantity:1}];
  const reopenedSaved=new Set(rows.map(row=>row.lineId));
  const added=changeCartQuantity(rows,"second",1,"NEW_LINE",reopenedSaved,"third");
  assert.deepEqual(added.map(row=>row.quantity),[2,1,1]);
  const printed=receiptItemRows(added.map(row=>({name:"Burger",unitPrice:row.price,quantity:row.quantity})),42,value=>value.toFixed(2));
  assert.equal(printed.filter(row=>row.text==="Burger").length,3);
});
