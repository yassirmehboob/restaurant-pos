import { Schema,deleteModel,model,models } from "mongoose";
const itemSchema=new Schema({productId:{type:Schema.Types.ObjectId,ref:"Product",required:true},quantity:{type:Number,required:true,min:1},weightGrams:{type:Number,min:125,max:50000},variantName:{type:String,trim:true,maxlength:40}},{_id:false});
const schema=new Schema({businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},name:{type:String,required:true,trim:true},description:String,imageUrl:String,salePrice:{type:Number,required:true,min:0},items:{type:[itemSchema],validate:{validator:(v:unknown[])=>v.length>0,message:"Add at least one product"}},isAvailable:{type:Boolean,default:true},isActive:{type:Boolean,default:true},sortOrder:{type:Number,default:0}},{timestamps:true});
schema.index({businessId:1,name:1});schema.index({businessId:1,isActive:1,sortOrder:1});
const cached=models.Deal;
if(cached&&(!cached.schema.path("items.weightGrams")||!cached.schema.path("items.variantName")))deleteModel("Deal");
export const Deal=models.Deal??model("Deal",schema);
