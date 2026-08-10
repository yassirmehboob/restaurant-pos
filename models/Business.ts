import { Schema, model, models, type InferSchemaType } from "mongoose";
const businessSchema = new Schema({
  name: { type: String, required: true, trim: true }, legalName: { type: String, trim: true },
  phone: { type: String, trim: true }, email: { type: String, trim: true, lowercase: true },
  address: { type: String, trim: true }, city: { type: String, trim: true },
  country: { type: String, trim: true, default: "Pakistan" }, currency: { type: String, required: true, default: "PKR" },
  timezone: { type: String, required: true, default: "Asia/Karachi" }, taxNumber: { type: String, trim: true },
  logoUrl: String, receiptPaperWidth: { type: String, enum:["58","80"], default:"80" },
  receiptHeader: String, receiptFooter: { type:String, default:"Thank you!" }, showLogoOnCustomerReceipt:{type:Boolean,default:true}, showPricesOnKitchenReceipt:{type:Boolean,default:false},
  printerMode:{type:String,enum:["BROWSER","QZ"],default:"BROWSER"}, onePrinterMode:{type:Boolean,default:true}, customerPrinterName:String, kitchenPrinterName:String,
  customerPrintingEnabled:{type:Boolean,default:true}, kitchenPrintingEnabled:{type:Boolean,default:true}, customerReceiptCopies:{type:Number,default:1,min:1,max:5}, kitchenReceiptCopies:{type:Number,default:1,min:1,max:5},
  isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true });
export type BusinessDocument = InferSchemaType<typeof businessSchema>;
export const Business = models.Business ?? model("Business", businessSchema);
