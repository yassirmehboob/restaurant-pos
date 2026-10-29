import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { DEFAULT_BACKUP_SCHEDULE, nextBackupAt, validateBackupSchedule } from "../lib/backup-schedule.mjs";
import { backupRoot, decodeBackup, encodeBackup, validateBackupId, validateBackupPayload } from "../lib/backups.mjs";
import { mongoDatabaseUri } from "../lib/backup-switch.mjs";
import { can, routePrivilege } from "../lib/permissions.ts";

const id = new mongoose.Types.ObjectId(), secret = "test-backup-secret-abcdefghijklmnopqrstuvwxyz-123456789";
const previous = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = secret;
const fingerprint = (await import("node:crypto")).createHash("sha256").update(secret).digest("hex");
const payload = () => ({ format: "restaurant-pos", version: 1, businessId: String(id), authFingerprint: fingerprint, createdAt: new Date(), collections: [{ name: "businesses", documents: [{ _id: id, name: "Restaurant" }], indexes: [] }, { name: "users", documents: [{ _id: new mongoose.Types.ObjectId(), businessId: id, role: "OWNER", isActive: true, passwordHash: "sensitive-password-hash" }], indexes: [] }] });

test("backup encryption authenticates the whole archive and preserves BSON identities", () => {
  const source = payload(), bytes = encodeBackup(source), restored = decodeBackup(bytes);
  assert.ok(validateBackupPayload(restored, String(id)));
  assert.equal(String(restored.collections[0].documents[0]._id), String(id));
  assert.ok(restored.createdAt instanceof Date);
  assert.equal(bytes.includes(Buffer.from("sensitive-password-hash")), false);
  assert.equal(bytes.includes(Buffer.from("Restaurant")), false);
  const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => decodeBackup(corrupt), /damaged/);
  assert.throws(() => decodeBackup(bytes.subarray(0, -10)), /damaged/);
  const key = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = "another-encryption-key-abcdefghijklmnopqrstuvwxyz";
  assert.throws(() => decodeBackup(bytes), /different backup key/);
  if (key === undefined) delete process.env.BACKUP_ENCRYPTION_KEY; else process.env.BACKUP_ENCRYPTION_KEY = key;
});

test("validation rejects tenant mixing, unsupported collections, duplicate IDs and missing owner accounts", () => {
  const mixed = payload(); mixed.collections[1].documents[0].businessId = new mongoose.Types.ObjectId();
  assert.throws(() => validateBackupPayload(mixed, String(id)), /another restaurant/);
  const duplicate = payload(); duplicate.collections.push(duplicate.collections[0]);
  assert.throws(() => validateBackupPayload(duplicate, String(id)), /invalid collection/);
  const owner = payload(); owner.collections[1].documents[0].role = "CASHIER";
  assert.throws(() => validateBackupPayload(owner, String(id)), /active owner/);
  const auth = payload(); auth.authFingerprint = "wrong";
  assert.throws(() => validateBackupPayload(auth, String(id)), /original AUTH_SECRET/);
  const badCollection = payload(); badCollection.collections.push({ name: "system.users", documents: [], indexes: [] });
  assert.throws(() => validateBackupPayload(badCollection, String(id)), /invalid collection/);
  const duplicateDocument = payload(); duplicateDocument.collections[1].documents.push(duplicateDocument.collections[1].documents[0]);
  assert.throws(() => validateBackupPayload(duplicateDocument, String(id)), /duplicate/);
});

test("schedules follow restaurant time, selected weekdays and interval limits", () => {
  const daily = { ...DEFAULT_BACKUP_SCHEDULE, enabled: true, time: "00:15" };
  assert.equal(nextBackupAt(daily, new Date("2026-10-29T18:00:00Z")).toISOString(), "2026-10-29T19:15:00.000Z");
  assert.equal(nextBackupAt(daily, new Date("2026-10-29T19:15:00Z")).toISOString(), "2026-10-30T19:15:00.000Z");
  const weekly = { ...daily, mode: "WEEKLY", days: [1], time: "08:00" };
  assert.equal(nextBackupAt(weekly, new Date("2026-10-29T10:00:00Z")).toISOString(), "2026-11-02T03:00:00.000Z");
  const interval = { ...daily, mode: "INTERVAL", intervalMinutes: 90 };
  assert.equal(nextBackupAt(interval, new Date("2026-10-29T10:00:00Z")).toISOString(), "2026-10-29T11:30:00.000Z");
  assert.equal(nextBackupAt({ ...daily, enabled: false }), null);
  assert.throws(() => validateBackupSchedule({ ...daily, days: [] }), /Select/);
  assert.throws(() => validateBackupSchedule({ ...daily, intervalMinutes: 0 }), /interval/);
  assert.throws(() => validateBackupSchedule({ ...daily, time: "25:00" }), /time/);
  assert.throws(() => validateBackupSchedule({ ...daily, timezone: "Not/AZone" }), /time zone/);
  const dst = { ...daily, timezone: "America/New_York", time: "02:30" };
  assert.equal(nextBackupAt(dst, new Date("2026-03-08T05:00:00Z")).toISOString(), "2026-03-09T06:30:00.000Z");
});

test("backup paths cannot traverse directories or use publicly served storage", () => {
  for (const file of ["../secret", "a.rpos", "1234567890123-aaaaaaaaaaaaaaaa.rpos/../file", "C:\\private.rpos"]) assert.throws(() => validateBackupId(file));
  assert.equal(validateBackupId("1234567890123-aaaaaaaaaaaaaaaa.rpos"), "1234567890123-aaaaaaaaaaaaaaaa.rpos");
  const directory = process.env.BACKUP_DIRECTORY;
  process.env.BACKUP_DIRECTORY = "public/backups";
  assert.throws(() => backupRoot(), /cannot be inside public/);
  if (directory === undefined) delete process.env.BACKUP_DIRECTORY; else process.env.BACKUP_DIRECTORY = directory;
});

test("database switch keeps connection options and the original authentication database", () => {
  const uri = mongoDatabaseUri("mongodb://name:encoded%40password@a:27017,b:27018/restaurant?replicaSet=rs0", "restored", "admin");
  assert.equal(uri, "mongodb://name:encoded%40password@a:27017,b:27018/restored?replicaSet=rs0&authSource=admin");
  assert.equal(mongoDatabaseUri("mongodb+srv://cluster.example/original?retryWrites=true", "restored"), "mongodb+srv://cluster.example/restored?retryWrites=true");
  assert.throws(() => mongoDatabaseUri("mongodb://localhost/original", "../original"), /Invalid database/);
});

test("cashiers can create backups without receiving owner configuration privileges", () => {
  assert.equal(can({ role: "CASHIER" }, "backups"), true);
  assert.equal(can({ role: "CASHIER" }, "settings"), false);
  assert.equal(can({ role: "CASHIER", privileges: [] }, "backups"), false);
  assert.equal(can({ role: "WAITER", privileges: ["backups"] }, "backups"), false);
  assert.equal(can({ role: "KITCHEN" }, "backups"), false);
  assert.equal(routePrivilege("/settings/backups"), "backups");
});

test.after(() => { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; });
