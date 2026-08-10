import { Schema, model, models, type InferSchemaType } from "mongoose";
const businessSchema = new Schema({
  name: { type: String, required: true, trim: true }, legalName: { type: String, trim: true },
  phone: { type: String, trim: true }, email: { type: String, trim: true, lowercase: true },
  address: { type: String, trim: true }, city: { type: String, trim: true },
  country: { type: String, trim: true, default: "Pakistan" }, currency: { type: String, required: true, default: "PKR" },
  timezone: { type: String, required: true, default: "Asia/Karachi" }, taxNumber: { type: String, trim: true },
  logoUrl: String, isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true });
export type BusinessDocument = InferSchemaType<typeof businessSchema>;
export const Business = models.Business ?? model("Business", businessSchema);
