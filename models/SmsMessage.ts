import { Schema,model,models,deleteModel } from "mongoose";
const schema=new Schema({
 _id:{type:String,required:true},businessId:{type:Schema.Types.ObjectId,required:true,index:true},orderId:{type:Schema.Types.ObjectId,required:true},orderNumber:String,
 messageType:{type:String,enum:["PAYMENT_RECEIPT","DELIVERY_PLACED","DELIVERY_OUT_FOR_DELIVERY","DELIVERY_DELIVERED"],default:"PAYMENT_RECEIPT"},
 to:{type:String,default:""},body:{type:String,default:""},includeOptOut:{type:Boolean,default:true},evidenceReference:String,
 status:{type:String,enum:["PENDING","SENDING","ACCEPTED","FAILED","UNKNOWN","SKIPPED"],default:"PENDING"},
 failureCode:String,httpStatus:Number,apiStatus:String,apiStatusReadNote:String,startedAt:Date,finishedAt:Date,
},{timestamps:true});
schema.index({businessId:1,orderId:1,messageType:1},{unique:true});schema.index({status:1,createdAt:1});schema.index({businessId:1,createdAt:-1});
if(models.SmsMessage&&(!models.SmsMessage.schema.path("apiStatus")||!models.SmsMessage.schema.path("messageType")))deleteModel("SmsMessage");
export const SmsMessage=models.SmsMessage??model("SmsMessage",schema);
