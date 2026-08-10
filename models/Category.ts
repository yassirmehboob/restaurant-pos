import { Schema,model,models } from "mongoose";
const schema=new Schema({businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},name:{type:String,required:true,trim:true},sortOrder:{type:Number,default:0},imageUrl:String,isActive:{type:Boolean,default:true}},{timestamps:true});
schema.index({businessId:1,name:1},{unique:true});schema.index({businessId:1,isActive:1,sortOrder:1});
export const Category=models.Category??model("Category",schema);
