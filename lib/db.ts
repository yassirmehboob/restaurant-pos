import "server-only";
import mongoose from "mongoose";
import { env } from "@/lib/env";
declare global { var mongooseConnection: Promise<typeof mongoose> | undefined; }
export function connectToDatabase() {
  global.mongooseConnection ??= mongoose.connect(env().MONGODB_URI, { bufferCommands: false });
  return global.mongooseConnection;
}
