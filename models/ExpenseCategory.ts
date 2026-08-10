import { Schema,model,models } from "mongoose";

const schema=new Schema({
  businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},
  name:{type:String,required:true,trim:true},
  description:{type:String,trim:true},
  isActive:{type:Boolean,default:true},
},{timestamps:true});

schema.index({businessId:1,name:1},{unique:true,collation:{locale:"en",strength:2}});
schema.index({businessId:1,isActive:1,name:1});
export const ExpenseCategory=models.ExpenseCategory??model("ExpenseCategory",schema);
