import { Schema,model,models } from "mongoose";

// ACTIVE -> APPLIED (held by an unpaid order; released if removed or cancelled) -> REDEEMED (final).
// Coupons are never deleted, so a 10-digit code can never be issued or used twice.
const schema=new Schema({
 businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true},
 batchId:{type:Schema.Types.ObjectId,ref:"CouponBatch",required:true},
 code:{type:String,required:true},
 status:{type:String,enum:["ACTIVE","APPLIED","REDEEMED","VOID"],default:"ACTIVE"},
 customerId:{type:Schema.Types.ObjectId,ref:"Customer"},customerNameSnapshot:String,customerPhoneSnapshot:String,
 assignmentSource:{type:String,enum:["MANUAL","AUTO"]},assignedAt:Date,assignedByUserId:Schema.Types.ObjectId,
 issuedSaleDate:String,issuedOrderId:Schema.Types.ObjectId,issuedOrderNumber:String,
 orderId:Schema.Types.ObjectId,orderNumber:String,appliedAt:Date,redeemedAt:Date,discountAmount:Number,
 voidedAt:Date,voidReason:String,
},{timestamps:true});
schema.index({code:1},{unique:true});
schema.index({businessId:1,batchId:1,status:1,customerId:1});
schema.index({businessId:1,customerId:1,status:1});
schema.index({businessId:1,orderId:1});
export const Coupon=models.Coupon??model("Coupon",schema);
