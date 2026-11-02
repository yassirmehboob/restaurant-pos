import "server-only";
import { User } from "@/models/User";

type CashierSource={cashierNameSnapshot?:string|null;createdByUserId?:unknown;lastUpdatedByUserId?:unknown};

// The cashier who placed the order. Orders saved before the snapshot existed look the name up: a waiter
// order's creator is the waiter, so it falls back to the counter user who last handled it.
export async function orderCashierName(order:CashierSource){
  if(order.cashierNameSnapshot)return order.cashierNameSnapshot;
  const ids=[order.createdByUserId,order.lastUpdatedByUserId].filter(Boolean);
  if(!ids.length)return undefined;
  const users=await User.find({_id:{$in:ids}}).select("fullName role").lean(),find=(id:unknown)=>users.find(user=>String(user._id)===String(id));
  const creator=find(order.createdByUserId);
  return creator&&creator.role!=="WAITER"?creator.fullName:find(order.lastUpdatedByUserId)?.fullName;
}
