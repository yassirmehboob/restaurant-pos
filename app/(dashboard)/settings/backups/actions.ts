"use server";

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { requirePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { DEFAULT_BACKUP_SCHEDULE, nextBackupAt, validateBackupSchedule } from "@/lib/backup-schedule.mjs";
import { backupRoot, listBusinessBackups, validateBackupId } from "@/lib/backup-runtime";
import { enqueueBackupJob, ensureBackupIndexes } from "@/lib/backup-queue.mjs";
import { User } from "@/models/User";
import { Business } from "@/models/Business";
import { allowAuthAttempt, consumeSecondFactor } from "@/lib/auth/two-factor";
import { writeAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { decryptDriveToken, driveOAuthConfig, DRIVE_UPLOAD_MODES, revokeDriveToken } from "@/lib/backup-drive.mjs";

async function backupUser(ownerOnly = false) {
  const user = await requirePermission("backups");
  if (!["OWNER", "ADMIN", "CASHIER"].includes(user.role) || (ownerOnly && user.role !== "OWNER")) throw new Error(ownerOnly ? "Only the owner can configure backups or prepare a restore." : "You cannot access backups.");
  await connectToDatabase();
  return user;
}

export async function loadBackupSettings() {
  const user = await backupUser(), db = mongoose.connection.db!, identity = new mongoose.Types.ObjectId(user.businessId);
  const [config, jobs, heartbeat, business] = await Promise.all([
    db.collection("backupconfigs").findOne({ businessId: identity }),
    db.collection("backupjobs").find({ businessId: identity }).sort({ createdAt: -1 }).limit(20).toArray(),
    db.collection<{ _id: string; heartbeatAt: Date }>("backupworker").findOne({ _id: "leader" }),
    Business.findById(user.businessId).select("timezone").lean(),
  ]);
  let files: Awaited<ReturnType<typeof listBusinessBackups>> = [], storageError = "";
  try { files = await listBusinessBackups(user.businessId); } catch { storageError = "Backup storage cannot be read. Check that the configured directory is available and accessible to the app."; }
  const schedule = validateBackupSchedule({ ...DEFAULT_BACKUP_SCHEDULE, ...(config ?? {}), timezone: business?.timezone || "Asia/Karachi" });
  const drive = config?.drive, owner = user.role === "OWNER";
  const uploaded = drive?.refreshToken && files.length ? new Set((await db.collection("backupdriveuploads").find({ businessId: identity, backupId: { $in: files.map(file => file.id) } }, { projection: { backupId: 1 } }).toArray()).map(row => String(row.backupId))) : new Set<string>();
  return {
    owner, directory: await backupRoot(), schedule,
    // Only connection status leaves the server; the encrypted token never does.
    drive: { configured: !!driveOAuthConfig(), connected: !!drive?.refreshToken, email: owner && typeof drive?.email === "string" ? drive.email : "", enabled: !!drive?.enabled, mode: drive?.mode === "EVERY" ? "EVERY" as const : "DAILY" as const, needsReconnect: !!drive?.needsReconnect, lastUploadAt: drive?.lastUploadAt ? new Date(drive.lastUploadAt).toISOString() : null, lastError: typeof drive?.lastError === "string" ? drive.lastError : "", folderUrl: owner && typeof drive?.folderId === "string" ? `https://drive.google.com/drive/folders/${encodeURIComponent(drive.folderId)}` : null },
    nextRunAt: config?.nextRunAt ? new Date(config.nextRunAt).toISOString() : null,
    workerOnline: !!heartbeat?.heartbeatAt && Date.now() - new Date(heartbeat.heartbeatAt).getTime() < 120000,
    workerLastSeen: heartbeat?.heartbeatAt ? new Date(heartbeat.heartbeatAt).toISOString() : null,
    storageError, files: files.map(file => ({ ...file, inDrive: uploaded.has(file.id) })),
    jobs: jobs.map(job => ({ id: String(job._id), type: String(job.type), reason: String(job.reason), status: String(job.status), createdAt: new Date(job.createdAt).toISOString(), message: String(job.message ?? ""), database: typeof job.result?.database === "string" ? job.result.database : null, backupId: typeof job.result?.id === "string" ? job.result.id : null, drive: job.result?.drive ? { status: String(job.result.drive.status), message: String(job.result.drive.message ?? "") } : null })),
  };
}

export async function requestManualBackup() {
  try {
    const user = await backupUser(), db = mongoose.connection.db!;
    await ensureBackupIndexes(db);
    const job = await enqueueBackupJob(db, { businessId: new mongoose.Types.ObjectId(user.businessId), userId: new mongoose.Types.ObjectId(user.id) });
    return { ok: true as const, jobId: job._id };
  } catch (error) { return { ok: false as const, message: error instanceof Error && /^(A backup|You cannot)/.test(error.message) ? error.message : "Could not queue the backup. Check your access and database connection." }; }
}

export async function saveBackupSettings(raw: unknown) {
  try {
    const user = await backupUser(true), schedule = validateBackupSchedule(raw), db = mongoose.connection.db!;
    const business = await Business.findById(user.businessId).select("timezone").lean();
    schedule.timezone = business?.timezone || "Asia/Karachi";
    const identity = new mongoose.Types.ObjectId(user.businessId);
    const previous = await db.collection("backupconfigs").findOne({ businessId: identity });
    await ensureBackupIndexes(db);
    await db.collection("backupconfigs").updateOne({ businessId: identity }, { $set: { ...schedule, businessId: identity, nextRunAt: nextBackupAt(schedule), updatedAt: new Date(), updatedBy: new mongoose.Types.ObjectId(user.id), ...(!previous?.afterClosing && schedule.afterClosing ? { closingEnabledAt: new Date(), lastClosingBackupAt: null } : {}) }, $inc: { revision: 1 } }, { upsert: true });
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "UPDATE_BACKUP_SCHEDULE", entityType: "Backup", description: "Updated automatic backup schedule" });
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: error instanceof Error && /^(Choose|Select|Check|Backup interval|Only the owner)/.test(error.message) ? error.message : "Could not save backup settings." }; }
}

export async function requestBackupRestore(raw: { backupId: string; password: string; code: string; confirmation: string }) {
  try {
    const user = await backupUser(true);
    if (!raw || raw.confirmation !== "RESTORE" || typeof raw.password !== "string" || raw.password.length > 200 || typeof raw.code !== "string" || raw.code.length > 64) throw new Error("Confirm the restore with your password and type RESTORE.");
    await validateBackupId(raw.backupId);
    if (!(await allowAuthAttempt("backup-restore:" + user.id, 5))) throw new Error("Too many restore attempts. Wait five minutes.");
    const account = await User.findOne({ _id: user.id, businessId: user.businessId, isActive: true, role: "OWNER" }).select("+passwordHash +twoFactorSecret +twoFactorLastStep +twoFactorRecoveryHashes");
    if (!account || !(await bcrypt.compare(raw.password, account.passwordHash))) throw new Error("Owner password is incorrect.");
    if (account.twoFactorEnabled && !(await consumeSecondFactor(account, raw.code.trim()))) throw new Error("Enter a fresh authenticator code or an unused recovery code.");
    const files = await listBusinessBackups(user.businessId);
    if (!files.some(file => file.id === raw.backupId)) throw new Error("Backup file was not found.");
    const db = mongoose.connection.db!;
    await ensureBackupIndexes(db);
    const job = await enqueueBackupJob(db, { businessId: new mongoose.Types.ObjectId(user.businessId), userId: new mongoose.Types.ObjectId(user.id), type: "RESTORE", reason: "OWNER_RESTORE", backupId: raw.backupId });
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "REQUEST_RESTORE", entityType: "Backup", description: "Requested restoration into a separate verified database" });
    return { ok: true as const, jobId: job._id };
  } catch (error) { return { ok: false as const, message: error instanceof Error && /^(Confirm|Owner password|Enter a fresh|Too many|Backup file|Invalid backup|A backup|Only the owner)/.test(error.message) ? error.message : "Could not prepare the restore. Check your credentials, backup storage and access." }; }
}

export async function saveDriveSettings(raw: { enabled: boolean; mode: string }) {
  try {
    const user = await backupUser(true);
    if (!raw || typeof raw.enabled !== "boolean" || !(DRIVE_UPLOAD_MODES as readonly string[]).includes(raw.mode)) throw new Error("Check the Google Drive settings.");
    const db = mongoose.connection.db!, businessId = new mongoose.Types.ObjectId(user.businessId);
    const result = await db.collection("backupconfigs").updateOne({ businessId, "drive.refreshToken": { $type: "string" } }, { $set: { "drive.enabled": raw.enabled, "drive.mode": raw.mode } });
    if (!result.matchedCount) throw new Error("Connect Google Drive first.");
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "UPDATE_BACKUP_DRIVE", entityType: "Backup", description: raw.enabled ? `Google Drive copies on (${raw.mode === "EVERY" ? "every backup" : "one per day"})` : "Google Drive copies off" });
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: error instanceof Error && /^(Check the Google|Connect Google|Only the owner)/.test(error.message) ? error.message : "Could not save Google Drive settings." }; }
}

export async function disconnectGoogleDrive() {
  try {
    const user = await backupUser(true), db = mongoose.connection.db!, businessId = new mongoose.Types.ObjectId(user.businessId);
    const drive = (await db.collection("backupconfigs").findOne({ businessId }))?.drive;
    if (!drive) return { ok: true as const };
    await db.collection("backupconfigs").updateOne({ businessId }, { $unset: { drive: "" } });
    await db.collection("backupdriveuploads").deleteMany({ businessId });
    // Revoke after removal so a revoke outage never leaves a stored, active token.
    if (typeof drive.refreshToken === "string") { try { await revokeDriveToken(decryptDriveToken(drive.refreshToken, env().AUTH_SECRET, user.businessId)); } catch { /* Already unusable. */ } }
    await writeAuditLog({ businessId: user.businessId, userId: user.id, userName: user.fullName, action: "DISCONNECT_BACKUP_DRIVE", entityType: "Backup", description: "Disconnected Google Drive backup copies; files already in Drive were kept" });
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: error instanceof Error && /^Only the owner/.test(error.message) ? error.message : "Could not disconnect Google Drive." }; }
}

export async function requestDriveUpload(backupId: string) {
  try {
    const user = await backupUser(true);
    await validateBackupId(backupId);
    const db = mongoose.connection.db!, businessId = new mongoose.Types.ObjectId(user.businessId);
    const drive = (await db.collection("backupconfigs").findOne({ businessId }))?.drive;
    if (typeof drive?.refreshToken !== "string") throw new Error("Connect Google Drive first.");
    if (drive.needsReconnect) throw new Error("Reconnect Google Drive first.");
    if (!(await listBusinessBackups(user.businessId)).some(file => file.id === backupId)) throw new Error("Backup file was not found.");
    await ensureBackupIndexes(db);
    const job = await enqueueBackupJob(db, { businessId, userId: new mongoose.Types.ObjectId(user.id), type: "DRIVE_UPLOAD", reason: "DRIVE_UPLOAD", backupId });
    return { ok: true as const, jobId: job._id };
  } catch (error) { return { ok: false as const, message: error instanceof Error && /^(Connect Google|Reconnect Google|Backup file|Invalid backup|A backup|Only the owner)/.test(error.message) ? error.message : "Could not queue the Google Drive upload." }; }
}
