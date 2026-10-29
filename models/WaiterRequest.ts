import { Schema, model, models,deleteModel } from "mongoose";

const schema = new Schema({
  businessId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  waiterName: { type: String, required: true },
  status: { type: String, enum: ["PENDING", "CONFIRMED"], default: "PENDING" },
  revision: { type: Number, default: 0 },
  submissionKey: String,
  input: { type: Schema.Types.Mixed, required: true },
  displayLines: { type: Schema.Types.Mixed, required: true },
  tableName: String,
  summary: { subtotal: Number, taxAmount: Number, grandTotal: Number },
  orderId: Schema.Types.ObjectId,
  confirmedByUserId: Schema.Types.ObjectId,
}, { timestamps: true });
schema.index({ businessId: 1, userId: 1, createdAt: -1 });
schema.index({ businessId: 1, status: 1, createdAt: 1 });
schema.index({businessId:1,userId:1,submissionKey:1},{unique:true,partialFilterExpression:{submissionKey:{$type:"string"}}});
if(models.WaiterRequest&&!models.WaiterRequest.schema.path("submissionKey"))deleteModel("WaiterRequest");
export const WaiterRequest = models.WaiterRequest ?? model("WaiterRequest", schema);
