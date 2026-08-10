import { Schema,model,models } from "mongoose";
const schema=new Schema({businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},name:{type:String,required:true,trim:true},phone:String,alternatePhone:String,email:{type:String,lowercase:true,trim:true},address:String,area:String,notes:String,totalOrders:{type:Number,default:0},totalSpent:{type:Number,default:0},lastOrderAt:Date,isActive:{type:Boolean,default:true}},{timestamps:true});
schema.index({businessId:1,phone:1});schema.index({businessId:1,name:1});schema.index({businessId:1,isActive:1});
export const Customer=models.Customer??model("Customer",schema);
