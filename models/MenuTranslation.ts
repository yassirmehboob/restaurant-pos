import { Schema,deleteModel,model,models } from "mongoose";

// Sindhi and Urdu names for the kitchen ticket, keyed by the exact English menu name (an item, an item size such as
// "Pizza (Small)", or a deal). NLLB only suggests: kitchen tickets print a translation once the owner approves it,
// as written or corrected, because a machine translation of a dish name can be badly wrong.
const STATUSES=["SUGGESTED","APPROVED"];
const schema=new Schema({
 businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true},
 text:{type:String,required:true,trim:true,maxlength:200},
 sd:{type:String,trim:true,maxlength:300},sdStatus:{type:String,enum:STATUSES},
 ur:{type:String,trim:true,maxlength:300},urStatus:{type:String,enum:STATUSES},
},{timestamps:true});
schema.index({businessId:1,text:1},{unique:true});
if(models.MenuTranslation&&!models.MenuTranslation.schema.path("sdStatus"))deleteModel("MenuTranslation");
export const MenuTranslation=models.MenuTranslation??model("MenuTranslation",schema);
