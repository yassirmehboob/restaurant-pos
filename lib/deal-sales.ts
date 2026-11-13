import mongoose from "mongoose";
import { SALES_WINDOW_DAYS } from "@/lib/deal-suggestions";
import { Order } from "@/models/Order";

// Units sold per product over the recent window of paid orders, counting items sold inside deals too.
export async function productUnitsSold(businessId:string,now=new Date()){
  const since=new Date(now.getTime()-SALES_WINDOW_DAYS*24*60*60*1000);
  const rows=await Order.aggregate<{_id:unknown;sold:number}>([
    {$match:{businessId:new mongoose.Types.ObjectId(businessId),paymentStatus:"PAID",status:{$ne:"CANCELLED"},createdAt:{$gte:since,$lte:now}}},
    {$unwind:"$items"},
    {$project:{entries:{$concatArrays:[
      [{productId:"$items.productId",quantity:"$items.quantity"}],
      {$map:{input:{$ifNull:["$items.dealItemsSnapshot",[]]},as:"part",in:{productId:"$$part.productId",quantity:{$multiply:["$$part.quantity","$items.quantity"]}}}},
    ]}}},
    {$unwind:"$entries"},
    {$match:{"entries.productId":{$ne:null}}},
    {$group:{_id:"$entries.productId",sold:{$sum:"$entries.quantity"}}},
  ]);
  return new Map(rows.map(row=>[String(row._id),row.sold]));
}
