import { Schema,deleteModel,model,models } from "mongoose";
// qrToken is the secret in the table's QR code; it alone picks the business and table, and replacing it retires old prints.
const schema=new Schema({businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},name:{type:String,required:true,trim:true},number:Number,area:String,capacity:{type:Number,min:1},sortOrder:{type:Number,default:0},isActive:{type:Boolean,default:true},qrToken:String},{timestamps:true});
schema.index({businessId:1,name:1},{unique:true});schema.index({businessId:1,isActive:1,sortOrder:1});
schema.index({qrToken:1},{unique:true,partialFilterExpression:{qrToken:{$type:"string"}}});
if(models.RestaurantTable&&!models.RestaurantTable.schema.path("qrToken"))deleteModel("RestaurantTable");
export const RestaurantTable=models.RestaurantTable??model("RestaurantTable",schema);
