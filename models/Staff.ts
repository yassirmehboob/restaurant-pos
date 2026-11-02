import { Schema,model,models } from "mongoose";
import { STAFF_ROLES } from "@/lib/roles";
const schema=new Schema({businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},userId:{type:Schema.Types.ObjectId,ref:"User"},fullName:{type:String,required:true,trim:true},role:{type:String,enum:STAFF_ROLES,required:true},phone:String,cnic:String,address:String,remarks:String,photoPath:String,isActive:{type:Boolean,default:true}},{timestamps:true});
schema.index({businessId:1,isActive:1,role:1});
export const Staff=models.Staff??model("Staff",schema);
