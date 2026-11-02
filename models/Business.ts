import { Schema, model, models, deleteModel, type InferSchemaType } from "mongoose";
const deliveryMessageSchema=new Schema({enabled:{type:Boolean,default:false},includeOptOut:{type:Boolean,default:true},template:String},{_id:false});
const businessSchema = new Schema({
  name: { type: String, required: true, trim: true }, legalName: { type: String, trim: true },
  phone: { type: String, trim: true }, email: { type: String, trim: true, lowercase: true },
  address: { type: String, trim: true }, city: { type: String, trim: true },
  country: { type: String, trim: true, default: "Pakistan" }, currency: { type: String, required: true, default: "PKR" },
  timezone: { type: String, required: true, default: "Asia/Karachi" }, taxNumber: { type: String, trim: true },
  logoUrl: String, receiptPaperWidth: { type: String, enum:["58","80"], default:"80" },
  showOrderReadyTime:{type:Boolean,default:false}, receiptHeader: String, receiptFooter: { type:String, default:"Thank you!" }, showLogoOnCustomerReceipt:{type:Boolean,default:true}, showPricesOnKitchenReceipt:{type:Boolean,default:false},
  printerMode:{type:String,enum:["BROWSER","QZ"],default:"BROWSER"}, onePrinterMode:{type:Boolean,default:true}, customerPrinterName:String, kitchenPrinterName:String,
  customerPrinterConnection:{type:String,enum:["USB","LAN"],default:"USB"}, customerPrinterHost:String, customerPrinterPort:{type:Number,default:9100,min:1,max:65535},
  kitchenPrinterConnection:{type:String,enum:["USB","LAN"],default:"USB"}, kitchenPrinterHost:String, kitchenPrinterPort:{type:Number,default:9100,min:1,max:65535},
  customerPrintingEnabled:{type:Boolean,default:true}, kitchenPrintingEnabled:{type:Boolean,default:true}, customerReceiptCopies:{type:Number,default:1,min:1,max:5}, kitchenReceiptCopies:{type:Number,default:1,min:1,max:5},
  autoPrintCustomerOnPayment:{type:Boolean,default:false},
  waiterShowBillSummary:{type:Boolean,default:false},
  paymentPrefillDueAmount:{type:Boolean,default:true},
  smsEnabled:{type:Boolean,default:false},smsPaymentReceiptEnabled:{type:Boolean,default:false},smsIncludeOptOut:{type:Boolean,default:true},smsTokenEncrypted:{type:String,select:false},smsPaymentTemplate:String,smsEvidenceReference:{type:String,default:"customer-acknowledgement"},
  smsDeliveryMessages:{placed:{type:deliveryMessageSchema,default:()=>({})},outForDelivery:{type:deliveryMessageSchema,default:()=>({})},delivered:{type:deliveryMessageSchema,default:()=>({})}},
  kitchenTimingUpdatedBy:{type:Schema.Types.ObjectId,ref:"User"},
  kitchenTimingEnabled:{type:Boolean,default:false}, kitchenPreparingDelaySeconds:{type:Number,default:60,min:1,max:3600}, kitchenReadyDelayMinutes:{type:Number,default:25,min:1,max:1440},
  saleTaxRate:{type:Number,min:0,max:100},paymentTaxRates:{CASH:{type:Number,min:0,max:100},CARD:{type:Number,min:0,max:100},BANK:{type:Number,min:0,max:100},OTHER:{type:Number,min:0,max:100}},
  // Invoice discounts the cashier can give at payment; numbers in discountSmsNumbers get an SMS for each one.
  invoiceDiscountEnabled:{type:Boolean,default:false},
  discountTypes:{type:[new Schema({name:{type:String,required:true,trim:true},mode:{type:String,enum:["OPEN","FIXED"],default:"OPEN"},percent:{type:Number,min:0,max:100,default:null},capAmount:{type:Number,min:0,default:null},remarksRequired:{type:Boolean,default:false}})],default:[]},
  discountSmsNumbers:{type:[String],default:[]},
  // Shows the coupon code box when receiving payment; off hides it and the server refuses codes.
  couponOnPayment:{type:Boolean,default:true},
  isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true });
export type BusinessDocument = InferSchemaType<typeof businessSchema>;
if(models.Business&&(!models.Business.schema.path("smsDeliveryMessages.placed")||!models.Business.schema.path("smsIncludeOptOut")||!models.Business.schema.path("smsTokenEncrypted")||!models.Business.schema.path("waiterShowBillSummary")||!models.Business.schema.path("saleTaxRate")||!models.Business.schema.path("showOrderReadyTime")||!models.Business.schema.path("paymentPrefillDueAmount")||!models.Business.schema.path("kitchenPrinterConnection")||!models.Business.schema.path("discountTypes")||!models.Business.schema.path("couponOnPayment")))deleteModel("Business");
export const Business = models.Business ?? model("Business", businessSchema);
