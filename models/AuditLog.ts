import { Schema, model, models } from "mongoose";
const auditLogSchema = new Schema({
  businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true }, userNameSnapshot: String,
  action: { type: String, required: true }, entityType: { type: String, required: true }, entityId: Schema.Types.ObjectId,
  description: { type: String, required: true }, metadata: Schema.Types.Mixed, ipAddress: String, userAgent: String,
}, { timestamps: { createdAt: true, updatedAt: false } });
auditLogSchema.index({ businessId: 1, createdAt: -1 });
auditLogSchema.index({ businessId: 1, entityType: 1, entityId: 1 });
export const AuditLog = models.AuditLog ?? model("AuditLog", auditLogSchema);
