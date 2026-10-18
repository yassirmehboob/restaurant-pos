import { Schema, model, models } from "mongoose";

const totalsSchema = new Schema({
  sales: Number, expenses: Number, cashSales: Number, cashExpenses: Number,
  balance: Number, expectedCash: Number, paymentCount: Number, expenseCount: Number,
}, { _id: false });

const schema = new Schema({
  businessId: { type: Schema.Types.ObjectId, required: true, ref: "Business" },
  userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
  userNameSnapshot: { type: String, required: true },
  counterName: { type: String, required: true },
  counterKey: { type: String, required: true },
  saleDate: { type: String, required: true },
  openingBalance: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN", required: true },
  revision: { type: Number, default: 0 },
  openedAt: { type: Date, default: Date.now },
  closedAt: Date,
  closedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  closedByNameSnapshot: String,
  closedByOwner: Boolean,
  closingTotals: totalsSchema,
}, { timestamps: true });

schema.index({ businessId: 1, userId: 1 }, { unique: true, partialFilterExpression: { status: "OPEN" } });
schema.index({ businessId: 1, counterKey: 1 }, { unique: true, partialFilterExpression: { status: "OPEN" } });
schema.index({ businessId: 1, saleDate: -1, openedAt: -1 });
export const SaleSession = models.SaleSession ?? model("SaleSession", schema);
