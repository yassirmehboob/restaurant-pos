import { Schema, model, models, deleteModel, type InferSchemaType } from "mongoose";
import { USER_ROLES } from "@/lib/roles";
import { PRIVILEGE_KEYS } from "@/lib/permissions";
const userSchema = new Schema({
  businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
  fullName: { type: String, required: true, trim: true }, email: { type: String, trim: true, lowercase: true },
  username: { type: String, required: true, trim: true, lowercase: true }, passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: USER_ROLES, required: true }, pinHash: { type: String, select: false },
  authVersion: { type: Number, default: 0 },
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, select: false },
  twoFactorPendingSecret: { type: String, select: false },
  twoFactorPendingExpiresAt: { type: Date, select: false },
  twoFactorLastStep: { type: Number, select: false },
  twoFactorRecoveryHashes: { type: [String], select: false, default: undefined },
  phone: { type: String, trim: true },
  privileges: { type: [String], enum: PRIVILEGE_KEYS, default: undefined },
  isActive: { type: Boolean, required: true, default: true }, lastLoginAt: Date,
}, { timestamps: true });
userSchema.index({ businessId: 1, isActive: 1, role: 1 });
userSchema.index({ username: 1 }, { unique: true });
export type UserDocument = InferSchemaType<typeof userSchema>;
// Refresh the development model when newly added privileges change its enum.
const cachedPrivileges=models.User?.schema.path("privileges")?.options.enum;
if(models.User&&(!Array.isArray(cachedPrivileges)||!PRIVILEGE_KEYS.every(key=>cachedPrivileges.includes(key))))deleteModel("User");
if(models.User&&!models.User.schema.path("twoFactorEnabled"))deleteModel("User");
export const User = models.User ?? model("User", userSchema);
