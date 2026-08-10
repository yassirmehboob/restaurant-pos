import { Schema,model,models } from "mongoose";
const schema=new Schema({businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},categoryId:{type:Schema.Types.ObjectId,ref:"Category",required:true},name:{type:String,required:true,trim:true},description:String,imageUrl:String,salePrice:{type:Number,required:true,min:0},costPrice:{type:Number,required:true,min:0},taxRate:{type:Number,default:0,min:0,max:100},isTaxInclusive:{type:Boolean,default:false},isAvailable:{type:Boolean,default:true},isActive:{type:Boolean,default:true},sortOrder:{type:Number,default:0}},{timestamps:true});
schema.index({businessId:1,name:1},{unique:true});schema.index({businessId:1,categoryId:1,isActive:1,sortOrder:1});
export const Product=models.Product??model("Product",schema);
