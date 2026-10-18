import { Schema,deleteModel,model,models } from "mongoose";

const schema=new Schema({
  saleSessionId:{type:Schema.Types.ObjectId,ref:"SaleSession"},saleDate:String,counterNameSnapshot:String,businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},
  categoryId:{type:Schema.Types.ObjectId,ref:"ExpenseCategory",required:true,index:true},
  categoryNameSnapshot:{type:String,required:true},
  title:{type:String,required:true,trim:true},
  amount:{type:Number,required:true,min:0.01},
  expenseDate:{type:Date,required:true,index:true},
  paymentMethod:{type:String,enum:["CASH","CARD","BANK","OTHER"],default:"CASH"},
  reference:{type:String,trim:true},
  notes:{type:String,trim:true},
  isActive:{type:Boolean,default:true},
  createdByUserId:{type:Schema.Types.ObjectId,ref:"User",required:true},
  createdByNameSnapshot:String,
  updatedByUserId:{type:Schema.Types.ObjectId,ref:"User"},
},{timestamps:true});

schema.index({businessId:1,saleSessionId:1});
schema.index({businessId:1,saleDate:1});
schema.index({businessId:1,isActive:1,expenseDate:-1});
schema.index({businessId:1,categoryId:1,expenseDate:-1});
if(models.Expense&&!models.Expense.schema.path("saleSessionId"))deleteModel("Expense");
export const Expense=models.Expense??model("Expense",schema);
