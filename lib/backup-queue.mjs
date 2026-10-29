import { randomUUID } from "node:crypto";

export async function ensureBackupIndexes(db) {
  await db.collection("backupjobs").createIndex({ activeKey: 1 }, { unique: true, partialFilterExpression: { activeKey: { $type: "string" } } });
  await db.collection("backupjobs").createIndex({ businessId: 1, createdAt: -1 });
  await db.collection("backupconfigs").createIndex({ businessId: 1 }, { unique: true });
}

export async function enqueueBackupJob(db, { businessId, userId, type = "BACKUP", reason = "MANUAL", backupId, id = randomUUID() }) {
  const job = { _id: id, businessId, userId, type, reason, backupId, status: "QUEUED", activeKey: String(businessId), createdAt: new Date() };
  try { await db.collection("backupjobs").insertOne(job); return job; }
  catch (error) { if (error.code === 11000) throw new Error("A backup or restore is already queued for this restaurant."); throw error; }
}
