import { Schema,model,models } from "mongoose";
const schema=new Schema({businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},userId:{type:Schema.Types.ObjectId,ref:"User"},fullName:{type:String,required:true,trim:true},role:{type:String,enum:["WAITER","CASHIER","KITCHEN","OTHER"],required:true},phone:String,code:String,isActive:{type:Boolean,default:true}},{timestamps:true});
schema.index({businessId:1,isActive:1,role:1});schema.index({businessId:1,code:1},{unique:true,sparse:true});
export const Staff=models.Staff??model("Staff",schema);
