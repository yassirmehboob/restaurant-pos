import { Schema,model,models } from "mongoose";

const slideSchema=new Schema({
 id:{type:String,required:true},type:{type:String,enum:["BRAND","MENU","DEALS","ITEM","VIDEO"],required:true},durationSeconds:{type:Number,required:true},
 title:String,message:String,categoryId:String,productIds:{type:[String],default:[]},dealIds:{type:[String],default:[]},productId:String,videoId:String,sound:{type:Boolean,default:false},
},{_id:false});

// A display screen and its playlist. Only a hash of the paired device's access key is stored.
const schema=new Schema({
 businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},
 name:{type:String,required:true,trim:true},
 orientation:{type:String,enum:["LANDSCAPE","PORTRAIT"],default:"LANDSCAPE"},
 theme:{type:String,enum:["DARK","LIGHT","WARM"],default:"DARK"},
 showPrices:{type:Boolean,default:true},footerText:String,
 slides:{type:[slideSchema],default:[]},
 tokenHash:String,pairedAt:Date,lastSeenAt:Date,
},{timestamps:true});
schema.index({tokenHash:1},{unique:true,partialFilterExpression:{tokenHash:{$type:"string"}}});
export const SignageScreen=models.SignageScreen??model("SignageScreen",schema);
