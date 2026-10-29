import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { loadAppEnv } from "./load-env.mjs";
import { ensureBackupIndexes, runBackupTick } from "../lib/backup-worker.mjs";

loadAppEnv(process.env.NODE_ENV ?? "production");
let stopped = false, initialized = false;
const workerId = randomUUID();
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });
console.log("Backup worker started (15-second queue and schedule checks).");
while (!stopped) {
  try {
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    if (!initialized) { await ensureBackupIndexes(mongoose.connection.db); initialized = true; }
    await runBackupTick(mongoose.connection.getClient(), mongoose.connection.db, workerId);
  } catch { console.error("Backup service check failed; will retry. Check database connectivity and backup configuration."); }
  if (!stopped) await pause(15000);
}
await mongoose.disconnect();
