import { Schema,model,models } from "mongoose";
const schema=new Schema({businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},name:{type:String,required:true,trim:true},number:Number,area:String,capacity:{type:Number,min:1},sortOrder:{type:Number,default:0},isActive:{type:Boolean,default:true}},{timestamps:true});
schema.index({businessId:1,name:1},{unique:true});schema.index({businessId:1,isActive:1,sortOrder:1});
export const RestaurantTable=models.RestaurantTable??model("RestaurantTable",schema);
