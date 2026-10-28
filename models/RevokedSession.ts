import { Schema, model, models } from "mongoose";
const schema = new Schema({ _id: String, expiresAt: { type: Date, required: true } });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RevokedSession = models.RevokedSession ?? model("RevokedSession", schema);
