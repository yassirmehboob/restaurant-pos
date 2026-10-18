import assert from "node:assert/strict";
import test from "node:test";
import { auditFilter,safeAuditMetadata } from "../lib/audit-data.ts";
test("audit metadata redacts nested secrets while preserving useful change flags",()=>{
 const safe=safeAuditMetadata({password:"never-log",passwordHash:"hash",passwordChanged:true,details:[{api_key:"secret",pin:"1234",authToken:"token",amount:50}]});
 assert.equal(safe.password,"[redacted]");assert.equal(safe.passwordHash,"[redacted]");assert.equal(safe.passwordChanged,true);assert.equal(safe.details[0].api_key,"[redacted]");assert.equal(safe.details[0].pin,"[redacted]");assert.equal(safe.details[0].amount,50);
 assert.ok(!JSON.stringify(safe).includes("never-log"));
});
test("audit views without profit access cannot expose nested historical costs",()=>{
 const metadata={before:{salePrice:100,costPrice:50,variants:[{unitCost:20}]},after:{grossProfit:70},amount:100};const safe=safeAuditMetadata(metadata,false);assert.equal(safe.before.costPrice,"[restricted]");assert.equal(safe.before.variants[0].unitCost,"[restricted]");assert.equal(safe.after.grossProfit,"[restricted]");assert.equal(safe.before.salePrice,100);assert.equal(safeAuditMetadata(metadata,true).before.costPrice,50);
});
test("audit dates use actual Pakistan calendar timestamps, including midnight boundaries",()=>{
 const filter=auditFilter("business",{from:"2026-10-18",to:"2026-10-18"});assert.equal(filter.businessId,"business");assert.equal(filter.createdAt.$gte.toISOString(),"2026-10-17T19:00:00.000Z");assert.equal(filter.createdAt.$lte.toISOString(),"2026-10-18T18:59:59.999Z");
});
test("audit searches treat regex metacharacters literally and keep tenant and actor scope",()=>{
 const filter=auditFilter("business",{q:"Price (a+b).*",user:"012345678901234567890123",action:"UPDATE_PRODUCT",entity:"Product"});assert.equal(filter.businessId,"business");assert.equal(filter.userId,"012345678901234567890123");const regex=new RegExp(filter.$or[0].description.$regex);assert.ok(regex.test("Price (a+b).*"));assert.equal(regex.test("Price aaab"),false);assert.equal(filter.action,"UPDATE_PRODUCT");assert.equal(filter.entityType,"Product");
});
