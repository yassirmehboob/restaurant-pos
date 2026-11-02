import assert from "node:assert/strict";
import test from "node:test";
import { can,permissionsFor,PRIVILEGE_KEYS,routePrivilege } from "../lib/permissions.ts";
import { userAccountSchema,ownerProfileSchema } from "../lib/validation/user-account.ts";
test("owner retains all access; role defaults apply only when no override exists",()=>{
 assert.deepEqual(permissionsFor({role:"OWNER",privileges:[]}),PRIVILEGE_KEYS);
 assert.equal(can({role:"CASHIER"},"payments"),true);
 assert.equal(can({role:"WAITER"},"payments"),false);
 assert.equal(can({role:"KITCHEN"},"reports"),false);
 assert.equal(can({role:"ADMIN",privileges:[]},"settings"),false);
});
test("explicit grants and revocations override role presets without adding other permissions",()=>{
 const user={role:"KITCHEN",privileges:["orders","printing"]};
 assert.equal(can(user,"orders"),true);assert.equal(can(user,"printing"),true);assert.equal(can(user,"kitchen"),false);assert.equal(can(user,"payments"),false);
 assert.equal(routePrivilege("/users"),"owner");assert.equal(routePrivilege("/orders/abc"),"orders");assert.equal(routePrivilege("/reports/profit-loss"),"profit");
});
const valid={fullName:"Test Cashier",phone:"03001234567",username:" TEST.CASHIER ",password:"TestPass123",role:"CASHIER",isActive:true,privileges:["pos","orders"]};
test("owner profile accepts identity changes and strips access-control fields",()=>{
 const profile=ownerProfileSchema.parse({...valid,role:"CASHIER",isActive:false,privileges:[]});
 assert.deepEqual(Object.keys(profile).sort(),["fullName","password","phone","username"]);
 assert.equal(profile.username,"test.cashier");
 assert.equal(ownerProfileSchema.parse({...valid,password:""}).password,"");
});
test("account validation normalizes usernames and rejects invalid access and account fields",()=>{
 assert.equal(userAccountSchema.parse(valid).username,"test.cashier");
 assert.equal(userAccountSchema.parse({...valid,password:""}).password,"");
 assert.equal(userAccountSchema.safeParse({...valid,role:"OWNER"}).success,true);
 for(const update of [{role:"SUPERADMIN"},{privileges:["unknown"]},{phone:"no-mobile"},{password:"short"},{username:"bad name"},{isActive:"yes"}])assert.equal(userAccountSchema.safeParse({...valid,...update}).success,false);
});
test("manager, supervisor and chef roles get their default access and can be saved",()=>{
 assert.equal(can({role:"MANAGER"},"profit"),true);assert.equal(can({role:"MANAGER"},"settings"),false);assert.equal(can({role:"MANAGER"},"waiter"),false);
 assert.equal(can({role:"SUPERVISOR"},"cancel_orders"),true);assert.equal(can({role:"SUPERVISOR"},"profit"),false);assert.equal(can({role:"SUPERVISOR"},"staff"),false);
 assert.equal(can({role:"CHEF"},"kitchen"),true);assert.equal(can({role:"CHEF"},"payments"),false);
 for(const role of ["MANAGER","SUPERVISOR","CHEF"])assert.equal(userAccountSchema.safeParse({...valid,role}).success,true);
 assert.equal(userAccountSchema.safeParse({...valid,role:"CLEANER"}).success,false);
});
test("staff CNIC, address and remarks are optional and CNIC is normalized",async()=>{
 const{staffSchema}=await import("../lib/validation/master-data.ts");
 const base={fullName:"Ali Khan",role:"CLEANER",phone:"",cnic:"",address:"",remarks:""};
 assert.equal(staffSchema.safeParse(base).success,true);
 assert.equal(staffSchema.parse({...base,cnic:"4210112345671"}).cnic,"42101-1234567-1");
 assert.equal(staffSchema.parse({...base,cnic:"42101-1234567-1"}).cnic,"42101-1234567-1");
 assert.equal(staffSchema.safeParse({...base,cnic:"12345"}).success,false);
 assert.equal("code" in staffSchema.parse({...base,code:"W-01"}),false);
});
