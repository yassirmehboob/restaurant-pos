import { enqueueBackupJob } from "./backup-queue.mjs";
export { ensureBackupIndexes, enqueueBackupJob } from "./backup-queue.mjs";
import { createBusinessBackup, listBusinessBackups, readBackupFile, restoreBusinessBackup } from "./backups.mjs";
import { copyBackupToDrive } from "./backup-drive.mjs";
import { nextBackupAt } from "./backup-schedule.mjs";

async function scheduleJobs(db, now) {
  for await (const config of db.collection("backupconfigs").find({ $or: [{ enabled: true }, { afterClosing: true }] })) {
    const business = await db.collection("businesses").findOne({ _id: config.businessId, isActive: true });
    if (!business) continue;
    const schedule = { ...config, timezone: business.timezone || config.timezone || "Asia/Karachi" };
    if (config.enabled && !config.nextRunAt) {
      await db.collection("backupconfigs").updateOne({ _id: config._id, revision: config.revision }, { $set: { nextRunAt: nextBackupAt(schedule, now) } });
      continue;
    }
    if (config.enabled && new Date(config.nextRunAt) <= now) {
      try {
        await enqueueBackupJob(db, { businessId: config.businessId, type: "BACKUP", reason: "SCHEDULED", id: `${config.businessId}:scheduled:${new Date(config.nextRunAt).toISOString()}` });
        await db.collection("backupconfigs").updateOne({ _id: config._id, revision: config.revision }, { $set: { nextRunAt: nextBackupAt(schedule, now) } });
      } catch { /* Keep the due time until the current operation finishes. */ }
    }
    if (config.afterClosing) {
      if (await db.collection("salesessions").findOne({ businessId: config.businessId, status: "OPEN" })) continue;
      const closed = await db.collection("salesessions").findOne({ businessId: config.businessId, status: "CLOSED", closedAt: { $gt: config.lastClosingBackupAt || config.closingEnabledAt || now } }, { sort: { closedAt: -1 } });
      if (!closed) continue;
      try {
        await enqueueBackupJob(db, { businessId: config.businessId, type: "BACKUP", reason: "CLOSING", id: `${config.businessId}:closing:${closed._id}` });
        await db.collection("backupconfigs").updateOne({ _id: config._id, revision: config.revision }, { $set: { lastClosingBackupAt: closed.closedAt } });
      } catch { /* Retry after an outstanding backup has finished. */ }
    }
  }
}

export async function runBackupTick(client, db, workerId, now = new Date()) {
  // A single leased worker prevents duplicate schedules across app processes.
  let lease;
  try {
    lease = await db.collection("backupworker").findOneAndUpdate({ _id: "leader", $or: [{ owner: workerId }, { leaseUntil: { $lte: now } }] }, { $set: { owner: workerId, heartbeatAt: now, leaseUntil: new Date(now.getTime() + 120000) } }, { upsert: true, returnDocument: "after" });
  } catch (error) { if (error.code === 11000) return; throw error; }
  if (!lease || lease.owner !== workerId) return;
  const heartbeat = setInterval(() => { void db.collection("backupworker").updateOne({ _id: "leader", owner: workerId }, { $set: { heartbeatAt: new Date(), leaseUntil: new Date(Date.now() + 120000) } }).catch(() => {}); }, 20000);
  try {
    await db.collection("backupjobs").updateMany({ status: "RUNNING", workerId: { $ne: workerId } }, { $set: { status: "FAILED", message: "Backup worker was interrupted. Retry the operation; the live database was not restored or replaced.", finishedAt: now }, $unset: { activeKey: "" } });
    await scheduleJobs(db, now);
    const job = await db.collection("backupjobs").findOneAndUpdate({ status: "QUEUED" }, { $set: { status: "RUNNING", startedAt: new Date(), workerId } }, { sort: { createdAt: 1 }, returnDocument: "after" });
    if (!job) return;
    try {
      const businessId = String(job.businessId);
      let result;
      if (job.type === "RESTORE") {
        if (!job.userId || !await db.collection("users").findOne({ _id: job.userId, businessId: job.businessId, role: "OWNER", isActive: true })) throw new Error("Restore requires an active owner account.");
        // Keep a fresh recovery point even though restoration never touches the live DB.
        const safety = await createBusinessBackup(client, db, businessId, "PRE_RESTORE");
        result = { ...await restoreBusinessBackup(client, db, businessId, job.backupId), safetyBackupId: safety.id };
      } else if (job.type === "BACKUP") {
        result = await createBusinessBackup(client, db, businessId, job.reason);
        // The local archive is already complete; an off-site copy failure is reported, not fatal.
        const drive = await copyBackupToDrive(db, { businessId: job.businessId, backup: result, bytes: await readBackupFile(businessId, result.id) });
        if (drive.status !== "SKIPPED") result = { ...result, drive };
      } else if (job.type === "DRIVE_UPLOAD") {
        const backup = (await listBusinessBackups(businessId)).find(file => file.id === job.backupId);
        if (!backup) throw new Error("Backup file was not found.");
        const drive = await copyBackupToDrive(db, { businessId: job.businessId, backup, bytes: await readBackupFile(businessId, backup.id), manual: true });
        if (drive.status !== "UPLOADED") throw new Error(drive.message || "Google Drive is not connected. Connect or reconnect Google Drive, then retry.");
        result = { id: backup.id, drive };
      } else throw new Error("Unsupported backup operation.");
      await db.collection("backupjobs").updateOne({ _id: job._id, status: "RUNNING", workerId }, { $set: { status: "SUCCEEDED", result, finishedAt: new Date() }, $unset: { activeKey: "" } });
      await db.collection("auditlogs").insertOne({ businessId: job.businessId, ...(job.userId ? { userId: job.userId } : {}), userNameSnapshot: "Backup service", action: job.type === "RESTORE" ? "PREPARE_RESTORE" : job.type === "DRIVE_UPLOAD" ? "UPLOAD_BACKUP_DRIVE" : "CREATE_BACKUP", entityType: "Backup", description: job.type === "RESTORE" ? `Prepared verified restore database ${result.database}` : job.type === "DRIVE_UPLOAD" ? `Google Drive upload of ${result.id}: ${result.drive.status.toLowerCase()}` : `Created encrypted backup ${result.id}${result.drive ? `; Google Drive copy ${result.drive.status.toLowerCase()}` : ""}`, createdAt: new Date() }).catch(() => {});
    } catch (error) {
      // Never include driver errors or connection strings in user-visible history.
      const message = /^(Backup |This is not |Use the original |Restore |Restaurant |A stable |AUTH_SECRET |Invalid restaurant|Invalid backup|Google Drive|The Google Drive)/.test(error.message) ? error.message.slice(0, 350) : "The operation failed. Check storage space, directory access, database replica-set support and database permissions, then retry.";
      await db.collection("backupjobs").updateOne({ _id: job._id, workerId }, { $set: { status: "FAILED", message, finishedAt: new Date() }, $unset: { activeKey: "" } });
    }
  } finally { clearInterval(heartbeat); }
}
