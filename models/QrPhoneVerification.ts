import { Schema,model,models } from "mongoose";
// One SMS code sent to a QR guest's number. Once the right code is typed it becomes that phone's pass
// (only its hash is stored) until purgeAt, so the guest is not asked again on every order.
const schema=new Schema({
 businessId:{type:Schema.Types.ObjectId,required:true},phone:{type:String,required:true},
 codeHash:{type:String,required:true},codeExpiresAt:{type:Date,required:true},attempts:{type:Number,default:0},
 verifiedAt:Date,passHash:String,purgeAt:{type:Date,required:true},
},{timestamps:true});
schema.index({businessId:1,phone:1,createdAt:-1});
schema.index({passHash:1},{partialFilterExpression:{passHash:{$type:"string"}}});
schema.index({purgeAt:1},{expireAfterSeconds:0});
export const QrPhoneVerification=models.QrPhoneVerification??model("QrPhoneVerification",schema);
