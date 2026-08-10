import { Schema, model, models, type InferSchemaType } from "mongoose";
import { USER_ROLES } from "@/lib/roles";
const userSchema = new Schema({
  businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
  fullName: { type: String, required: true, trim: true }, email: { type: String, trim: true, lowercase: true },
  username: { type: String, required: true, trim: true, lowercase: true }, passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: USER_ROLES, required: true }, pinHash: { type: String, select: false },
  isActive: { type: Boolean, required: true, default: true }, lastLoginAt: Date,
}, { timestamps: true });
userSchema.index({ businessId: 1, isActive: 1, role: 1 });
userSchema.index({ username: 1 }, { unique: true });
export type UserDocument = InferSchemaType<typeof userSchema>;
export const User = models.User ?? model("User", userSchema);
