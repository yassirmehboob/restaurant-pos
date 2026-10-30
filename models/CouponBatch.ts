import { Schema,model,models } from "mongoose";

// A named offer (e.g. "Azadi Offer") whose rules are shared by every coupon generated for it.
const schema=new Schema({
 businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},
 name:{type:String,required:true,trim:true},
 discountType:{type:String,enum:["PERCENT","FIXED"],required:true},
 discountValue:{type:Number,required:true,min:0.01},
 maxDiscount:{type:Number,min:0.01},
 minOrderAmount:{type:Number,default:0,min:0},
 usage:{type:String,enum:["INSTANT","NEXT_VISIT"],required:true},
 validFrom:String,expiresOn:String,
 autoIssueEnabled:{type:Boolean,default:false},autoIssueMinSpend:{type:Number,default:0,min:0},
 quantity:{type:Number,required:true,min:1},
 isActive:{type:Boolean,default:true},
 createdByUserId:{type:Schema.Types.ObjectId,ref:"User",required:true},createdByName:String,
},{timestamps:true});
schema.index({businessId:1,createdAt:-1});
schema.index({businessId:1,isActive:1,autoIssueEnabled:1});
export const CouponBatch=models.CouponBatch??model("CouponBatch",schema);
