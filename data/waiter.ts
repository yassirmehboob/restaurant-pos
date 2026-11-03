import "server-only";
import { requireUser } from "@/data/auth";
import { can } from "@/lib/permissions";
import { Business } from "@/models/Business";
import { Product } from "@/models/Product";
import { Deal } from "@/models/Deal";
import { Category } from "@/models/Category";
import { RestaurantTable } from "@/models/RestaurantTable";
import { WaiterRequest } from "@/models/WaiterRequest";
import { Order } from "@/models/Order";
import { Staff } from "@/models/Staff";
import { isOpenWaiterOrder,waiterRequestView } from "@/lib/waiter-view";

export async function waiterWorkspace(){
 const user=await requireUser(),isWaiter=user.role==="WAITER";
 if(!isWaiter&&(!["OWNER","ADMIN","CASHIER"].includes(user.role)||!can(user,"pos")))throw new Error("You cannot access waiter orders.");
 const [business,products,deals,categories,tables,requests,waiters]=await Promise.all([
  Business.findById(user.businessId).lean(),
  isWaiter?Product.find({businessId:user.businessId,isActive:true,isAvailable:true}).sort({sortOrder:1,name:1}).lean():[],
  isWaiter?Deal.find({businessId:user.businessId,isActive:true,isAvailable:true}).sort({sortOrder:1,name:1}).lean():[],
  Category.find({businessId:user.businessId,isActive:true}).lean(),
  RestaurantTable.find({businessId:user.businessId,isActive:true}).sort({sortOrder:1,name:1}).lean(),
  WaiterRequest.find({businessId:user.businessId,status:{$ne:"CANCELLED"},...(isWaiter?{userId:user.id}:{}),$or:[{status:"PENDING"},{updatedAt:{$gte:new Date(Date.now()-7*86400000)}}]}).sort({status:-1,createdAt:-1}).limit(250).lean(),
  isWaiter?[]:Staff.find({businessId:user.businessId,isActive:true,role:"WAITER"}).select("fullName").sort({fullName:1}).lean(),
 ]);
 const showSummary=!isWaiter||business?.waiterShowBillSummary===true;
 const orders=await Order.find({businessId:user.businessId,_id:{$in:requests.flatMap(r=>r.orderId?[r.orderId]:[])}}).select(`status orderNumber subtotal taxAmount grandTotal${showSummary?" items.unitPrice":""}`).lean();
 const orderMap=new Map(orders.map(o=>[String(o._id),o]));
 const categoryMap=new Map(categories.map(c=>[String(c._id),c.name]));
 return{
  isWaiter,showSummary,currency:business?.currency??"PKR",printerMode:(business?.printerMode==="QZ"?"QZ":"BROWSER") as "BROWSER"|"QZ",
  catalog:[...products.flatMap(p=>{const variants=p.variants?.length?p.variants:[{name:"",salePrice:p.salePrice}];return variants.map((v:{name:string;salePrice:number})=>({id:String(p._id),kind:"PRODUCT" as const,variantName:v.name||undefined,byWeight:p.sellBy==="WEIGHT",name:v.name?`${p.name} (${v.name})`:p.name,imageUrl:p.imageUrl as string|undefined,description:(p.description??"") as string,category:categoryMap.get(String(p.categoryId))??"Menu",...(showSummary?{price:v.salePrice}:{})}))}),...deals.map(d=>({id:String(d._id),kind:"DEAL" as const,variantName:undefined,byWeight:false,name:d.name,imageUrl:d.imageUrl as string|undefined,description:(d.description??"") as string,category:"Deals",...(showSummary?{price:d.salePrice}:{})}))],
  tables:tables.map(t=>({id:String(t._id),name:t.name})),
  waiters:waiters.map(w=>({id:String(w._id),name:String(w.fullName)})),
  // Cashiers only see orders awaiting approval and approved orders whose sale is still open.
  requests:requests.map(r=>waiterRequestView(r,orderMap.get(String(r.orderId)),showSummary)).filter(r=>isWaiter||r.status==="PENDING"||(!!r.orderId&&isOpenWaiterOrder(r.status))),
 };
}
export type WaiterWorkspace=Awaited<ReturnType<typeof waiterWorkspace>>;
