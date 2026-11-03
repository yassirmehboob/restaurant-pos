import { Schema, model, models,deleteModel } from "mongoose";

const schema = new Schema({
  businessId: { type: Schema.Types.ObjectId, required: true },
  // QR requests come from a guest's phone, so they have no waiter account.
  userId: { type: Schema.Types.ObjectId, required: function(this:{source?:string}){return this.source!=="QR"} },
  waiterName: { type: String, required: true },
  source: { type: String, enum: ["WAITER", "QR"], default: "WAITER" },
  status: { type: String, enum: ["PENDING", "CONFIRMED", "CANCELLED"], default: "PENDING" },
  revision: { type: Number, default: 0 },
  submissionKey: String,
  input: { type: Schema.Types.Mixed, required: true },
  displayLines: { type: Schema.Types.Mixed, required: true },
  tableId: Schema.Types.ObjectId,
  tableName: String,
  guest: { name: String, phone: String, language: String, verified: Boolean },
  summary: { subtotal: Number, taxAmount: Number, grandTotal: Number },
  orderId: Schema.Types.ObjectId,
  confirmedByUserId: Schema.Types.ObjectId,
  cancelledByUserId: Schema.Types.ObjectId,
  cancelledAt: Date,
  cancellationReason: String,
}, { timestamps: true });
schema.index({ businessId: 1, userId: 1, createdAt: -1 });
schema.index({ businessId: 1, status: 1, createdAt: 1 });
schema.index({ businessId: 1, source: 1, tableId: 1, status: 1 });
schema.index({businessId:1,userId:1,submissionKey:1},{unique:true,partialFilterExpression:{submissionKey:{$type:"string"}}});
if(models.WaiterRequest&&(!models.WaiterRequest.schema.path("submissionKey")||!models.WaiterRequest.schema.path("source")||!models.WaiterRequest.schema.path("guest.verified")))deleteModel("WaiterRequest");
export const WaiterRequest = models.WaiterRequest ?? model("WaiterRequest", schema);
