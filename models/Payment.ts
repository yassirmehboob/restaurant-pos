import { Schema,deleteModel,model,models } from "mongoose";
const schema=new Schema({saleSessionId:{type:Schema.Types.ObjectId,ref:"SaleSession"},saleDate:String,counterNameSnapshot:String,businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},orderId:{type:Schema.Types.ObjectId,ref:"Order",required:true,index:true},idempotencyKey:{type:String,required:true},amount:{type:Number,required:true,min:0.01},tenderedAmount:{type:Number,min:0},changeAmount:{type:Number,default:0,min:0},method:{type:String,enum:["CASH","CARD","BANK","OTHER"],required:true},reference:String,receivedByUserId:{type:Schema.Types.ObjectId,ref:"User",required:true},receivedByNameSnapshot:String,paidAt:{type:Date,default:Date.now},notes:String},{timestamps:{createdAt:true,updatedAt:false}});
// Set when the payment is reversed. The session is the drawer the money left, which may not be the one that took it.
schema.add({reversal:new Schema({reason:{type:String,required:true},reversedAt:{type:Date,required:true},reversedByUserId:{type:Schema.Types.ObjectId,ref:"User",required:true},reversedByNameSnapshot:String,saleSessionId:{type:Schema.Types.ObjectId,ref:"SaleSession"},saleDate:String,counterNameSnapshot:String},{_id:false})});
schema.index({businessId:1,"reversal.saleDate":1});
schema.index({businessId:1,"reversal.saleSessionId":1});
schema.index({businessId:1,saleSessionId:1});
schema.index({businessId:1,saleDate:1});
schema.index({businessId:1,idempotencyKey:1},{unique:true});schema.index({businessId:1,orderId:1,paidAt:-1});
if(models.Payment&&!models.Payment.schema.path("saleSessionId"))deleteModel("Payment");
if(models.Payment&&!models.Payment.schema.path("reversal"))deleteModel("Payment");
export const Payment=models.Payment??model("Payment",schema);
