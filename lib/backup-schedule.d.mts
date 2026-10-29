export type BackupSchedule = { enabled: boolean; mode: "DAILY" | "WEEKLY" | "INTERVAL"; time: string; days: number[]; intervalMinutes: number; afterClosing: boolean; timezone: string };
export const DEFAULT_BACKUP_SCHEDULE: BackupSchedule;
export function validateBackupSchedule(raw: unknown): BackupSchedule;
export function nextBackupAt(raw: BackupSchedule, after?: Date): Date | null;
