import { Schema, model, models, deleteModel, type InferSchemaType } from "mongoose";
const businessSchema = new Schema({
  name: { type: String, required: true, trim: true }, legalName: { type: String, trim: true },
  phone: { type: String, trim: true }, email: { type: String, trim: true, lowercase: true },
  address: { type: String, trim: true }, city: { type: String, trim: true },
  country: { type: String, trim: true, default: "Pakistan" }, currency: { type: String, required: true, default: "PKR" },
  timezone: { type: String, required: true, default: "Asia/Karachi" }, taxNumber: { type: String, trim: true },
  logoUrl: String, receiptPaperWidth: { type: String, enum:["58","80"], default:"80" },
  showOrderReadyTime:{type:Boolean,default:false}, receiptHeader: String, receiptFooter: { type:String, default:"Thank you!" }, showLogoOnCustomerReceipt:{type:Boolean,default:true}, showPricesOnKitchenReceipt:{type:Boolean,default:false},
  printerMode:{type:String,enum:["BROWSER","QZ"],default:"BROWSER"}, onePrinterMode:{type:Boolean,default:true}, customerPrinterName:String, kitchenPrinterName:String,
  customerPrintingEnabled:{type:Boolean,default:true}, kitchenPrintingEnabled:{type:Boolean,default:true}, customerReceiptCopies:{type:Number,default:1,min:1,max:5}, kitchenReceiptCopies:{type:Number,default:1,min:1,max:5},
  autoPrintCustomerOnPayment:{type:Boolean,default:false},
  kitchenTimingUpdatedBy:{type:Schema.Types.ObjectId,ref:"User"},
  kitchenTimingEnabled:{type:Boolean,default:false}, kitchenPreparingDelaySeconds:{type:Number,default:60,min:1,max:3600}, kitchenReadyDelayMinutes:{type:Number,default:25,min:1,max:1440},
  saleTaxRate:{type:Number,min:0,max:100},paymentTaxRates:{CASH:{type:Number,min:0,max:100},CARD:{type:Number,min:0,max:100},BANK:{type:Number,min:0,max:100},OTHER:{type:Number,min:0,max:100}},
  isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true });
export type BusinessDocument = InferSchemaType<typeof businessSchema>;
if(models.Business&&(!models.Business.schema.path("saleTaxRate")||!models.Business.schema.path("showOrderReadyTime")))deleteModel("Business");
export const Business = models.Business ?? model("Business", businessSchema);
