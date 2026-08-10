import { Schema,model,models } from "mongoose";
const schema=new Schema({businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,unique:true},sequence:{type:Number,required:true,default:0}},{timestamps:true});
export const OrderCounter=models.OrderCounter??model("OrderCounter",schema);
