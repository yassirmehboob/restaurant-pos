import { Schema,deleteModel,model,models } from "mongoose";
const dealItemSchema=new Schema({productId:Schema.Types.ObjectId,name:String,quantity:Number,unitCost:Number},{_id:false});
const lineSchema=new Schema({lineId:{type:String,required:true},itemType:{type:String,enum:["PRODUCT","DEAL"],required:true},productId:Schema.Types.ObjectId,dealId:Schema.Types.ObjectId,nameSnapshot:{type:String,required:true},variantNameSnapshot:String,imageUrlSnapshot:String,itemTaxRateSnapshot:Number,preparationTimeMinutesSnapshot:{type:Number,min:1,max:1440},quantity:{type:Number,required:true,min:1},weightGrams:{type:Number,min:1},pricePerKgSnapshot:Number,unitPrice:{type:Number,required:true},unitCost:{type:Number,required:true},taxRate:{type:Number,default:0},isTaxInclusive:{type:Boolean,default:false},discountAmount:{type:Number,default:0},lineSubtotal:{type:Number,required:true},lineTax:{type:Number,required:true},lineTotal:{type:Number,required:true},notes:String,dealItemsSnapshot:[dealItemSchema]},{_id:false});
const schema=new Schema({paymentTaxRatesSnapshot:{CASH:Number,CARD:Number,BANK:Number,OTHER:Number},taxPaymentMethod:{type:String,enum:["CASH","CARD","BANK","OTHER"]},taxRateSnapshot:Number,collectedInSessionId:{type:Schema.Types.ObjectId,ref:"SaleSession"},saleSessionId:{type:Schema.Types.ObjectId,ref:"SaleSession"},saleDate:String,counterNameSnapshot:String,businessId:{type:Schema.Types.ObjectId,ref:"Business",required:true,index:true},orderNumber:{type:String,required:true},orderType:{type:String,enum:["DINE_IN","TAKEAWAY","DELIVERY"],required:true},status:{type:String,enum:["DRAFT","CONFIRMED","SENT_TO_KITCHEN","PREPARING","READY","SERVED","COMPLETED","CANCELLED"],default:"DRAFT"},tableId:Schema.Types.ObjectId,tableNameSnapshot:String,waiterId:Schema.Types.ObjectId,waiterNameSnapshot:String,customerId:Schema.Types.ObjectId,customerSnapshot:{name:String,phone:String,address:String,area:String},items:{type:[lineSchema],required:true},subtotal:{type:Number,required:true},discountType:{type:String,enum:["NONE","FIXED","PERCENT"],default:"NONE"},discountValue:{type:Number,default:0},discountAmount:{type:Number,default:0},taxAmount:{type:Number,required:true},serviceChargeAmount:{type:Number,default:0},deliveryChargeAmount:{type:Number,default:0},grandTotal:{type:Number,required:true},paidAmount:{type:Number,default:0},dueAmount:{type:Number,required:true},paymentStatus:{type:String,enum:["UNPAID","PARTIAL","PAID"],default:"UNPAID"},notes:String,createdByUserId:{type:Schema.Types.ObjectId,ref:"User",required:true},lastUpdatedByUserId:Schema.Types.ObjectId,cancelledByUserId:Schema.Types.ObjectId,openedAt:{type:Date,default:Date.now},kitchenStatusSource:{type:String,enum:["MANUAL","AUTOMATIC"]},kitchenSentAt:Date,preparingAt:Date,readyAt:Date,completedAt:Date,cancelledAt:Date,cancellationReason:String},{timestamps:true});
schema.index({businessId:1,saleSessionId:1});
const couponSnapshotSchema=new Schema({batchId:Schema.Types.ObjectId,batchName:String,discountType:String,discountValue:Number,maxDiscount:Number,minOrderAmount:Number},{_id:false});
const issuedCouponSchema=new Schema({couponId:Schema.Types.ObjectId,code:String,batchName:String,description:String,expiresOn:String,usage:String},{_id:false});
schema.add({couponId:Schema.Types.ObjectId,couponCode:String,couponSnapshot:couponSnapshotSchema,issuedCoupons:{type:[issuedCouponSchema],default:undefined}});
schema.add({deliveryStatus:{type:String,enum:["PLACED","OUT_FOR_DELIVERY","DELIVERED"]},deliveryPlacedAt:Date,outForDeliveryAt:Date,deliveredAt:Date});
schema.add({cashierNameSnapshot:String});
// The invoice discount given at payment; discountAmount holds it plus any coupon discount.
schema.add({invoiceDiscount:new Schema({typeId:String,name:String,mode:String,percent:Number,capAmount:Number,amount:Number,amountBefore:Number,remarks:String,appliedByUserId:Schema.Types.ObjectId,appliedByName:String},{_id:false})});
// Where the order came from: the counter, a waiter tablet, or a guest scanning the table QR code.
schema.add({orderSource:{type:String,enum:["POS","WAITER","QR"]}});
schema.index({businessId:1,saleDate:1});
schema.index({businessId:1,status:1,kitchenSentAt:1});
schema.index({businessId:1,status:1,preparingAt:1});
schema.index({businessId:1,orderNumber:1},{unique:true});schema.index({businessId:1,createdAt:-1});schema.index({businessId:1,status:1,updatedAt:-1});
const cached=models.Order;
if(cached){const itemsPath=cached.schema.path("items") as {schema?:Schema};if(itemsPath.schema&&(!itemsPath.schema.path("variantNameSnapshot")||!itemsPath.schema.path("itemTaxRateSnapshot")||!itemsPath.schema.path("preparationTimeMinutesSnapshot")||!itemsPath.schema.path("weightGrams")))deleteModel("Order")}
if(models.Order&&!models.Order.schema.path("saleSessionId"))deleteModel("Order");
if(models.Order&&!models.Order.schema.path("taxRateSnapshot"))deleteModel("Order");
if(models.Order&&!models.Order.schema.path("deliveryStatus"))deleteModel("Order");
if(models.Order&&!models.Order.schema.path("couponCode"))deleteModel("Order");
if(models.Order&&!models.Order.schema.path("cashierNameSnapshot"))deleteModel("Order");
if(models.Order&&!models.Order.schema.path("invoiceDiscount"))deleteModel("Order");
if(models.Order&&!models.Order.schema.path("orderSource"))deleteModel("Order");
export const Order=models.Order??model("Order",schema);
