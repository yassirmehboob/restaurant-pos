import { Schema,model,models,deleteModel } from "mongoose";
const schema=new Schema({
 _id:{type:String,required:true},businessId:{type:Schema.Types.ObjectId,required:true,index:true},orderId:{type:Schema.Types.ObjectId,required:true},orderNumber:String,
 // One DISCOUNT_ALERT_n per owner number keeps the (business, order, type) uniqueness without an index change.
 // QR_VERIFICATION rows point orderId at the QrPhoneVerification they carry the code for, not at an order.
 messageType:{type:String,enum:["PAYMENT_RECEIPT","DELIVERY_PLACED","DELIVERY_OUT_FOR_DELIVERY","DELIVERY_DELIVERED","ORDER_PLACED","ORDER_PREPARING","ORDER_READY","ORDER_SERVED","ORDER_COMPLETED","DISCOUNT_ALERT_1","DISCOUNT_ALERT_2","DISCOUNT_ALERT_3","DISCOUNT_ALERT_4","DISCOUNT_ALERT_5","QR_VERIFICATION"],default:"PAYMENT_RECEIPT"},
 to:{type:String,default:""},body:{type:String,default:""},includeOptOut:{type:Boolean,default:true},evidenceReference:String,
 status:{type:String,enum:["PENDING","SENDING","ACCEPTED","FAILED","UNKNOWN","SKIPPED"],default:"PENDING"},
 failureCode:String,httpStatus:Number,apiStatus:String,apiStatusReadNote:String,startedAt:Date,finishedAt:Date,
},{timestamps:true});
schema.index({businessId:1,orderId:1,messageType:1},{unique:true});schema.index({status:1,createdAt:1});schema.index({businessId:1,createdAt:-1});
if(models.SmsMessage&&(!models.SmsMessage.schema.path("apiStatus")||!models.SmsMessage.schema.path("messageType")||!(models.SmsMessage.schema.path("messageType") as unknown as {enumValues:string[]}).enumValues.includes("QR_VERIFICATION")))deleteModel("SmsMessage");
export const SmsMessage=models.SmsMessage??model("SmsMessage",schema);
