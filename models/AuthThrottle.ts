import { Schema, model, models } from "mongoose";
const schema = new Schema({ _id: String, count: { type: Number, default: 0 }, expiresAt: Date });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AuthThrottle = models.AuthThrottle ?? model("AuthThrottle", schema);
