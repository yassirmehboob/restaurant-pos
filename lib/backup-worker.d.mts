import type { Db, MongoClient, ObjectId } from "mongodb";
export function ensureBackupIndexes(db: Db): Promise<void>;
export function enqueueBackupJob(db: Db, options: { businessId: ObjectId; userId?: ObjectId; type?: "BACKUP" | "RESTORE" | "DRIVE_UPLOAD"; reason?: string; backupId?: string; id?: string }): Promise<{ _id: string }>;
export function runBackupTick(client: MongoClient, db: Db, workerId: string, now?: Date): Promise<void>;
