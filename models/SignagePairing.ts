import { Schema,model,models } from "mongoose";

// Short-lived: a TV shows the 6-digit code, the owner enters it, and the TV collects its access key once.
const schema=new Schema({
 code:{type:String,required:true},secretHash:{type:String,required:true},
 status:{type:String,enum:["PENDING","APPROVED"],default:"PENDING"},
 businessId:{type:Schema.Types.ObjectId,ref:"Business"},screenId:{type:Schema.Types.ObjectId,ref:"SignageScreen"},token:String,
 expiresAt:{type:Date,required:true},
},{timestamps:true});
schema.index({expiresAt:1},{expireAfterSeconds:0});
schema.index({code:1},{unique:true,partialFilterExpression:{status:"PENDING"}});
export const SignagePairing=models.SignagePairing??model("SignagePairing",schema);
